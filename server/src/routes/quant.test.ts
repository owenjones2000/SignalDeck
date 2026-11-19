import Database from "better-sqlite3";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiKey } from "../auth.js";
import { QuantStore } from "../quant/store.js";
import { AlertScheduler } from "../quant/scheduler.js";
import { createQuantRouter } from "./quant.js";

let db: Database.Database;
let server: Server;
let base: string;
let store: QuantStore;
const client = {
  health: vi.fn(async () => ({ status: "ok", source: "fixture", market_verified: false })),
  formulas: vi.fn(async () => [{ key: "ma_cross", name: "均线", min_history: 21 }]),
  strategies: vi.fn(async () => [{ key: "dual_ma", name: "均线", min_history: 21 }]),
  quotes: vi.fn(async () => []), history: vi.fn(async () => ({ bars: [] })),
  execute: vi.fn(async () => ({ hits: [], failures: [] })),
  signals: vi.fn(async () => ({ signals: [], failures: [] })),
};

beforeEach(async () => {
  vi.clearAllMocks();
  db = new Database(":memory:");
  store = new QuantStore(db);
  const scheduler = new AlertScheduler(store, client.signals, async () => {}, () => ({ allowed: false, reason: "Trading calendar unavailable" }));
  const app = express();
  app.use(express.json());
  app.use("/api/quant", createQuantRouter({ store, client, scheduler, channels: () => ({ local: true, feishu: false, email: false }) }));
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/quant`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

function request(path: string, method = "GET", body?: unknown) {
  return fetch(base + path, { method, headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

it.each(["/status", "/formulas", "/strategies", "/watchlist", "/quotes", "/history/600000", "/jobs", "/jobs/missing", "/alerts", "/notifications"])("requires authentication for %s", async (path) => {
  expect((await fetch(base + path)).status).toBe(401);
});

it("persists watchlist and exposes array lists and explicit offline scan status", async () => {
  expect((await request("/watchlist", "POST", { code: "600000" })).status).toBe(201);
  await request("/watchlist", "POST", { code: "600000" });
  expect(await (await request("/watchlist")).json()).toEqual([{ code: "600000" }]);
  await request("/quotes");
  expect(client.quotes).toHaveBeenCalledWith(["600000"]);
  expect(await (await request("/status")).json()).toMatchObject({ available: true, channels: { local: true, feishu: false, email: false }, scheduler: { allowed: false, reason: "Trading calendar unavailable" } });
  expect((await request("/watchlist/600000", "DELETE")).status).toBe(204);
  expect(await (await request("/watchlist")).json()).toEqual([]);
  for (const path of ["/jobs", "/alerts", "/notifications"]) expect(await (await request(path)).json()).toEqual([]);
});

it("validates Python job parameters before queuing and returns durable job contract", async () => {
  const response = await request("/jobs", "POST", { kind: "backtest", params: { code: "600000", strategy: "dual_ma" } });
  expect(response.status).toBe(202);
  const job = await response.json();
  expect(job).toMatchObject({ kind: "backtest", status: "queued", result: null, error: null, params: { count: 250, init_capital: 100000, position_pct: 1, commission: 0.0003, stamp_tax: 0.0005 } });
  expect(await (await request(`/jobs/${job.id}`)).json()).toEqual(job);
  expect(store.listJobs()).toHaveLength(1);
  for (const params of [{ code: "600000", strategy: "unknown" }, { code: "600000", strategy: "dual_ma", count: 20 }, { code: "600000", strategy: "dual_ma", commission: 1 }, { code: "600000", strategy: "dual_ma", extra: "secret" }]) {
    expect((await request("/jobs", "POST", { kind: "backtest", params })).status).toBe(400);
  }
  expect((await request("/history/600000?count=2.5")).status).toBe(400);
  expect((await request("/watchlist", "POST", { code: "ABC" })).status).toBe(400);
  expect((await request("/watchlist", "POST", { code: "100000" })).status).toBe(400);
  expect((await request("/watchlist", "POST", { code: "920001" })).status).toBe(201);
});

it("matches Python breakout minimum of 22 bars without changing the 21-bar volume formula", async () => {
  const params = { code: "600000", strategy: "breakout", count: 21 };
  expect((await request("/jobs", "POST", { kind: "backtest", params })).status).toBe(400);
  expect(store.listJobs()).toEqual([]);
  expect((await request("/jobs", "POST", { kind: "backtest", params: { ...params, count: 22 } })).status).toBe(202);
  expect((await request("/jobs", "POST", { kind: "screen", params: { codes: ["600000"], formula: "volume_breakout", count: 21 } })).status).toBe(202);
});

it("manages local alerts, tests manually during calendar pause and rejects stored credentials", async () => {
  const input = { name: "金叉", codes: ["600000"], signal: "ma_cross", channel: "local", enabled: false };
  const response = await request("/alerts", "POST", input);
  expect(response.status).toBe(201);
  const alert = await response.json();
  expect(await (await request("/alerts")).json()).toEqual([alert]);
  expect(await (await request(`/alerts/${alert.id}/test`, "POST", {})).json()).toEqual({ signals: [], failures: [] });
  expect((await request(`/alerts/${alert.id}`, "PATCH", { enabled: true })).status).toBe(200);
  expect(store.getAlert(alert.id)?.enabled).toBe(true);
  expect((await request("/alerts", "POST", { ...input, webhook: "secret" })).status).toBe(400);
  expect((await request("/alerts", "POST", { ...input, channel: "email" })).status).toBe(400);
  expect((await request(`/alerts/${alert.id}`, "DELETE")).status).toBe(204);
  expect((await request(`/alerts/${alert.id}/test`, "POST", {})).status).toBe(404);
});

it.each([
  ["/watchlist", "POST", { code: "600000" }], ["/watchlist/600000", "DELETE", undefined],
  ["/jobs", "POST", { kind: "screen", params: {} }], ["/alerts", "POST", {}],
  ["/alerts/missing", "PATCH", { enabled: false }], ["/alerts/missing", "DELETE", undefined],
  ["/alerts/missing/test", "POST", {}],
])("authenticates mutations %s %s", async (path, method, body) => {
  expect((await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).status).toBe(401);
});
