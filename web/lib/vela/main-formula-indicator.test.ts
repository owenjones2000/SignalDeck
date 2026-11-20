import { describe, expect, it, vi } from "vitest";
import { getNativeIndicator, rendererLayers, type NativeIndicatorContext, type NativeIndicatorOutput, type RendererLayerArgs } from "@luxalgo/vela/plugin";
import { MAIN_FORMULA_TYPE, registerMainFormula } from "./main-formula-indicator";
import type { Bar } from "./types";

function context(initial: Bar[]) {
    let bars = initial;
    const emit = vi.fn<(output: NativeIndicatorOutput) => void>();
    const pushData = vi.fn();
    const ctx: NativeIndicatorContext = {
        id: "formula-test", symbol: "TEST", timeframe: "5", live: false,
        bars: () => bars, emit, pushData, setStatus: vi.fn(),
        data: {} as NativeIndicatorContext["data"],
    };
    return { ctx, emit, pushData, replace: (next: Bar[]) => { bars = next; } };
}

describe("Vela 公开原生主图公式", () => {
    it("公开注册独立 overlay，输出七 MA 和两条点线，缺失保留空槽", () => {
        registerMainFormula();
        const descriptor = getNativeIndicator(MAIN_FORMULA_TYPE)!;
        expect(descriptor).toMatchObject({ overlay: true, paneHint: "price" });
        const source = context(Array.from({ length: 200 }, (_, index) => ({ time: index + 1, open: 5, close: 5, high: 10, low: 0, volume: 1 })));
        const indicator = descriptor.create();
        indicator.start(source.ctx, {});
        const series = source.emit.mock.lastCall![0].series!;
        expect(series.map((item) => item.title)).toEqual(["MA5", "MA10", "MA15", "MA30", "MA50", "MA100", "MA200", "压力", "支撑"]);
        expect(series.map((item) => "points" in item ? item.style.color : null)).toEqual(["#FFFFFF", "#00FFFF", "#FFFF00", "#FF00FF", "#FF0000", "#FFCC66", "#FF6600", "#FFFF00", "#00FF00"]);
        expect(series.slice(7).map((item) => "points" in item ? item.style.lineStyle : null)).toEqual(["dotted", "dotted"]);
        expect(series[0]).toMatchObject({ kind: "line", points: [{ time: 1, value: null }, { time: 2, value: null }, { time: 3, value: null }, { time: 4, value: null }, ...Array.from({ length: 196 }, (_, index) => ({ time: index + 5, value: 5 }))] });
        expect(source.pushData).toHaveBeenLastCalledWith([]);
        const ids = series.map((item) => item.id);
        indicator.onBars();
        expect(source.emit.mock.lastCall![0].series!.map((item) => item.id)).toEqual(ids);
        expect(new Set(ids).size).toBe(9);
        expect(rendererLayers().filter((layer) => layer.id === MAIN_FORMULA_TYPE)).toHaveLength(1);
    });

    it("大涨实体按时间、O/C、DPR 和实时 bar 宽绘制，空数据清屏且不画影线", () => {
        registerMainFormula();
        const bars = [
            { time: 60_000, open: 100, close: 100, high: 120, low: 90, volume: 1 },
            { time: 120_000, open: 110, close: 108.5, high: 120, low: 90, volume: 1 },
        ];
        const source = context(bars);
        getNativeIndicator(MAIN_FORMULA_TYPE)!.create().start(source.ctx, {});
        expect(source.pushData).toHaveBeenLastCalledWith([{ time: 120_000, open: 110, close: 108.5 }]);
        const layer = rendererLayers().find((item) => item.id === MAIN_FORMULA_TYPE)!.create();
        const paint = { clearRect: vi.fn(), setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillStyle: "" };
        layer.mount({ width: 400, height: 200, getContext: () => paint } as unknown as HTMLCanvasElement);
        let spacing = 10;
        const args = {
            bars, data: source.pushData.mock.lastCall![0], priceStyle: "candles",
            bounds: { top: 10, height: 80 }, scale: { min: 90, max: 120 },
            coords: { dpr: 2, width: 200, bodySpacing: () => spacing, timeToX: (time: number) => time / 1000, priceToY: (price: number) => 120 - price },
        } as unknown as RendererLayerArgs;
        layer.render(args);
        expect(paint.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
        expect(paint.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
        expect(paint.rect).toHaveBeenCalledWith(0, 10, 200, 80);
        expect(paint.fillStyle).toBe("#FFFF00");
        expect(paint.fillRect).toHaveBeenLastCalledWith(116.5, 10, 7, 1.5);
        spacing = 20;
        layer.render(args);
        expect(paint.fillRect).toHaveBeenLastCalledWith(113, 10, 14, 1.5);
        const draws = paint.fillRect.mock.calls.length;
        layer.render({ ...args, data: undefined });
        layer.render({ ...args, data: [{ time: 120_000, open: NaN, close: 108.5 }] });
        expect(paint.fillRect).toHaveBeenCalledTimes(draws);
        layer.destroy?.();
        layer.render(args);
        expect(paint.fillRect).toHaveBeenCalledTimes(draws);
    });

    it("暂停和停止清除实体通道，恢复读取新行情，证券实例互不串值", () => {
        registerMainFormula();
        const source = context([
            { time: 1, open: 100, close: 100, high: 110, low: 90, volume: 1 },
            { time: 2, open: 100, close: 109, high: 110, low: 90, volume: 1 },
        ]);
        const first = getNativeIndicator(MAIN_FORMULA_TYPE)!.create();
        first.start(source.ctx, {});
        first.suspend();
        expect(source.pushData).toHaveBeenLastCalledWith([]);
        const calls = source.emit.mock.calls.length;
        source.replace([{ time: 3, open: 5, close: 5, high: 5, low: 5, volume: 1 }]);
        first.onBars();
        first.setInputs({});
        expect(source.emit).toHaveBeenCalledTimes(calls);
        first.resume();
        expect(source.pushData).toHaveBeenLastCalledWith([]);
        expect(source.emit.mock.lastCall![0].series![0]).toMatchObject({ points: [{ time: 3, value: null }] });
        first.stop();
        expect(source.pushData).toHaveBeenLastCalledWith([]);
        const stopped = source.emit.mock.calls.length;
        first.onBars();
        first.resume();
        expect(source.emit).toHaveBeenCalledTimes(stopped);
        const other = context(Array.from({ length: 5 }, (_, index) => ({ time: index + 1, open: 8, close: 8, high: 10, low: 0, volume: 1 })));
        const second = getNativeIndicator(MAIN_FORMULA_TYPE)!.create();
        second.start(other.ctx, {});
        expect(other.emit.mock.lastCall![0].series![0]).toMatchObject({ points: [{ time: 1, value: null }, { time: 2, value: null }, { time: 3, value: null }, { time: 4, value: null }, { time: 5, value: 8 }] });
        second.stop();
    });
});
