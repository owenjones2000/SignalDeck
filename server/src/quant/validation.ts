import { z } from "zod";

export const codeSchema = z.string().regex(/^(?:[03468][0-9]{5}|92[0-9]{4})$/);
export const codesSchema = z.array(codeSchema).min(1).max(100).transform((codes) => [...new Set(codes)]);
export const countSchema = z.number().int().min(1).max(2000).default(250);
const formulas = { ma_cross: 21, macd_cross: 35, volume_breakout: 21, rsi_rebound: 16 };
const strategies = { dual_ma: 21, macd: 35, rsi: 16, bollinger: 21, breakout: 22 };

const screenSchema = z.object({
  formula: z.enum(["ma_cross", "macd_cross", "volume_breakout", "rsi_rebound"]),
  codes: codesSchema, count: countSchema,
}).strict().refine((value) => value.count >= formulas[value.formula], "Insufficient history count for formula");

const backtestSchema = z.object({
  code: codeSchema, count: countSchema, strategy: z.enum(["dual_ma", "macd", "rsi", "bollinger", "breakout"]),
  init_capital: z.number().finite().positive().default(100000),
  position_pct: z.number().finite().positive().max(1).default(1),
  commission: z.number().finite().min(0).lt(1).default(0.0003),
  stamp_tax: z.number().finite().min(0).lt(1).default(0.0005),
}).strict().refine((value) => value.count >= strategies[value.strategy], "Insufficient history count for strategy");

export const jobSchema = z.union([
  z.object({ kind: z.literal("screen"), params: screenSchema }).strict(),
  z.object({ kind: z.literal("backtest"), params: backtestSchema }).strict(),
]);

export const alertSchema = z.object({
  name: z.string().trim().min(1).max(100), codes: codesSchema,
  signal: z.enum(["ma_cross", "macd_cross", "breakout"]), enabled: z.boolean().default(true),
  interval_minutes: z.number().int().min(1).max(1440).default(5),
  channel: z.enum(["local", "feishu", "email"]).default("local"),
}).strict();
