import { aggregateBars, timeframeMillis, type Bar, type HistoryRequest } from "./types";

const END = Date.UTC(2026, 9, 27);

export function fixtureBars({ symbol, range, timeframe }: HistoryRequest): Bar[] {
    const duration = { "1D": 1, "5D": 5, "1M": 30, "6M": 183, YTD: 300, "1Y": 365, "5Y": 1826, MAX: 3652 }[range] * 86_400_000;
    const step = timeframe === "1M" || timeframe === "1W" ? 86_400_000 : timeframeMillis(timeframe);
    const count = Math.min(10_000, Math.max(1, Math.ceil(duration / step)));
    let seed = [...symbol].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 17);
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4_294_967_296;
    };
    let close = 80 + random() * 120;
    const bars: Bar[] = [];
    for (let i = 0; i < count; i++) {
        const open = close;
        close = Math.max(1, open * (1 + (random() - 0.48) * 0.025));
        bars.push({
            time: END - (count - 1 - i) * step,
            open, close,
            high: Math.max(open, close) * (1 + random() * 0.01),
            low: Math.min(open, close) * (1 - random() * 0.01),
            volume: Math.floor(100_000 + random() * 900_000),
        });
    }
    return aggregateBars(bars, timeframe);
}
