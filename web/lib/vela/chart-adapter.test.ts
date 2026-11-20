import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChartAdapter } from "./chart-adapter";
import { MAIN_FORMULA_TYPE } from "./main-formula-indicator";

const mocks = vi.hoisted(() => ({
    construct: vi.fn(),
    setMarket: vi.fn().mockResolvedValue(undefined), set: vi.fn(), addNativeIndicator: vi.fn(), destroy: vi.fn(),
    unsubscribe: vi.fn(), observe: vi.fn(), disconnect: vi.fn(), resize: vi.fn(),
    run: vi.fn(), clear: vi.fn(), pineDestroy: vi.fn(),
    formulaRemove: vi.fn(), otherRemove: vi.fn(),
    hover: null as null | ((event: { time: number | null }) => void),
    events: new Map<string, (event: { id: string; visible?: boolean }) => void>(),
    eventUnsubscribe: vi.fn(),
}));

vi.mock("@luxalgo/vela", () => ({ Vela: class {
    constructor(container: HTMLElement, options: unknown) { mocks.construct(container, options); }
    setMarket = mocks.setMarket;
    addNativeIndicator = mocks.addNativeIndicator;
    destroy = mocks.destroy;
    resize = mocks.resize;
    on(event: string, callback: (event: { id: string; visible?: boolean }) => void) {
        mocks.events.set(event, callback);
        return mocks.eventUnsubscribe;
    }
    renderer = { set: mocks.set, onCrosshairMove: (callback: typeof mocks.hover) => { mocks.hover = callback; return mocks.unsubscribe; } };
} }));
vi.mock("./pine-adapter", () => ({ createPineAdapter: () => ({ run: mocks.run, clear: mocks.clear, destroy: mocks.pineDestroy }) }));

