import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DailyChart from "./DailyChart";
import { useLocale } from "../../store/locale";

const chart = vi.hoisted(() => ({
    setMarket: vi.fn(), setStyle: vi.fn(), setMainFormula: vi.fn(), destroy: vi.fn(), create: vi.fn(),
}));

vi.mock("../../lib/vela/chart-adapter", () => ({ createChartAdapter: chart.create }));

const history = {
    code: "000001", source: "akshare", adjustment: "qfq",
    bars: [{ date: "2026-11-18", open: 12, high: 13, low: 11, close: 12.5, volume: 10000 }],
};

beforeEach(() => {
    useLocale.getState().setLocale("zh-CN");
    vi.resetAllMocks();
    chart.create.mockReturnValue(chart);
    chart.setMarket.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); useLocale.getState().setLocale("zh-CN"); });

it("uses the existing Vela adapter with daily candles and Shanghai close timestamps", async () => {
    const view = render(<DailyChart history={history} />);
    const container = screen.getByRole("img", { name: "000001 Vela 日线蜡烛图" });
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledWith("000001", "1D", [
        { time: Date.UTC(2026, 10, 18, 7), open: 12, high: 13, low: 11, close: 12.5, volume: 10000 },
    ]));
    expect(chart.create).toHaveBeenCalledWith(container, expect.any(Function), expect.any(Function));
    expect(chart.setStyle).toHaveBeenCalledWith("candles");
    expect(await screen.findByText("Vela · 1D · 1 根 K 线 · 上海收盘 15:00")).toBeTruthy();
    view.unmount();
    expect(chart.destroy).toHaveBeenCalledTimes(1);
});

it("replaces the market on history changes without remounting the chart", async () => {
    const view = render(<DailyChart history={history} />);
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledTimes(1));
    view.rerender(<DailyChart history={{ ...history, code: "600000" }} />);
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledTimes(2));
    expect(chart.destroy).not.toHaveBeenCalled();
    expect(chart.create).toHaveBeenCalledTimes(1);
    expect(chart.setMarket.mock.calls[1][0]).toBe("600000");
    expect(screen.queryByRole("img", { name: "000001 Vela 日线蜡烛图" })).toBeNull();
});

it("defaults the main formula on and toggles it without recreating the chart", async () => {
    render(<DailyChart history={history} />);
    const toggle = screen.getByRole("button", { name: "主图公式" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(chart.setMainFormula).toHaveBeenCalledWith(true));
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(false);
    fireEvent.click(toggle);
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(true);
    expect(chart.create).toHaveBeenCalledTimes(1);
});

it("keeps an early disable across initialization, pending market completion and security changes", async () => {
    let finish!: () => void;
    chart.setMarket.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<DailyChart history={history} />);
    fireEvent.click(screen.getByRole("button", { name: "主图公式" }));
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledTimes(1));
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(false);
    await act(async () => finish());
    view.rerender(<DailyChart history={{ ...history, code: "600000" }} />);
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledTimes(2));
    expect(chart.setMainFormula.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    expect(screen.getByRole("button", { name: "主图公式" }).getAttribute("aria-pressed")).toBe("false");
    expect(chart.create).toHaveBeenCalledTimes(1);
});

it("shows renderer failures instead of claiming the chart is ready", async () => {
    chart.setMarket.mockRejectedValue(new Error("Vela renderer unavailable"));
    render(<DailyChart history={history} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Vela renderer unavailable");
    expect(screen.queryByText(/Vela · 1D/)).toBeNull();
});

it("keeps empty history explicit without creating a chart", () => {
    render(<DailyChart history={{ ...history, bars: [] }} />);
    expect(screen.getByText("暂无日线数据")).toBeTruthy();
    expect(chart.create).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
});

it.each([199, 200])("explains the daily formula and history boundary for %i bars in both languages", async (count) => {
    render(<DailyChart history={{ ...history, bars: Array.from({ length: count }, () => history.bars[0]) }} />);
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalled());
    expect(screen.getByText("主图公式基于当前周期 1D；黄色实体表示相邻 K 线涨幅 ≥ 8.5%，并非固定日涨幅。")).toBeTruthy();
    expect(Boolean(screen.queryByText("历史不足 200 根 K 线：长周期均线需完整窗口；不补取或伪造历史，窗口外压力/支撑事件不恢复。"))).toBe(count < 200);
    fireEvent.click(screen.getByRole("button", { name: "主图公式" }));
    act(() => useLocale.getState().setLocale("en"));
    expect(screen.getByRole("button", { name: "Main formula" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/Main formula uses/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Main formula" }));
    expect(screen.getByText("Main formula uses the current timeframe 1D; yellow bodies mark a gain ≥ 8.5% over the previous bar, not a fixed daily gain.")).toBeTruthy();
    expect(Boolean(screen.queryByText("Fewer than 200 bars: long moving averages need full windows; history is not fetched or fabricated, and pressure/support events outside the window are not restored."))).toBe(count < 200);
    expect(chart.create).toHaveBeenCalledTimes(1);
});

it("ignores an obsolete market failure after switching securities", async () => {
    let fail!: (reason: Error) => void;
    chart.setMarket.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    const view = render(<DailyChart history={history} />);
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledTimes(1));
    view.rerender(<DailyChart history={{ ...history, code: "600000" }} />);
    await screen.findByText("Vela · 1D · 1 根 K 线 · 上海收盘 15:00");
    await act(async () => fail(new Error("obsolete market")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(chart.create).toHaveBeenCalledTimes(1);
});

it("syncs legend removal or hiding to the toggle and restores the formula without remounting", async () => {
    let finish!: () => void;
    chart.setMarket.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<DailyChart history={history} />);
    await waitFor(() => expect(chart.create).toHaveBeenCalled());
    const notify = chart.create.mock.calls[0][2] as (enabled: boolean) => void;
    expect(notify).toEqual(expect.any(Function));
    act(() => notify(false));
    expect(screen.getByRole("button", { name: "主图公式" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/主图公式基于当前周期/)).toBeNull();
    await act(async () => finish());
    view.rerender(<DailyChart history={{ ...history, code: "600000" }} />);
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledTimes(2));
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "主图公式" }));
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/主图公式基于当前周期/)).toBeTruthy();
    expect(chart.create).toHaveBeenCalledTimes(1);
});

it("keeps the synchronized ref on recreation and ignores callbacks from a cancelled chart", async () => {
    const view = render(<DailyChart history={history} />);
    await waitFor(() => expect(chart.create).toHaveBeenCalledTimes(1));
    const notify = chart.create.mock.calls[0][2] as (enabled: boolean) => void;
    expect(notify).toEqual(expect.any(Function));
    act(() => notify(false));
    view.rerender(<DailyChart history={{ ...history, bars: [] }} />);
    act(() => notify(true));
    view.rerender(<DailyChart history={history} />);
    await waitFor(() => expect(chart.create).toHaveBeenCalledTimes(2));
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "主图公式" }).getAttribute("aria-pressed")).toBe("false");
    const currentNotify = chart.create.mock.calls[1][2] as (enabled: boolean) => void;
    act(() => currentNotify(true));
    act(() => notify(false));
    expect(screen.getByRole("button", { name: "主图公式" }).getAttribute("aria-pressed")).toBe("true");
});
