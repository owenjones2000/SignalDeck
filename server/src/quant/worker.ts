import { QuantStore, type JobInput } from "./store.js";

export class JobWorker {
  private busy = false;

  constructor(private readonly store: QuantStore, private readonly execute: (job: JobInput) => Promise<unknown>) {}

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const job = this.store.claimJob();
      if (!job) return;
      try {
        const result = await this.execute(job);
        this.store.finishJob(job.id, result, null);
      } catch (error) {
        this.store.finishJob(job.id, null, error instanceof Error ? error.message : "Quant job failed");
      }
    } finally {
      this.busy = false;
    }
  }
}
