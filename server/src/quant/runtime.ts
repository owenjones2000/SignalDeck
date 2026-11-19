import type Database from "better-sqlite3";
import { z } from "zod";
import { TradingCalendar } from "./calendar.js";
import { PythonClient, type QuantClient } from "./client.js";
import { NotificationSender } from "./notifications.js";
import { AlertScheduler } from "./scheduler.js";
import { QuantStore } from "./store.js";
import { JobWorker } from "./worker.js";

export function createQuantRuntime(db: Database.Database, options: { client?: QuantClient; intervalMs?: number } = {}) {
  const timeout = z.coerce.number().int().min(100).max(300000).parse(process.env.QUANT_TIMEOUT_MS ?? 30000);
  const client = options.client ?? new PythonClient(process.env.QUANT_URL, timeout);
  const store = new QuantStore(db);
  const calendar = new TradingCalendar();
  const sender = new NotificationSender();
  const worker = new JobWorker(store, (job) => client.execute(job));
  const scheduler = new AlertScheduler(store, (codes) => client.signals(codes), (notification) => sender.send(notification), () => calendar.check());
  let workerTimer: ReturnType<typeof setInterval> | undefined;
  let scanTimer: ReturnType<typeof setInterval> | undefined;
  let deliveryTimer: ReturnType<typeof setInterval> | undefined;
  const active = new Set<Promise<void>>();
  const run = (operation: () => Promise<void>) => {
    const promise = operation().catch(() => { console.error("Quant background operation failed"); });
    active.add(promise);
    void promise.finally(() => active.delete(promise));
  };

  return {
    store, client, scheduler, channels: () => sender.channels(),
    start() {
      if (workerTimer) return;
      store.recover();
      workerTimer = setInterval(() => run(() => worker.tick()), options.intervalMs ?? 1000);
      scanTimer = setInterval(() => run(() => scheduler.scanTick()), options.intervalMs ?? 15000);
      deliveryTimer = setInterval(() => run(() => scheduler.deliveryTick()), options.intervalMs ?? 1000);
      workerTimer.unref();
      scanTimer.unref();
      deliveryTimer.unref();
      run(() => worker.tick());
      run(() => scheduler.scanTick());
      run(() => scheduler.deliveryTick());
    },
    async stop() {
      clearInterval(workerTimer);
      clearInterval(scanTimer);
      clearInterval(deliveryTimer);
      workerTimer = undefined;
      scanTimer = undefined;
      deliveryTimer = undefined;
      await Promise.all([...active]);
    },
  };
}
