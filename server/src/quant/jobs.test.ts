import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QuantStore } from "./store.js";
import { JobWorker } from "./worker.js";

const directory = mkdtempSync(join(tmpdir(), "quant-jobs-"));
const databases: Database.Database[] = [];

afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});

function open(path = ":memory:") {
  const db = new Database(path);
  databases.push(db);
  return new QuantStore(db);
}

it("persists queued jobs, runs one at a time and exposes the Python result", async () => {
  const path = join(directory, "jobs.db");
  const store = open(path);
  const job = store.createJob({ kind: "screen", params: { formula: "ma_cross", codes: ["600000"], count: 250 } });
  expect(open(path).getJob(job.id)).toMatchObject({ status: "queued", result: null, error: null });
  let finish!: (result: unknown) => void;
  const execute = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  const worker = new JobWorker(store, execute);
  const running = worker.tick();
  await worker.tick();
  expect(store.getJob(job.id)?.status).toBe("running");
  expect(execute).toHaveBeenCalledTimes(1);
  finish({ hits: [], failures: [{ code: "600000", error: "supplier down" }] });
  await running;
  expect(store.getJob(job.id)).toMatchObject({ status: "completed", result: { hits: [], failures: [{ code: "600000", error: "supplier down" }] } });
  databases.splice(0).forEach((db) => db.close());
  rmSync(directory, { recursive: true, force: true });
});

it("fails interrupted jobs on restart while retaining queued work", async () => {
  const store = open();
  const interrupted = store.createJob({ kind: "backtest", params: { code: "600000", strategy: "dual_ma" } });
  store.claimJob();
  const queued = store.createJob({ kind: "screen", params: { formula: "ma_cross", codes: ["600000"] } });
  store.recover();
  expect(store.getJob(interrupted.id)).toMatchObject({ status: "failed", error: "Server restarted while job was running" });
  const worker = new JobWorker(store, async () => { throw new Error("Quant request timed out"); });
  await worker.tick();
  expect(store.getJob(queued.id)).toMatchObject({ status: "failed", result: null, error: "Quant request timed out" });
});
