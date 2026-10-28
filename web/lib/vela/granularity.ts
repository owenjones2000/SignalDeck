import { aggregateBars, timeframeMillis, type Bar, type Timeframe } from "./types";

export class CoarseGranularityError extends Error {}

export function adaptGranularity(bars: Bar[], timeframe: Timeframe, source: string): Bar[] {
    const target = timeframeMillis(timeframe);
    const dailySource = ["nasdaq", "stooq", "fred"].includes(source);
    if (dailySource && target < timeframeMillis("1D")) {
        throw new CoarseGranularityError(`${source} 返回日线，无法生成 ${timeframe} 分钟线`);
    }
    const gaps = bars.slice(1).map((bar, index) => bar.time - bars[index].time);
    const shortestGap = gaps.reduce((shortest, gap) => Math.min(shortest, gap), Infinity);
    if (!dailySource && gaps.length && shortestGap > target * 1.5) {
        throw new CoarseGranularityError(`${source} 返回粗粒度行情，无法生成 ${timeframe} 周期`);
    }
    if (source === "unknown" && target < timeframeMillis("1D") && !gaps.length) {
        throw new CoarseGranularityError("单条未知来源行情无法确认分钟粒度");
    }
    return timeframe === "1W" || timeframe === "1M" || timeframe === "240"
        ? aggregateBars(bars, timeframe)
        : bars;
}
