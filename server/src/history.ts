import { cacheGet, cacheStore, staleGet } from "./cache.js";
import { withFallback } from "./providers/registry.js";
import * as binance from "./providers/binance.js";
import * as fred from "./providers/fred.js";
import * as nasdaq from "./providers/nasdaq.js";
import * as stooq from "./providers/stooq.js";
import * as yahoo from "./providers/yahoo.js";

export const HISTORY_RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
export type HistorySource = "binance" | "fred" | "nasdaq" | "yahoo" | "stooq";
export type HistoryResult = {
  candles: yahoo.Candle[];
  source: HistorySource;
  cache: "miss" | "hit" | "stale";
  fallback: boolean;
  attempts: HistorySource[];
};

export class HistoryUnavailableError extends Error {
  constructor(public readonly attempts: HistorySource[]) {
    super("All data providers are temporarily unavailable. Try again shortly.");
  }
}

export function yahooRange(rangeKey: string): { range: string; interval: string } {
  const map: Record<string, { range: string; interval: string }> = {
    "1D": { range: "1d", interval: "5m" },
    "5D": { range: "5d", interval: "15m" },
    "1M": { range: "1mo", interval: "1h" },
    "6M": { range: "6mo", interval: "1d" },
    YTD: { range: "ytd", interval: "1d" },
    "1Y": { range: "1y", interval: "1d" },
    "5Y": { range: "5y", interval: "1wk" },
    MAX: { range: "max", interval: "1mo" },
  };
  return map[rangeKey] ?? map["6M"];
}

function normalize(candles: yahoo.Candle[]): yahoo.Candle[] {
  if (!Array.isArray(candles)) throw new Error("invalid history");
  const byTime = new Map<number, yahoo.Candle>();
  for (const candle of candles) {
    if (!candle) continue;
    const { time, open, high, low, close, volume } = candle;
    if (![time, open, high, low, close, volume].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    if (!Number.isSafeInteger(time * 1000) || time < 0 || time * 1000 > 8.64e15 || volume < 0) continue;
    if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) continue;
    byTime.set(time, { time, open, high, low, close, volume });
  }
  if (byTime.size === 0) throw new Error("empty history");
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

async function vixHistory(rangeKey: string): Promise<yahoo.Candle[]> {
  const counts: Record<string, number> = { "1D": 5, "5D": 5, "1M": 22, "6M": 130, YTD: 200, "1Y": 252, "5Y": 1260, MAX: 20_000 };
  const points = await fred.series("VIXCLS", counts[rangeKey] ?? 130);
  return points.map((point) => ({
    time: new Date(point.date + "T00:00:00Z").getTime() / 1000,
    open: point.value,
    high: point.value,
    low: point.value,
    close: point.value,
    volume: 0,
  }));
}

export async function getHistory(symbol: string, rangeKey: string): Promise<HistoryResult> {
  symbol = symbol.toUpperCase();
  const key = `history:${symbol}:${rangeKey}`;
  const hit = cacheGet<HistoryResult>(key);
  if (hit) return { ...hit, cache: "hit" };
  const attempts: HistorySource[] = [];
  const providers: Array<[HistorySource, () => Promise<yahoo.Candle[]>]> = binance.CRYPTO_SYMBOLS.has(symbol)
    ? [["binance", () => binance.history(symbol, rangeKey)]]
    : symbol === "VIX" || symbol === "^VIX"
    ? [["fred", () => vixHistory(rangeKey)]]
    : [
        ["nasdaq", () => nasdaq.history(symbol, rangeKey)],
        ["yahoo", () => yahoo.history(symbol, yahooRange(rangeKey).range, yahooRange(rangeKey).interval)],
        ["stooq", () => stooq.history(symbol)],
      ];
  try {
    const result = await withFallback<HistoryResult>(providers.map(([source, load]) => [source, async () => {
      attempts.push(source);
      const candles = normalize(await load());
      return { candles, source, cache: "miss", fallback: attempts.length > 1, attempts: [...attempts] };
    }]));
    cacheStore(key, result, 20_000);
    return result;
  } catch {
    const stale = staleGet<HistoryResult>(key);
    if (stale) return { ...stale, cache: "stale", fallback: true, attempts };
    throw new HistoryUnavailableError(attempts);
  }
}