describe("Vela 图表适配器", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.events.clear();
        mocks.addNativeIndicator.mockImplementation((type: string) => ({ id: type, remove: type === MAIN_FORMULA_TYPE ? mocks.formulaRemove : mocks.otherRemove }));
        vi.stubGlobal("ResizeObserver", class { observe = mocks.observe; disconnect = mocks.disconnect; });
    });

    it("原位切换数据、样式，十字光标传递匹配的毫秒 bar", async () => {
        const onHover = vi.fn();
        const container = {} as HTMLElement;
        const adapter = createChartAdapter(container, onHover);
        expect(mocks.construct).toHaveBeenCalledWith(container, expect.objectContaining({ nativeBackend: "auto" }));
        const bar = { time: 1_770_000_000_000, open: 10, high: 12, low: 9, close: 11, volume: 100 };
        await adapter.setMarket("AAPL", "1D", [bar]);
        expect(mocks.setMarket).toHaveBeenCalledWith({ symbol: "AAPL", timeframe: "1D", data: [bar] });
        adapter.setStyle("bars");
        expect(mocks.set).toHaveBeenCalledWith("priceStyle", "bars");
        mocks.hover?.({ time: bar.time });
        expect(onHover).toHaveBeenLastCalledWith(bar);
        adapter.destroy();
        expect(mocks.observe).toHaveBeenCalledWith(container);
        expect(mocks.disconnect).toHaveBeenCalledOnce();
        expect(mocks.unsubscribe).toHaveBeenCalledOnce();
        expect(mocks.pineDestroy).toHaveBeenCalledOnce();
        expect(mocks.destroy).toHaveBeenCalledOnce();
    });

    it("异步行情结束不复活已关闭公式，旧请求不覆盖最新 hover，销毁后不再请求", async () => {
        const pending: (() => void)[] = [];
        mocks.setMarket.mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
        const hover = vi.fn();
        const adapter = createChartAdapter({} as HTMLElement, hover);
        const first = { time: 1, open: 5, high: 6, low: 4, close: 5, volume: 1 };
        const second = { ...first, time: 2, close: 6 };
        const older = adapter.setMarket("FIRST", "5", [first]);
        adapter.setMainFormula(false);
        const newer = adapter.setMarket("SECOND", "1D", [second]);
        pending[1]();
        await newer;
        expect(hover).toHaveBeenCalledOnce();
        expect(hover).toHaveBeenLastCalledWith(second);
        pending[0]();
        await older;
        expect(hover).toHaveBeenCalledOnce();
        expect(mocks.addNativeIndicator.mock.calls.filter(([type]) => type === MAIN_FORMULA_TYPE)).toHaveLength(1);
        adapter.destroy();
        await adapter.setMarket("THIRD", "1D", [first]);
        expect(mocks.setMarket).toHaveBeenCalledTimes(2);
    });

    it("指标去重、使用正确原生类型并移除取消项", () => {
        const remove = vi.fn();
        mocks.addNativeIndicator.mockReturnValue({ remove });
        const adapter = createChartAdapter({} as HTMLElement, vi.fn());
        adapter.setIndicators(new Set(["SMA50", "BOLL"]));
        adapter.setIndicators(new Set(["SMA50", "BOLL"]));
        expect(mocks.addNativeIndicator.mock.calls.filter(([type]) => type !== MAIN_FORMULA_TYPE)).toHaveLength(2);
        expect(mocks.addNativeIndicator).toHaveBeenCalledWith("sma", { inputs: { length: 50 } });
        expect(mocks.addNativeIndicator).toHaveBeenCalledWith("bollinger-bands", { inputs: undefined });
        adapter.setIndicators(new Set(["SMA50"]));
        expect(remove).toHaveBeenCalledOnce();
        adapter.destroy();
    });

    it("默认启用内置公式，重复开关去重且不删除 Pine 或其他指标", () => {
        const adapter = createChartAdapter({} as HTMLElement, vi.fn());
        expect(mocks.addNativeIndicator).toHaveBeenCalledWith(MAIN_FORMULA_TYPE);
        adapter.setMainFormula(true);
        adapter.setMainFormula(true);
        expect(mocks.addNativeIndicator.mock.calls.filter(([type]) => type === MAIN_FORMULA_TYPE)).toHaveLength(1);
        adapter.setIndicators(new Set(["SMA50"]));
        adapter.setMainFormula(false);
        adapter.setMainFormula(false);
        expect(mocks.formulaRemove).toHaveBeenCalledOnce();
        expect(mocks.otherRemove).not.toHaveBeenCalled();
        expect(mocks.clear).not.toHaveBeenCalled();
        adapter.setMainFormula(true);
        expect(mocks.addNativeIndicator.mock.calls.filter(([type]) => type === MAIN_FORMULA_TYPE)).toHaveLength(2);
        adapter.destroy();
        adapter.destroy();
        adapter.setMainFormula(true);
        expect(mocks.formulaRemove).toHaveBeenCalledTimes(2);
        expect(mocks.addNativeIndicator.mock.calls.filter(([type]) => type === MAIN_FORMULA_TYPE)).toHaveLength(2);
        expect(mocks.destroy).toHaveBeenCalledOnce();
    });

    it.each(["indicator:removed", "indicator:visibility"])("图例 %s 清句柄并通知 UI，再启用创建新指标且销毁解除事件", (event) => {
        const notify = vi.fn();
        const adapter = createChartAdapter({} as HTMLElement, vi.fn(), notify);
        mocks.events.get(event)?.({ id: "sma", visible: false });
        expect(notify).not.toHaveBeenCalled();
        mocks.events.get(event)?.({ id: MAIN_FORMULA_TYPE, visible: false });
        expect(notify).toHaveBeenCalledExactlyOnceWith(false);
        expect(mocks.formulaRemove).toHaveBeenCalledTimes(event === "indicator:visibility" ? 1 : 0);
        adapter.setMainFormula(true);
        expect(mocks.addNativeIndicator.mock.calls.filter(([type]) => type === MAIN_FORMULA_TYPE)).toHaveLength(2);
        expect(notify).toHaveBeenLastCalledWith(true);
        adapter.setMainFormula(false);
        expect(notify).toHaveBeenLastCalledWith(false);
        const calls = notify.mock.calls.length;
        adapter.destroy();
        mocks.events.get(event)?.({ id: MAIN_FORMULA_TYPE, visible: false });
        expect(notify).toHaveBeenCalledTimes(calls);
        expect(mocks.eventUnsubscribe).toHaveBeenCalledTimes(2);
    });
});
