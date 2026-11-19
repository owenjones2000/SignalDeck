import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QuantStore } from "./store.js";
import { AlertScheduler } from "./scheduler.js";

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

it("deduplicates signal events and persists delivery retries across restart", async () => {
  let now = new Date("2026-11-18T02:00:00Z");
  const db = new Database(":memory:");
  databases.push(db);
  let store = new QuantStore(db, () => now);
  const alert = store.createAlert({ name: "金叉", codes: ["600000"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "feishu" });
  const signals = async () => ({ signals: [{ code: "600000", key: "ma_cross", name: "均线金叉", type: "buy", date: "2026-11-18", price: 10 }], failures: [] });
  const deliver = vi.fn().mockRejectedValueOnce(new Error("Delivery failed")).mockResolvedValue(undefined);
  let scheduler = new AlertScheduler(store, signals, deliver, () => ({ allowed: true, reason: null }), () => now);
  await scheduler.testAlert(alert.id);
  expect(store.listNotifications()).toHaveLength(1);
  expect(store.listNotifications()[0]).toMatchObject({ status: "retrying", attempts: 1, error: "Delivery failed" });
  store = new QuantStore(db, () => now);
  store.recover();
  scheduler = new AlertScheduler(store, signals, deliver, () => ({ allowed: true, reason: null }), () => now);
  now = new Date("2026-11-18T02:02:00Z");
  await scheduler.tick();
  expect(store.listNotifications()).toHaveLength(1);
  expect(store.listNotifications()[0]).toMatchObject({ status: "sent", attempts: 2, error: null });
  expect(deliver).toHaveBeenCalledTimes(2);
});

it("pauses automatic scans without a calendar but permits manual tests and delivery retries", async () => {
  const db = new Database(":memory:");
  databases.push(db);
  const store = new QuantStore(db);
  const alert = store.createAlert({ name: "暂停", codes: ["600000"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "local" });
  const signals = vi.fn(async () => ({ signals: [], failures: [{ code: "600000", error: "No data" }] }));
  const scheduler = new AlertScheduler(store, signals, async () => {}, () => ({ allowed: false, reason: "Trading calendar unavailable" }));
  await scheduler.tick();
  expect(signals).not.toHaveBeenCalled();
  expect(scheduler.status()).toEqual({ allowed: false, reason: "Trading calendar unavailable" });
  expect(await scheduler.testAlert(alert.id)).toEqual({ signals: [], failures: [{ code: "600000", error: "No data" }] });
  expect(store.getAlert(alert.id)?.last_error).toBe("600000: No data");
});

it("continues other alerts and pending deliveries when a supplier scan fails", async () => {
  const db = new Database(":memory:");
  databases.push(db);
  const store = new QuantStore(db);
  const first = store.createAlert({ name: "一", codes: ["600000"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "local" });
  const second = store.createAlert({ name: "二", codes: ["600001"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "local" });
  const signals = vi.fn().mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue({ signals: [{ code: "600001", key: "ma_cross", type: "buy", name: "均线", date: "2026-11-18", price: 10 }], failures: [] });
  const scheduler = new AlertScheduler(store, signals, async () => {}, () => ({ allowed: true, reason: null }));
  await scheduler.tick();
  expect(store.getAlert(first.id)?.last_error).toBe("Unavailable");
  expect(store.listNotifications()[0]).toMatchObject({ alert_id: second.id, status: "sent" });
});

it("bounds failed deliveries to five attempts and retries during calendar pause", async () => {
  let now = new Date("2026-11-18T02:00:00Z");
  const db = new Database(":memory:");
  databases.push(db);
  const store = new QuantStore(db, () => now);
  const alert = store.createAlert({ name: "重试", codes: ["600000"], signal: "ma_cross", enabled: false, interval_minutes: 1, channel: "email" });
  const signals = async () => ({ signals: [{ code: "600000", key: "ma_cross", name: "金叉", type: "buy", date: "2026-11-18", price: 10 }], failures: [] });
  const deliver = vi.fn(async () => { throw new Error("Email delivery failed"); });
  const scheduler = new AlertScheduler(store, signals, deliver, () => ({ allowed: false, reason: "Calendar unavailable" }), () => now);
  await scheduler.testAlert(alert.id);
  await scheduler.tick();
  expect(deliver).toHaveBeenCalledTimes(1);
  for (let index = 0; index < 5; index++) {
    now = new Date(now.getTime() + 3600000);
    await scheduler.tick();
  }
  expect(deliver).toHaveBeenCalledTimes(5);
  expect(store.listNotifications()[0]).toMatchObject({ status: "failed", attempts: 5 });
  await scheduler.testAlert(alert.id);
  expect(store.listNotifications()).toHaveLength(1);
  expect(deliver).toHaveBeenCalledTimes(5);
});

it("fails a fifth interrupted delivery on restart without attempting a sixth send", () => {
  const db = new Database(":memory:");
  databases.push(db);
  let now = new Date("2026-11-18T02:00:00Z");
  const store = new QuantStore(db, () => now);
  const alert = store.createAlert({ name: "中断", codes: ["600000"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "local" });
  store.recordSignal(alert, { code: "600000", key: "ma_cross", name: "均线", type: "buy", date: "2026-11-18", price: 10 });
  for (let index = 0; index < 4; index++) {
    const delivery = store.claimDelivery()!;
    store.finishDelivery(delivery, "Failed");
    now = new Date(now.getTime() + 3600000);
  }
  expect(store.claimDelivery()?.attempts).toBe(5);
  store.recover();
  expect(store.listNotifications()[0].status).toBe("failed");
  expect(store.claimDelivery()).toBeUndefined();
});

it("retains watchlist, alerts and pending deliveries after closing and reopening SQLite", () => {
  const directory = mkdtempSync(join(tmpdir(), "quant-alerts-"));
  const path = join(directory, "state.db");
  let db = new Database(path);
  let store = new QuantStore(db);
  store.addWatchlist("600000");
  const alert = store.createAlert({ name: "持久", codes: ["600000"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "local" });
  store.recordSignal(alert, { code: "600000", key: "ma_cross", name: "均线", type: "buy", date: "2026-11-18", price: 10 });
  const delivery = store.claimDelivery()!;
  db.close();
  db = new Database(path);
  try {
    store = new QuantStore(db);
    store.recover();
    expect(store.listWatchlist()).toEqual([{ code: "600000" }]);
    expect(store.getAlert(alert.id)).toEqual(alert);
    expect(store.claimDelivery()).toMatchObject({ id: delivery.id, event_id: delivery.event_id, attempts: 2 });
    store.deleteAlert(alert.id);
    expect(store.getAlert(alert.id)).toBeUndefined();
    expect(store.listNotifications()).toHaveLength(1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("rechecks the calendar before each scan when a previous scan crosses session end", async () => {
  const db = new Database(":memory:");
  databases.push(db);
  const store = new QuantStore(db);
  for (const code of ["600000", "600001"]) {
    store.createAlert({ name: code, codes: [code], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "local" });
  }
  let allowed = true;
  const signals = vi.fn(async () => {
    allowed = false;
    return { signals: [], failures: [] };
  });
  const scheduler = new AlertScheduler(store, signals, async () => {}, () => ({ allowed, reason: allowed ? null : "Outside trading session" }));
  await scheduler.tick();
  expect(signals).toHaveBeenCalledTimes(1);
});

it.each([null, "Delivery failed"])("does not revive a deleted sending delivery after late completion %s or restart", (error) => {
  const directory = mkdtempSync(join(tmpdir(), "quant-cancel-"));
  const path = join(directory, "state.db");
  let db = new Database(path);
  try {
    let store = new QuantStore(db);
    const alert = store.createAlert({ name: "取消", codes: ["600000"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "email" });
    store.recordSignal(alert, { code: "600000", key: "ma_cross", name: "金叉", type: "buy", date: "2026-11-18", price: 10 });
    const delivery = store.claimDelivery()!;
    expect(store.deleteAlert(alert.id)).toBe(true);
    const cancelled = store.listNotifications()[0];
    expect(cancelled).toMatchObject({ status: "failed", error: "Alert deleted", sent_at: null, attempts: 1 });
    store.finishDelivery(delivery, error);
    expect(store.listNotifications()[0]).toEqual(cancelled);
    db.close();
    db = new Database(path);
    store = new QuantStore(db);
    store.recover();
    store.finishDelivery(delivery, error);
    expect(store.listNotifications()[0]).toEqual(cancelled);
    expect(store.claimDelivery()).toBeUndefined();
    store.recordSignal(alert, { code: "600000", key: "ma_cross", name: "金叉", type: "buy", date: "2026-11-19", price: 11 });
    expect(store.listNotifications()).toHaveLength(1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("retries deliveries during a blocked scan while keeping scan and delivery loops independently exclusive", async () => {
  const db = new Database(":memory:");
  databases.push(db);
  let now = new Date("2026-11-18T02:00:00Z");
  const store = new QuantStore(db, () => now);
  const alert = store.createAlert({ name: "慢扫描", codes: ["600000"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "email" });
  const signal = { code: "600000", key: "ma_cross", name: "均线", type: "buy", date: "2026-11-18", price: 10 };
  store.recordSignal(alert, signal);
  store.finishDelivery(store.claimDelivery()!, "Temporary failure");
  now = new Date("2026-11-18T02:02:00Z");
  let finishScan!: (result: { signals: typeof signal[]; failures: [] }) => void;
  let finishDelivery!: () => void;
  const signals = vi.fn(() => new Promise<{ signals: typeof signal[]; failures: [] }>((resolve) => { finishScan = resolve; }));
  const deliver = vi.fn(() => new Promise<void>((resolve) => { finishDelivery = resolve; }));
  const scheduler = new AlertScheduler(store, signals, deliver, () => ({ allowed: true, reason: null }), () => now);
  const scanning = scheduler.scanTick();
  await scheduler.scanTick();
  const sending = scheduler.deliveryTick();
  await scheduler.deliveryTick();
  expect(signals).toHaveBeenCalledTimes(1);
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(store.listNotifications()[0]).toMatchObject({ status: "sending", attempts: 2 });
  finishDelivery();
  await sending;
  expect(store.listNotifications()[0].status).toBe("sent");
  finishScan({ signals: [], failures: [] });
  await scanning;
});

it("does not block automatic or manual scans behind an in-flight delivery and cancels its late result", async () => {
  const db = new Database(":memory:");
  databases.push(db);
  const store = new QuantStore(db);
  const alert = store.createAlert({ name: "慢投递", codes: ["600000"], signal: "ma_cross", enabled: true, interval_minutes: 1, channel: "email" });
  const signal = { code: "600000", key: "ma_cross", name: "均线", type: "buy", date: "2026-11-18", price: 10 };
  store.recordSignal(alert, signal);
  let finishDelivery!: () => void;
  const deliver = vi.fn(() => new Promise<void>((resolve) => { finishDelivery = resolve; }));
  const signals = vi.fn(async () => ({ signals: [signal], failures: [] }));
  const scheduler = new AlertScheduler(store, signals, deliver, () => ({ allowed: true, reason: null }));
  const sending = scheduler.deliveryTick();
  await scheduler.scanTick();
  await scheduler.testAlert(alert.id);
  expect(signals).toHaveBeenCalledTimes(2);
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(store.listNotifications()).toHaveLength(1);
  store.deleteAlert(alert.id);
  finishDelivery();
  await sending;
  expect(store.listNotifications()[0]).toMatchObject({ status: "failed", error: "Alert deleted", sent_at: null });
});
