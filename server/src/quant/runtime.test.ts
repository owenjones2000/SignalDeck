import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createQuantRuntime } from "./runtime.js";

it("starts independent worker and scheduler, fails interrupted work and stops cleanly", async () => {
  const db = new Database(":memory:");
  const execute = vi.fn(async () => ({ hits: [], failures: [] }));
  const signals = vi.fn(async () => ({ signals: [], failures: [] }));
  const client = { health: async () => ({}), formulas: async () => [], strategies: async () => [], quotes: async () => [], history: async () => ({}), signals, execute };
  const runtime = createQuantRuntime(db, { client, intervalMs: 10 });
  const interrupted = runtime.store.createJob({ kind: "screen", params: { codes: ["600000"], formula: "ma_cross" } });
  runtime.store.claimJob();
  const queued = runtime.store.createJob({ kind: "screen", params: { codes: ["600000"], formula: "ma_cross" } });
  runtime.start();
  runtime.start();
  await vi.waitFor(() => expect(runtime.store.getJob(queued.id)?.status).toBe("completed"));
  expect(runtime.store.getJob(interrupted.id)?.status).toBe("failed");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(signals).not.toHaveBeenCalled();
  await runtime.stop();
  const stopped = runtime.store.createJob({ kind: "screen", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(runtime.store.getJob(stopped.id)?.status).toBe("queued");
  db.close();
});

it("keeps runtime delivery retries ticking while automatic signals remain blocked and drains both loops on stop", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quant-runtime-"));
  const path = join(directory, "calendar.json");
  writeFileSync(path, JSON.stringify({ valid_from: "2026-11-18", valid_to: "2026-11-18", trading_days: ["2026-11-18"] }));
  vi.stubEnv("QUANT_CALENDAR_FILE", path);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T02:00:00Z"));
  const db = new Database(":memory:");
  let finishScan!: (result: { signals: []; failures: [] }) => void;
  const signals = vi.fn(() => new Promise<{ signals: []; failures: [] }>((resolve) => { finishScan = resolve; }));
  const client = { health: async () => ({}), formulas: async () => [], strategies: async () => [], quotes: async () => [], history: async () => ({}), signals, execute: async () => ({}) };
  const runtime = createQuantRuntime(db, { client });
  try {
    const alert = runtime.store.createAlert({ name: "慢扫描", codes: ["600000"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "local" });
    runtime.store.recordSignal(alert, { code: "600000", key: "ma_cross", name: "均线", type: "buy", date: "2026-11-18", price: 10 });
    runtime.store.finishDelivery(runtime.store.claimDelivery()!, "Retry later");
    runtime.start();
    await vi.advanceTimersByTimeAsync(60010);
    expect(signals).toHaveBeenCalledTimes(1);
    expect(runtime.store.listNotifications()[0]).toMatchObject({ status: "sent", attempts: 2 });
    runtime.store.recordSignal(alert, { code: "600000", key: "ma_cross", name: "均线", type: "buy", date: "2026-11-19", price: 10 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runtime.store.listNotifications()[0]).toMatchObject({ status: "sent", attempts: 1 });
    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finishScan({ signals: [], failures: [] });
    await stopping;
    expect(stopped).toBe(true);
    runtime.store.recordSignal(alert, { code: "600000", key: "ma_cross", name: "均线", type: "buy", date: "2026-11-20", price: 10 });
    await vi.advanceTimersByTimeAsync(15000);
    expect(runtime.store.listNotifications()[0].status).toBe("pending");
  } finally {
    finishScan?.({ signals: [], failures: [] });
    await runtime.stop();
    db.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
