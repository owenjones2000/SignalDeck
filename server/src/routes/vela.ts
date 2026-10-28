import { Router } from "express";
import type { Response } from "express";
import { getHistory, HISTORY_RANGES, HistoryUnavailableError } from "../history.js";
import type { HistoryResult } from "../history.js";

export type VelaCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const fixture: VelaCandle[] = [
  { timestamp: 1704067200000, open: 100, high: 103, low: 99, close: 102, volume: 1000 },
  { timestamp: 1704153600000, open: 102, high: 104, low: 100, close: 101, volume: 1200 },
  { timestamp: 1704240000000, open: 101, high: 106, low: 101, close: 105, volume: 1500 },
];

export const velaRouter = Router();

function diagnostics(res: Response, mode: string, result?: HistoryResult, attempts: string[] = []): void {
  res.set({
    "X-Vela-Time-Unit": "ms",
    "X-Vela-Mode": mode,
    "X-Vela-Source": result?.source ?? (mode === "fixture" ? "fixture" : "unavailable"),
    "X-Vela-Cache": result?.cache ?? "none",
    "X-Vela-Fallback": String(result?.fallback ?? false),
    "X-Vela-Attempts": (result?.attempts ?? attempts).join(","),
  });
}

velaRouter.get("/history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.trim().toUpperCase();
  const range = req.query.range ?? "6M";
  const mode = req.query.mode ?? "live";
  if (!/^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/.test(symbol)) {
    return res.status(400).json({ error: "invalid symbol" });
  }
  if (typeof range !== "string" || !HISTORY_RANGES.some((value) => value === range)) {
    return res.status(400).json({ error: "invalid range", allowed: HISTORY_RANGES });
  }
  if (mode !== "live" && mode !== "fixture") {
    return res.status(400).json({ error: "invalid mode", allowed: ["live", "fixture"] });
  }
  if (mode === "fixture") {
    diagnostics(res, mode);
    return res.json(fixture);
  }
  try {
    const result = await getHistory(symbol, range);
    diagnostics(res, mode, result);
    const candles: VelaCandle[] = result.candles.map(({ time, open, high, low, close, volume }) => ({
      timestamp: time * 1000,
      open,
      high,
      low,
      close,
      volume,
    }));
    return res.json(candles);
  } catch (error) {
    diagnostics(res, mode, undefined, error instanceof HistoryUnavailableError ? error.attempts : []);
    return res.status(502).json({ error: "All data providers are temporarily unavailable. Try again shortly." });
  }
});
