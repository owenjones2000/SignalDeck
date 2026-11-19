import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Alert, AlertInput, Notification, Signal } from "./types.js";

export interface JobInput {
  kind: "screen" | "backtest";
  params: Record<string, unknown>;
}

export interface Job extends JobInput {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  result: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class QuantStore {
  constructor(private readonly db: Database.Database, private readonly now = () => new Date()) {
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE IF NOT EXISTS quant_jobs (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
        params TEXT NOT NULL, result TEXT, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS quant_jobs_queue ON quant_jobs(status, created_at);
      CREATE TABLE IF NOT EXISTS quant_alerts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, codes TEXT NOT NULL, signal TEXT NOT NULL,
        enabled INTEGER NOT NULL, interval_minutes INTEGER NOT NULL, channel TEXT NOT NULL,
        next_scan_at TEXT NOT NULL, last_error TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quant_events (
        id TEXT PRIMARY KEY, alert_id TEXT NOT NULL, code TEXT NOT NULL,
        signal_key TEXT NOT NULL, signal_type TEXT NOT NULL, signal_date TEXT NOT NULL,
        payload TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(alert_id, code, signal_key, signal_type, signal_date)
      );
      CREATE TABLE IF NOT EXISTS quant_deliveries (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES quant_events(id),
        channel TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, sent_at TEXT
      );
      CREATE INDEX IF NOT EXISTS quant_delivery_due ON quant_deliveries(status, next_attempt_at);
      CREATE TABLE IF NOT EXISTS quant_watchlist (code TEXT PRIMARY KEY);
    `);
  }

  createJob(input: JobInput): Job {
    const id = randomUUID();
    const time = this.now().toISOString();
    this.db.prepare("INSERT INTO quant_jobs VALUES (?, ?, 'queued', ?, NULL, NULL, ?, ?)")
      .run(id, input.kind, JSON.stringify(input.params), time, time);
    return this.getJob(id)!;
  }

  listWatchlist(): { code: string }[] {
    return this.db.prepare("SELECT code FROM quant_watchlist ORDER BY rowid").all() as { code: string }[];
  }

  addWatchlist(code: string): void {
    if (this.listWatchlist().length >= 100 && !this.listWatchlist().some((item) => item.code === code)) {
      throw new Error("Watchlist limit is 100 codes");
    }
    this.db.prepare("INSERT OR IGNORE INTO quant_watchlist VALUES (?)").run(code);
  }

  deleteWatchlist(code: string): void {
    this.db.prepare("DELETE FROM quant_watchlist WHERE code = ?").run(code);
  }

  recover(): void {
    this.db.prepare("UPDATE quant_jobs SET status = 'failed', error = 'Server restarted while job was running', updated_at = ? WHERE status = 'running'")
      .run(this.now().toISOString());
    this.db.prepare("UPDATE quant_deliveries SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'retrying' END, error = 'Server restarted during delivery', next_attempt_at = ? WHERE status = 'sending'")
      .run(this.now().toISOString());
  }

  createAlert(input: AlertInput): Alert {
    const id = randomUUID();
    const time = this.now().toISOString();
    this.db.prepare("INSERT INTO quant_alerts VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)")
      .run(id, input.name, JSON.stringify(input.codes), input.signal, Number(input.enabled), input.interval_minutes, input.channel, time, time);
    return this.getAlert(id)!;
  }

  getAlert(id: string): Alert | undefined {
    const row = this.db.prepare("SELECT * FROM quant_alerts WHERE id = ?").get(id) as Alert | undefined;
    return row && { ...row, codes: JSON.parse(row.codes as unknown as string), enabled: Boolean(row.enabled) };
  }

  listAlerts(): Alert[] {
    return (this.db.prepare("SELECT id FROM quant_alerts ORDER BY created_at, rowid").all() as { id: string }[])
      .map(({ id }) => this.getAlert(id)!);
  }

  setAlertEnabled(id: string, enabled: boolean): Alert | undefined {
    this.db.prepare("UPDATE quant_alerts SET enabled = ?, next_scan_at = ? WHERE id = ?")
      .run(Number(enabled), this.now().toISOString(), id);
    return this.getAlert(id);
  }

  deleteAlert(id: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare("UPDATE quant_deliveries SET status = 'failed', error = 'Alert deleted' WHERE event_id IN (SELECT id FROM quant_events WHERE alert_id = ?) AND status IN ('pending', 'retrying', 'sending')").run(id);
      return this.db.prepare("DELETE FROM quant_alerts WHERE id = ?").run(id).changes > 0;
    })();
  }

  recordScan(id: string, next: Date, error: string | null): void {
    this.db.prepare("UPDATE quant_alerts SET next_scan_at = ?, last_error = ? WHERE id = ?")
      .run(next.toISOString(), error, id);
  }

  recordSignal(alert: Alert, signal: Signal): void {
    this.db.transaction(() => {
      if (!this.getAlert(alert.id)) return;
      const time = this.now().toISOString();
      const id = randomUUID();
      const inserted = this.db.prepare("INSERT OR IGNORE INTO quant_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, alert.id, signal.code, signal.key, signal.type, signal.date, JSON.stringify({ ...signal, alert_name: alert.name }), time);
      if (inserted.changes) {
        this.db.prepare("INSERT INTO quant_deliveries VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?, NULL)")
          .run(randomUUID(), id, alert.channel, time, time);
      }
    })();
  }

  listNotifications(): Notification[] {
    const rows = this.db.prepare(`SELECT d.*, e.alert_id, e.payload FROM quant_deliveries d
      JOIN quant_events e ON e.id = d.event_id ORDER BY d.created_at DESC, d.rowid DESC LIMIT 500`).all() as Notification[];
    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload as unknown as string) }));
  }

  claimDelivery(): Notification | undefined {
    return this.db.transaction((): Notification | undefined => {
      const row = this.db.prepare(`SELECT d.*, e.alert_id, e.payload FROM quant_deliveries d
        JOIN quant_events e ON e.id = d.event_id
        WHERE d.status IN ('pending', 'retrying') AND d.next_attempt_at <= ?
        ORDER BY d.next_attempt_at, d.rowid LIMIT 1`).get(this.now().toISOString()) as Notification | undefined;
      if (!row) return undefined;
      this.db.prepare("UPDATE quant_deliveries SET status = 'sending', attempts = attempts + 1 WHERE id = ?").run(row.id);
      return { ...row, status: "sending", attempts: row.attempts + 1, payload: JSON.parse(row.payload as unknown as string) };
    })();
  }

  finishDelivery(delivery: Notification, error: string | null): void {
    const time = this.now();
    const next = new Date(time.getTime() + Math.min(3_600_000, 60_000 * 2 ** (delivery.attempts - 1)));
    this.db.prepare("UPDATE quant_deliveries SET status = ?, error = ?, next_attempt_at = ?, sent_at = ? WHERE id = ? AND status = 'sending'")
      .run(error ? (delivery.attempts >= 5 ? "failed" : "retrying") : "sent", error, next.toISOString(), error ? null : time.toISOString(), delivery.id);
  }

  getJob(id: string): Job | undefined {
    const row = this.db.prepare("SELECT * FROM quant_jobs WHERE id = ?").get(id) as Job | undefined;
    return row && this.decodeJob(row);
  }

  listJobs(): Job[] {
    return (this.db.prepare("SELECT * FROM quant_jobs ORDER BY created_at DESC, rowid DESC LIMIT 500").all() as Job[])
      .map((row) => this.decodeJob(row));
  }

  claimJob(): Job | undefined {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT id FROM quant_jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1").get() as { id: string } | undefined;
      if (!row) return undefined;
      this.db.prepare("UPDATE quant_jobs SET status = 'running', updated_at = ? WHERE id = ?")
        .run(this.now().toISOString(), row.id);
      return this.getJob(row.id);
    })();
  }

  finishJob(id: string, result: unknown, error: string | null): void {
    this.db.prepare("UPDATE quant_jobs SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ? AND status = 'running'")
      .run(error ? "failed" : "completed", result == null ? null : JSON.stringify(result), error, this.now().toISOString(), id);
  }

  private decodeJob(row: Job): Job {
    return { ...row, params: JSON.parse(row.params as unknown as string), result: row.result == null ? null : JSON.parse(row.result as string) };
  }
}
