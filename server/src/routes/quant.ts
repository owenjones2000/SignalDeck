import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireApiKey } from "../auth.js";
import { QuantError, type QuantClient } from "../quant/client.js";
import { QuantStore } from "../quant/store.js";
import { AlertScheduler } from "../quant/scheduler.js";
import type { Channel } from "../quant/types.js";
import { alertSchema, codeSchema, codesSchema, countSchema, jobSchema } from "../quant/validation.js";

export interface QuantRouterOptions {
  store: QuantStore;
  client: QuantClient;
  scheduler: AlertScheduler;
  channels: () => Record<Channel, boolean>;
}

export function createQuantRouter({ store, client, scheduler, channels }: QuantRouterOptions): Router {
  const router = Router();
  router.use(requireApiKey);
  const handle = (operation: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response) => {
    Promise.resolve().then(() => operation(req, res)).catch((error: unknown) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues.map((issue) => issue.message).join("; ") });
      } else if (error instanceof QuantError) {
        res.status(error.status).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Quant operation failed" });
      }
    });
  };
  const notFound = (res: Response) => res.status(404).json({ error: "Not found" });

  router.get("/status", handle(async (_req, res) => {
    try {
      const health = await client.health();
      res.json({ available: true, health, channels: channels(), scheduler: scheduler.status() });
    } catch (error) {
      res.json({ available: false, error: error instanceof QuantError ? error.message : "Quant service unavailable", channels: channels(), scheduler: scheduler.status() });
    }
  }));
  router.get("/formulas", handle(async (_req, res) => res.json(await client.formulas())));
  router.get("/strategies", handle(async (_req, res) => res.json(await client.strategies())));
  router.get("/watchlist", handle((_req, res) => res.json(store.listWatchlist())));
  router.post("/watchlist", handle((req, res) => {
    const { code } = z.object({ code: codeSchema }).strict().parse(req.body);
    try {
      store.addWatchlist(code);
      res.status(201).json({ code });
    } catch {
      res.status(409).json({ error: "Watchlist limit is 100 codes" });
    }
  }));
  router.delete("/watchlist/:code", handle((req, res) => {
    store.deleteWatchlist(codeSchema.parse(req.params.code));
    res.status(204).end();
  }));
  router.get("/quotes", handle(async (req, res) => {
    const query = z.object({ codes: z.string().optional() }).strict().parse(req.query);
    const codes = query.codes === undefined ? store.listWatchlist().map((item) => item.code) : codesSchema.parse(query.codes.split(","));
    res.json(codes.length ? await client.quotes(codes) : []);
  }));
  router.get("/history/:code", handle(async (req, res) => {
    const { count } = z.object({ count: z.string().regex(/^\d+$/).transform(Number).pipe(countSchema).optional() }).strict().parse(req.query);
    res.json(await client.history(codeSchema.parse(req.params.code), count ?? 250));
  }));
  router.get("/jobs", handle((_req, res) => res.json(store.listJobs())));
  router.get("/jobs/:id", handle((req, res) => {
    const job = store.getJob(req.params.id);
    return job ? res.json(job) : notFound(res);
  }));
  router.post("/jobs", handle((req, res) => res.status(202).json(store.createJob(jobSchema.parse(req.body)))));
  router.get("/alerts", handle((_req, res) => res.json(store.listAlerts())));
  router.post("/alerts", handle((req, res) => {
    const input = alertSchema.parse(req.body);
    if (!channels()[input.channel]) return res.status(400).json({ error: "Notification channel is not configured" });
    if (store.listAlerts().length >= 100) return res.status(409).json({ error: "Alert limit is 100" });
    return res.status(201).json(store.createAlert(input));
  }));
  router.patch("/alerts/:id", handle((req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const alert = store.setAlertEnabled(req.params.id, enabled);
    return alert ? res.json(alert) : notFound(res);
  }));
  router.delete("/alerts/:id", handle((req, res) => store.deleteAlert(req.params.id) ? res.status(204).end() : notFound(res)));
  router.post("/alerts/:id/test", handle(async (req, res) => {
    if (!store.getAlert(req.params.id)) return notFound(res);
    z.object({}).strict().parse(req.body ?? {});
    return res.json(await scheduler.testAlert(req.params.id));
  }));
  router.get("/notifications", handle((_req, res) => res.json(store.listNotifications())));
  return router;
}
