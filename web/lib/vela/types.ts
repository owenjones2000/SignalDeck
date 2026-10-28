export const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
export const TIMEFRAMES = ["1", "5", "15", "60", "240", "1D", "1W", "1M"] as const;
export const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
export const INDICATORS = ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP", "BOLL", "RSI", "MACD"] as const;
export type Indicator = (typeof INDICATORS)[number];
export const DEFAULT_PINE = `${"/".repeat(2)}@version=6
indicator("SMA 20", overlay=true)
plot(ta.sma(close, 20), color=color.orange, linewidth=2)`;

export type Range = (typeof RANGES)[number];
export type Timeframe = (typeof TIMEFRAMES)[number];
export type ChartType = (typeof CHART_TYPES)[number];
export type HistoryMode = "live" | "fixture";
export type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Attempt = { source: string; status: "success" | "error"; error?: string; cache?: "hit" | "miss" | "stale" | "none" | "unknown" };
export type HistoryResult = {
    bars: Bar[];
    source: string | null;
    mode: HistoryMode;
    timeframe: Timeframe;
    attempts: Attempt[];
};
export type HistoryRequest = { symbol: string; range: Range; mode: HistoryMode; timeframe: Timeframe };

export const DEFAULT_TIMEFRAME: Record<Range, Timeframe> = {
    "1D": "5", "5D": "15", "1M": "60", "6M": "1D", YTD: "1D", "1Y": "1D", "5Y": "1W", MAX: "1M",
};

export function timeframeMillis(timeframe: Timeframe): number {
    if (timeframe === "1D") return 86_400_000;
    if (timeframe === "1W") return 604_800_000;
    if (timeframe === "1M") return 2_592_000_000;
    return Number(timeframe) * 60_000;
}

export function normalizeBars(value: unknown, unit: "seconds" | "milliseconds"): Bar[] {
    if (!Array.isArray(value)) throw new Error("行情数据不是数组");
    const bars = new Map<number, Bar>();
    for (const row of value) {
        if (!row || typeof row !== "object") continue;
        const { time, open, high, low, close, volume = 0 } = row;
        if (![time, open, high, low, close, volume].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
        if (time <= 0 || volume < 0 || low > Math.min(open, close) || high < Math.max(open, close) || low > high) continue;
        const timestamp = unit === "seconds" ? time * 1000 : time;
        bars.set(timestamp, { time: timestamp, open, high, low, close, volume });
    }
    const result = [...bars.values()].sort((a, b) => a.time - b.time);
    if (!result.length) throw new Error("行情源没有有效 OHLCV 数据");
    return result;
}

export function aggregateBars(bars: Bar[], timeframe: Timeframe): Bar[] {
    const grouped = new Map<number, Bar>();
    for (const bar of bars) {
        const date = new Date(bar.time);
        const time = timeframe === "1M"
            ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
            : timeframe === "1W"
                ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (date.getUTCDay() + 6) % 7)
                : Math.floor(bar.time / timeframeMillis(timeframe)) * timeframeMillis(timeframe);
        const previous = grouped.get(time);
        grouped.set(time, previous
            ? { ...previous, high: Math.max(previous.high, bar.high), low: Math.min(previous.low, bar.low), close: bar.close, volume: previous.volume + bar.volume }
            : { ...bar, time });
    }
    return [...grouped.values()].sort((a, b) => a.time - b.time);
}
