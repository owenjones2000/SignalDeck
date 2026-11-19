import { QuantStore } from "./store.js";
import type { Alert, Notification, ScanGate, SignalsResult } from "./types.js";

export class AlertScheduler {
  private scanBusy = false;
  private deliveryBusy = false;
  private readonly scanning = new Set<string>();

  constructor(
    private readonly store: QuantStore,
    private readonly signals: (codes: string[]) => Promise<SignalsResult>,
    private readonly deliver: (notification: Notification) => Promise<void>,
    private readonly gate: () => ScanGate,
    private readonly now = () => new Date(),
  ) {}

  status(): ScanGate {
    return this.gate();
  }

  async tick(): Promise<void> {
    await Promise.all([
      this.scanTick().then(() => this.deliveryTick()),
      this.deliveryTick(),
    ]);
  }

  async scanTick(): Promise<void> {
    if (this.scanBusy) return;
    this.scanBusy = true;
    try {
      if (this.gate().allowed) {
        for (const alert of this.store.listAlerts()) {
          if (!this.gate().allowed) break;
          if (this.scanning.has(alert.id)) continue;
          if (alert.enabled && alert.next_scan_at <= this.now().toISOString()) {
            try {
              await this.scan(alert);
            } catch {
              continue;
            }
          }
        }
      }
    } finally {
      this.scanBusy = false;
    }
  }

  async testAlert(id: string): Promise<SignalsResult> {
    const alert = this.store.getAlert(id);
    if (!alert) throw new Error("Alert not found");
    const result = await this.scan(alert);
    await this.deliveryTick();
    return result;
  }

  private async scan(alert: Alert): Promise<SignalsResult> {
    if (this.scanning.has(alert.id)) throw new Error("Alert scan already running");
    this.scanning.add(alert.id);
    const next = new Date(this.now().getTime() + alert.interval_minutes * 60_000);
    try {
      const result = await this.signals(alert.codes);
      for (const signal of result.signals) {
        if (alert.codes.includes(signal.code) && signal.key === alert.signal) this.store.recordSignal(alert, signal);
      }
      this.store.recordScan(alert.id, next, result.failures.length ? result.failures.map((failure) => `${failure.code}: ${failure.error}`).join("; ") : null);
      return result;
    } catch (error) {
      this.store.recordScan(alert.id, next, error instanceof Error ? error.message : "Signal scan failed");
      throw error;
    } finally {
      this.scanning.delete(alert.id);
    }
  }

  async deliveryTick(): Promise<void> {
    if (this.deliveryBusy) return;
    this.deliveryBusy = true;
    try {
      for (let count = 0; count < 100; count++) {
        const delivery = this.store.claimDelivery();
        if (!delivery) return;
        try {
          await this.deliver(delivery);
          this.store.finishDelivery(delivery, null);
        } catch (error) {
          this.store.finishDelivery(delivery, error instanceof Error ? error.message : "Delivery failed");
        }
      }
    } finally {
      this.deliveryBusy = false;
    }
  }
}
