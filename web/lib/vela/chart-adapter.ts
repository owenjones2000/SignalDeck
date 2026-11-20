import { Vela, type IndicatorHandle } from "@luxalgo/vela";
import { createPineAdapter } from "./pine-adapter";
import { MAIN_FORMULA_TYPE, registerMainFormula } from "./main-formula-indicator";
import type { Bar, ChartType, Indicator, Timeframe } from "./types";

export function createChartAdapter(container: HTMLElement, onHover: (bar: Bar | null) => void, onMainFormulaChange?: (enabled: boolean) => void) {
    registerMainFormula();
    const chart = new Vela(container, { data: [], live: false, theme: "dark", nativeBackend: "auto", drawings: false, height: "100%", animations: false });
    const pine = createPineAdapter(chart);
    let mainFormula: IndicatorHandle | null = chart.addNativeIndicator(MAIN_FORMULA_TYPE);
    const indicators = new Map<Indicator, IndicatorHandle>();
    let bars: Bar[] = [];
    let destroyed = false;
    let marketGeneration = 0;
    const clearMainFormula = (remove: boolean) => {
        const handle = mainFormula;
        if (!handle) return;
        mainFormula = null;
        if (remove) handle.remove();
        onMainFormulaChange?.(false);
    };
    const unsubscribeRemoved = chart.on("indicator:removed", ({ id }) => {
        if (!destroyed && id === mainFormula?.id) clearMainFormula(false);
    });
    const unsubscribeVisibility = chart.on("indicator:visibility", ({ id, visible }) => {
        if (!destroyed && !visible && id === mainFormula?.id) clearMainFormula(true);
    });
    const unsubscribe = chart.renderer.onCrosshairMove((event) => {
        onHover(bars.find((bar) => bar.time === event.time) ?? bars.at(-1) ?? null);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);

    return {
        async setMarket(symbol: string, timeframe: Timeframe, next: Bar[]) {
            if (destroyed) return;
            const generation = ++marketGeneration;
            bars = next;
            await chart.setMarket({ symbol, timeframe, data: next });
            if (destroyed || generation !== marketGeneration) return;
            onHover(bars.at(-1) ?? null);
        },
        setStyle(style: ChartType) {
            chart.renderer.set("priceStyle", style);
        },
        setMainFormula(enabled: boolean) {
            if (destroyed) return;
            if (enabled && !mainFormula) {
                mainFormula = chart.addNativeIndicator(MAIN_FORMULA_TYPE);
                onMainFormulaChange?.(true);
            }
            if (!enabled) clearMainFormula(true);
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
            if (destroyed) return;
            destroyed = true;
            unsubscribeRemoved();
            unsubscribeVisibility();
            mainFormula?.remove();
            mainFormula = null;
            observer.disconnect();
            unsubscribe();
            pine.destroy();
            chart.destroy();
        },
    };
}

export type ChartAdapter = ReturnType<typeof createChartAdapter>;
