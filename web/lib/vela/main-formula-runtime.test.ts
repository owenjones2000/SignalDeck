import { Vela, type IChartRenderer, type IndicatorModel } from "@luxalgo/vela";
import { describe, expect, it, vi } from "vitest";
import { MAIN_FORMULA_TYPE, registerMainFormula } from "./main-formula-indicator";

function renderer() {
    const mountIndicator = vi.fn((model: IndicatorModel) => ({ id: model.id }));
    const port: IChartRenderer = {
        name: "formula-test", features: [],
        capabilities: { panes: true, paneManagement: false, fills: "native", bgcolor: "native", hline: "native", markers: true, barcolor: "native", perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: false },
        applyFeature() {}, readFeature() {}, mount() {}, setTheme() {}, resize() {}, destroy() {},
        setBars() {}, updateBar() {}, ensurePane() {}, removePane() {},
        mountIndicator, updateIndicator: vi.fn(), removeIndicator: vi.fn(), setIndicatorInputs() {},
        onInputChange: () => () => {}, onRemoveIndicator: () => () => {},
        onCrosshairMove: () => () => {}, onClick: () => () => {},
        getVisibleRange: () => null, setVisibleRange() {}, onViewportChange: () => () => {},
        setNativeData: vi.fn(),
    };
    return { port, mountIndicator };
}

describe("已安装 Vela 原生公式生命周期", () => {
    it.each([[20, 21.7], [10, 10.85]])("真实 Vela 输出 %s→%s 黄色实体且排除略低门槛", async (previous, close) => {
        registerMainFormula();
        const target = renderer();
        const bars = [previous, close, previous, close - 1e-12].map((value, index) => ({ time: (index + 1) * 60_000, open: value, high: 30, low: 0, close: value, volume: 1 }));
        const chart = new Vela({} as HTMLElement, { data: bars, live: false, volume: false, drawings: false }, { renderer: target.port });
        try {
            await chart.ready();
            chart.addNativeIndicator(MAIN_FORMULA_TYPE);
            await vi.waitFor(() => expect(target.port.setNativeData).toHaveBeenCalledWith(MAIN_FORMULA_TYPE, [{ time: 120_000, open: close, close }]));
        } finally {
            chart.destroy();
        }
    });

    it("真实 Vela addNativeIndicator 挂载系列，setMarket 重算，remove 清理且不影响 SMA", async () => {
        registerMainFormula();
        const target = renderer();
        const bars = Array.from({ length: 200 }, (_, index) => ({ time: (index + 1) * 60_000, open: 100, high: 120, low: 90, close: index === 199 ? 109 : 100, volume: 1 }));
        const chart = new Vela({} as HTMLElement, { data: bars, symbol: "FIRST", timeframe: "5", live: false, volume: false, drawings: false }, { renderer: target.port });
        try {
            await chart.ready();
            const formula = chart.addNativeIndicator(MAIN_FORMULA_TYPE);
            const sma = chart.addNativeIndicator("sma", { inputs: { length: 5 } });
            await vi.waitFor(() => expect(chart.inspect().totals.series).toBe(10));
            expect(formula.nativeType).toBe(MAIN_FORMULA_TYPE);
            expect(formula.source).toBeUndefined();
            expect(target.port.setNativeData).toHaveBeenCalledWith(MAIN_FORMULA_TYPE, [{ time: 12_000_000, open: 100, close: 109 }]);
            const mounted = target.mountIndicator.mock.calls.find(([model]) => model.id === formula.id)![0];
            expect(mounted.series).toHaveLength(9);
            await chart.setMarket({ symbol: "SECOND", timeframe: "1D", data: [{ time: 60_000, open: 5, high: 5, low: 5, close: 5, volume: 1 }] });
            expect(chart.presentNativeIndicators()).toContain(MAIN_FORMULA_TYPE);
            expect(target.port.setNativeData).toHaveBeenLastCalledWith(MAIN_FORMULA_TYPE, []);
            formula.remove();
            expect(chart.presentNativeIndicators()).toEqual(["sma"]);
            expect(chart.indicators().map((handle) => handle.id)).toEqual([sma.id]);
            await chart.setMarket({ symbol: "THIRD", timeframe: "5", data: bars });
            expect(chart.presentNativeIndicators()).toEqual(["sma"]);
            expect(chart.inspect().totals.series).toBe(1);
        } finally {
            chart.destroy();
        }
    });
});
