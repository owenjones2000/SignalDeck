import type { IChartRenderer, IndicatorModel, Vela } from "@luxalgo/vela";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChartAdapter } from "./chart-adapter";
import { MAIN_FORMULA_TYPE } from "./main-formula-indicator";

const runtime = vi.hoisted(() => ({
    chart: null as Vela | null,
    remove: null as null | ((id: string) => void),
    visibility: null as null | ((id: string, visible: boolean) => void),
    nativeData: vi.fn(),
}));

vi.mock("@luxalgo/vela", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@luxalgo/vela")>();
    const port: IChartRenderer = {
        name: "adapter-runtime", features: [],
        capabilities: { panes: true, paneManagement: false, fills: "native", bgcolor: "native", hline: "native", markers: true, barcolor: "native", perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: false },
        applyFeature() {}, readFeature() {}, mount() {}, setTheme() {}, resize() {}, destroy() {},
        setBars() {}, updateBar() {}, ensurePane() {}, removePane() {},
        mountIndicator: (model: IndicatorModel) => ({ id: model.id }), updateIndicator() {}, removeIndicator() {}, setIndicatorInputs() {},
        onInputChange: () => () => {}, onRemoveIndicator: (callback) => { runtime.remove = callback; return () => {}; },
        onToggleIndicatorVisible: (callback) => { runtime.visibility = callback; return () => {}; },
        onCrosshairMove: () => () => {}, onClick: () => () => {},
        getVisibleRange: () => null, setVisibleRange() {}, onViewportChange: () => () => {},
        setNativeData: runtime.nativeData,
    };
    return { ...actual, Vela: class extends actual.Vela {
        constructor(container: HTMLElement, options: ConstructorParameters<typeof actual.Vela>[1]) {
            super(container, { ...options, volume: false }, { renderer: port });
            runtime.chart = this;
        }
    } };
});

vi.mock("./pine-adapter", () => ({ createPineAdapter: () => ({ run: vi.fn(), clear: vi.fn(), destroy: vi.fn() }) }));

describe("真实 Vela 图例与 adapter 回调", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    });

    it.each(["remove", "visibility"] as const)("图例 %s 清理主图、通知 UI，行情切换不复活，重新开启恢复", async (action) => {
        const notify = vi.fn();
        const adapter = createChartAdapter({} as HTMLElement, vi.fn(), notify);
        try {
            const bars = [20, 21.7].map((close, index) => ({ time: (index + 1) * 60_000, open: close, high: 30, low: 0, close, volume: 1 }));
            await adapter.setMarket("FIRST", "5", bars);
            const chart = runtime.chart!;
            const formula = chart.indicators().find((handle) => handle.nativeType === MAIN_FORMULA_TYPE)!;
            const other = chart.addNativeIndicator("sma", { inputs: { length: 5 } });
            runtime[action]?.(formula.id, false);
            expect(notify).toHaveBeenCalledExactlyOnceWith(false);
            expect(chart.presentNativeIndicators()).toEqual(["sma"]);
            expect(runtime.nativeData).toHaveBeenLastCalledWith(MAIN_FORMULA_TYPE, []);
            await adapter.setMarket("SECOND", "1D", bars);
            expect(chart.indicators().map((handle) => handle.id)).toEqual([other.id]);
            adapter.setMainFormula(true);
            await vi.waitFor(() => expect(chart.inspect().totals.series).toBe(10));
            expect(chart.indicators().find((handle) => handle.nativeType === MAIN_FORMULA_TYPE)!.id).not.toBe(formula.id);
            expect(notify).toHaveBeenLastCalledWith(true);
            expect(runtime.nativeData).toHaveBeenLastCalledWith(MAIN_FORMULA_TYPE, [{ time: 120_000, open: 21.7, close: 21.7 }]);
            adapter.setMainFormula(false);
            expect(notify.mock.calls).toEqual([[false], [true], [false]]);
        } finally {
            const calls = notify.mock.calls.length;
            adapter.destroy();
            expect(notify).toHaveBeenCalledTimes(calls);
        }
    });
});
