import {
    registerNativeIndicator,
    registerRendererLayer,
    stableSeriesId,
    type NativeIndicator,
    type NativeIndicatorContext,
    type LineLikeSeries,
    type RendererLayerInstance,
} from "@luxalgo/vela/plugin";
import { calculateMainFormula, MAIN_FORMULA_PERIODS } from "./main-formula";

export const MAIN_FORMULA_TYPE = "signaldeck-main-formula";
const COLORS = ["#FFFFFF", "#00FFFF", "#FFFF00", "#FF00FF", "#FF0000", "#FFCC66", "#FF6600"];
let registered = false;
type SurgeBody = { time: number; open: number; close: number };

function createBodyLayer(): RendererLayerInstance {
    let canvas: HTMLCanvasElement | null = null;
    let paint: CanvasRenderingContext2D | null = null;
    return {
        mount(element) { canvas = element; paint = element.getContext("2d"); },
        render({ data, coords, bounds, scale }) {
            if (!canvas || !paint) return;
            const dpr = coords.dpr;
            paint.setTransform(dpr, 0, 0, dpr, 0, 0);
            paint.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            if (!Array.isArray(data)) return;
            paint.save();
            paint.beginPath();
            paint.rect(0, bounds.top, coords.width, bounds.height);
            paint.clip();
            paint.fillStyle = "#FFFF00";
            const width = Math.max(1 / dpr, Math.floor(coords.bodySpacing() * 0.7));
            for (const body of data as SurgeBody[]) {
                if (!body || ![body.time, body.open, body.close].every(Number.isFinite)) continue;
                const x = coords.timeToX(body.time);
                const open = coords.priceToY(body.open, scale, bounds);
                const close = coords.priceToY(body.close, scale, bounds);
                if (![x, open, close].every(Number.isFinite) || x + width / 2 < 0 || x - width / 2 > coords.width) continue;
                paint.fillRect(x - width / 2, Math.min(open, close), width, Math.max(1 / dpr, Math.abs(close - open)));
            }
            paint.restore();
        },
        destroy() { canvas = null; paint = null; },
    };
}

function createIndicator(): NativeIndicator {
    let ctx: NativeIndicatorContext | null = null;
    let suspended = false;
    const compute = () => {
        if (!ctx || suspended) return;
        const bars = ctx.bars();
        const result = calculateMainFormula(bars.map((bar) => ({ ...bar, volume: bar.volume ?? 0 })));
        const plots = [
            ...MAIN_FORMULA_PERIODS.map((period, index) => ({ title: `MA${period}`, values: result.ma[period], color: COLORS[index], dotted: false })),
            { title: "压力", values: result.pressure, color: "#FFFF00", dotted: true },
            { title: "支撑", values: result.support, color: "#00FF00", dotted: true },
        ];
        const series: LineLikeSeries[] = plots.map((plot, ordinal) => ({
            id: stableSeriesId({ instanceId: ctx!.id, kind: "line", title: plot.title, ordinal }),
            paneId: "", title: plot.title, kind: "line", overlay: true,
            points: bars.map((bar, index) => ({ time: bar.time, value: plot.values[index] ?? null })),
            style: { color: plot.color, width: 1, lineStyle: plot.dotted ? "dotted" : "solid" },
        }));
        ctx.emit({ series });
        ctx.pushData(bars.flatMap((bar, index) => result.surge[index] ? [{ time: bar.time, open: bar.open, close: bar.close }] : []));
    };
    return {
        start(context) { ctx = context; suspended = false; compute(); },
        onBars: compute,
        onViewport() {},
        setInputs: compute,
        suspend() { suspended = true; ctx?.pushData([]); },
        resume() { suspended = false; compute(); },
        stop() { ctx?.pushData([]); ctx = null; },
    };
}

export function registerMainFormula(): void {
    if (registered) return;
    registerRendererLayer({ id: MAIN_FORMULA_TYPE, placement: "above-data", create: createBodyLayer });
    registerNativeIndicator({
        type: MAIN_FORMULA_TYPE,
        title: "内置主图 · 当前周期 / Main formula · current timeframe · ≥8.5% adjacent bar",
        paneHint: "price", overlay: true,
        inputsSchema: () => [], defaultInputs: () => ({}), create: createIndicator,
    });
    registered = true;
}
