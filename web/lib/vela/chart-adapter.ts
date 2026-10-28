import { Vela, type IndicatorHandle } from "@luxalgo/vela";
import { createPineAdapter } from "./pine-adapter";
import type { Bar, ChartType, Indicator, Timeframe } from "./types";

export function createChartAdapter(container: HTMLElement, onHover: (bar: Bar | null) => void) {
    const chart = new Vela(container, { data: [], live: false, theme: "dark", nativeBackend: "auto", drawings: false, height: "100%", animations: false });
    const pine = createPineAdapter(chart);
    const indicators = new Map<Indicator, IndicatorHandle>();
    let bars: Bar[] = [];
    let destroyed = false;
    const unsubscribe = chart.renderer.onCrosshairMove((event) => {
        onHover(bars.find((bar) => bar.time === event.time) ?? bars.at(-1) ?? null);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);

    return {
        async setMarket(symbol: string, timeframe: Timeframe, next: Bar[]) {
            bars = next;
            await chart.setMarket({ symbol, timeframe, data: next });
            if (destroyed) return;
            onHover(bars.at(-1) ?? null);
        },
        setStyle(style: ChartType) {
            chart.renderer.set("priceStyle", style);
        },
        setIndicators(active: ReadonlySet<Indicator>) {
            for (const [key, handle] of indicators) {
                if (!active.has(key)) {
                    handle.remove();
                    indicators.delete(key);
                }
            }
            for (const key of active) {
                if (indicators.has(key)) continue;
                const type = { SMA20: "sma", SMA50: "sma", SMA200: "sma", EMA20: "ema", VWAP: "vwap", BOLL: "bollinger-bands", RSI: "rsi", MACD: "macd" }[key];
                const length = key.startsWith("SMA") || key.startsWith("EMA") ? Number(key.slice(3)) : undefined;
                indicators.set(key, chart.addNativeIndicator(type, { inputs: length ? { length } : undefined }));
            }
        },
        runPine: pine.run,
        clearPine: pine.clear,
        destroy() {
            destroyed = true;
            observer.disconnect();
            unsubscribe();
            pine.destroy();
            chart.destroy();
        },
    };
}

export type ChartAdapter = ReturnType<typeof createChartAdapter>;
