import { z } from "zod";
import { dateSchema } from "./calendar.js";
import type { JobInput } from "./store.js";
import type { SignalsResult } from "./types.js";
import { codeSchema } from "./validation.js";

export class QuantError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
  }
}

const signalSchema = z.object({
  code: codeSchema, key: z.enum(["ma_cross", "macd_cross", "breakout"]),
  name: z.string(), type: z.literal("buy"), date: dateSchema, price: z.number().finite().positive(),
});
const failuresSchema = z.array(z.object({ code: z.string(), error: z.string() }));
const signalsSchema = z.object({ signals: z.array(signalSchema), failures: failuresSchema });

export interface QuantClient {
  health(): Promise<unknown>;
  formulas(): Promise<unknown>;
  strategies(): Promise<unknown>;
  quotes(codes: string[]): Promise<unknown>;
  history(code: string, count: number): Promise<unknown>;
  execute(job: JobInput): Promise<unknown>;
  signals(codes: string[]): Promise<SignalsResult>;
}

export async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new QuantError("Quant request timed out", 504));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class PythonClient implements QuantClient {
  private readonly base: string;

  constructor(base = process.env.QUANT_URL ?? "http://127.0.0.1:8010", private readonly timeoutMs = 30_000, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("Invalid QUANT_URL");
    }
    this.base = base.replace(/\/$/, "");
  }

  health(): Promise<unknown> {
    return this.request("/health", undefined, z.object({ status: z.literal("ok"), source: z.string(), market_verified: z.boolean() }));
  }

  formulas(): Promise<unknown> {
    return this.catalog("/formulas");
  }

  strategies(): Promise<unknown> {
    return this.catalog("/strategies");
  }

  quotes(codes: string[]): Promise<unknown> {
    return this.request("/quotes", { codes }, z.array(z.object({ code: codeSchema, name: z.string(), price: z.number().finite().positive(), source: z.string(), as_of: z.string().datetime({ offset: true }), stale: z.boolean() }))
      .refine((rows) => rows.length === codes.length && new Set(rows.map((row) => row.code)).size === codes.length && rows.every((row) => codes.includes(row.code))));
  }

  history(code: string, count: number): Promise<unknown> {
    return this.request("/history", { code, count }, z.object({ code: z.string(), source: z.string(), adjustment: z.literal("qfq"), bars: z.array(z.object({
      date: dateSchema, open: z.number().finite(), high: z.number().finite(), low: z.number().finite(), close: z.number().finite(), volume: z.number().finite(),
    })) }));
  }

  execute(job: JobInput): Promise<unknown> {
    return this.request<unknown>(`/${job.kind}`, job.params, job.kind === "screen"
      ? z.object({ hits: z.array(z.object({ code: z.string(), formula: z.string(), date: dateSchema, price: z.number().finite() })), failures: failuresSchema })
      : z.object({
        code: codeSchema, source: z.string(), adjustment: z.literal("qfq"), strategy: z.string(),
        init_capital: z.number().finite().positive(), final_equity: z.number().finite(), total_return: z.number().finite(),
        max_drawdown: z.number().finite().min(0).max(1), cash: z.number().finite(), position_shares: z.number().int().min(0),
        trades: z.array(z.object({ type: z.enum(["buy", "sell"]), signal_date: dateSchema, date: dateSchema,
          price: z.number().finite().positive(), shares: z.number().int().positive(), commission: z.number().finite().min(0), stamp_tax: z.number().finite().min(0) })),
        equity_curve: z.array(z.object({ date: dateSchema, equity: z.number().finite() })).min(1), limitations: z.array(z.string()),
      }));
  }

  signals(codes: string[]): Promise<SignalsResult> {
    return this.request("/signals", { codes }, signalsSchema);
  }

  private catalog(path: string): Promise<unknown> {
    return this.request(path, undefined, z.array(z.object({ key: z.string(), name: z.string(), min_history: z.number().int().positive() })));
  }

  private async request<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    try {
      return await withTimeout(async (signal) => {
        const response = await this.fetcher(this.base + path, {
          method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body), signal, redirect: "error",
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          const error = z.object({ error: z.string().max(2000) }).safeParse(payload);
          throw new QuantError(error.success ? error.data.error : "Quant service unavailable", response.status === 422 ? 400 : 502);
        }
        const parsed = schema.safeParse(payload);
        if (!parsed.success) throw new QuantError("Invalid quant service response");
        return parsed.data;
      }, this.timeoutMs);
    } catch (error) {
      if (error instanceof QuantError) throw error;
      throw new QuantError("Quant service unavailable");
    }
  }
}
