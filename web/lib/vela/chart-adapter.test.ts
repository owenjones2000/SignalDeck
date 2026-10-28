import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChartAdapter } from "./chart-adapter";

const mocks = vi.hoisted(() => ({
    construct: vi.fn(),
    setMarket: vi.fn().mockResolvedValue(undefined), set: vi.fn(), addNativeIndicator: vi.fn(), destroy: vi.fn(),
    unsubscribe: vi.fn(), observe: vi.fn(), disconnect: vi.fn(), resize: vi.fn(),
    run: vi.fn(), clear: vi.fn(), pineDestroy: vi.fn(),
    hover: null as null | ((event: { time: number | null }) => void),
}));

vi.mock("@luxalgo/vela", () => ({ Vela: class {
    constructor(container: HTMLElement, options: unknown) { mocks.construct(container, options); }
    setMarket = mocks.setMarket;
    addNativeIndicator = mocks.addNativeIndicator;
    destroy = mocks.destroy;
    resize = mocks.resize;
    renderer = { set: mocks.set, onCrosshairMove: (callback: typeof mocks.hover) => { mocks.hover = callback; return mocks.unsubscribe; } };
} }));
vi.mock("./pine-adapter", () => ({ createPineAdapter: () => ({ run: mocks.run, clear: mocks.clear, destroy: mocks.pineDestroy }) }));

describe("Vela 图表适配器", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

    it("指标去重、使用正确原生类型并移除取消项", () => {
        const remove = vi.fn();
        mocks.addNativeIndicator.mockReturnValue({ remove });
        const adapter = createChartAdapter({} as HTMLElement, vi.fn());
        adapter.setIndicators(new Set(["SMA50", "BOLL"]));
        adapter.setIndicators(new Set(["SMA50", "BOLL"]));
        expect(mocks.addNativeIndicator).toHaveBeenCalledTimes(2);
        expect(mocks.addNativeIndicator).toHaveBeenCalledWith("sma", { inputs: { length: 50 } });
        expect(mocks.addNativeIndicator).toHaveBeenCalledWith("bollinger-bands", { inputs: undefined });
        adapter.setIndicators(new Set(["SMA50"]));
        expect(remove).toHaveBeenCalledOnce();
        adapter.destroy();
    });
});
