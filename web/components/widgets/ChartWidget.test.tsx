import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ChartWidget from "./ChartWidget";
import { useLocale } from "../../store/locale";
import { useTerminal } from "../../store/terminal";

const chart = vi.hoisted(() => ({
    create: vi.fn(), setMarket: vi.fn(), setStyle: vi.fn(), setIndicators: vi.fn(),
    setMainFormula: vi.fn(), clearPine: vi.fn(), runPine: vi.fn(), destroy: vi.fn(),
}));
const query = vi.hoisted(() => ({ data: { bars: [{ time: 1, open: 100, high: 110, low: 99, close: 109, volume: 100 }], source: "fixture", attempts: [] }, isFetching: false }));

vi.mock("../../lib/vela/chart-adapter", () => ({ createChartAdapter: chart.create }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => query }));

const widget = { id: "main-formula-chart", type: "chart" as const, linked: true };

beforeEach(() => {
    vi.resetAllMocks();
    chart.create.mockReturnValue(chart);
    chart.setMarket.mockResolvedValue(undefined);
    query.data.bars = [{ time: 1, open: 100, high: 110, low: 99, close: 109, volume: 100 }];
    useLocale.getState().setLocale("zh-CN");
    useTerminal.setState({ activeSymbol: "AAPL" });
});
afterEach(() => { cleanup(); useLocale.getState().setLocale("zh-CN"); useTerminal.getState().resetWorkspace(); });

it("defaults the main formula on and toggles independently of native indicators and Pine", async () => {
    render(<ChartWidget widget={widget} />);
    const toggle = screen.getByRole("button", { name: "主图公式" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(chart.setMainFormula).toHaveBeenCalledWith(true));
    const pineClears = chart.clearPine.mock.calls.length;
    const indicators = chart.setIndicators.mock.calls.length;
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(false);
    expect(chart.clearPine).toHaveBeenCalledTimes(pineClears);
    expect(chart.setIndicators).toHaveBeenCalledTimes(indicators);
    fireEvent.click(toggle);
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(true);
    expect(chart.create).toHaveBeenCalledTimes(1);
});

it("does not revive an early disable after market loading or symbol and timeframe changes", async () => {
    let finish!: () => void;
    chart.setMarket.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<ChartWidget widget={widget} />);
    fireEvent.click(screen.getByRole("button", { name: "主图公式" }));
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalled());
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(false);
    await act(async () => finish());
    act(() => useTerminal.setState({ activeSymbol: "MSFT" }));
    await waitFor(() => expect(chart.setMarket).toHaveBeenLastCalledWith("MSFT", "1D", query.data.bars));
    await act(async () => { fireEvent.change(screen.getByLabelText("周期", { selector: "select" }), { target: { value: "5" } }); });
    await waitFor(() => expect(chart.setMarket).toHaveBeenLastCalledWith("MSFT", "5", query.data.bars));
    await act(async () => finish());
    expect(chart.setMainFormula.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    expect(chart.create).toHaveBeenCalledTimes(1);
});

it.each([199, 200])("explains timeframe and the %i-bar history boundary without remounting on language changes", async (count) => {
    query.data.bars = Array.from({ length: count }, (_, index) => ({ time: index + 1, open: 100, high: 110, low: 99, close: 109, volume: 100 }));
    render(<ChartWidget widget={widget} />);
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalled());
    await act(async () => { fireEvent.change(screen.getByLabelText("周期", { selector: "select" }), { target: { value: "5" } }); });
    expect(screen.getByText("主图公式基于当前周期 5；黄色实体表示相邻 K 线涨幅 ≥ 8.5%，并非固定日涨幅。")).toBeTruthy();
    expect(Boolean(screen.queryByText("历史不足 200 根 K 线：长周期均线需完整窗口；不补取或伪造历史，窗口外压力/支撑事件不恢复。"))).toBe(count < 200);
    act(() => useLocale.getState().setLocale("en"));
    expect(screen.getByRole("button", { name: "Main formula" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Main formula uses the current timeframe 5; yellow bodies mark a gain ≥ 8.5% over the previous bar, not a fixed daily gain.")).toBeTruthy();
    expect(Boolean(screen.queryByText("Fewer than 200 bars: long moving averages need full windows; history is not fetched or fabricated, and pressure/support events outside the window are not restored."))).toBe(count < 200);
    fireEvent.click(screen.getByRole("button", { name: "Main formula" }));
    expect(screen.queryByText(/Main formula uses/)).toBeNull();
    expect(screen.queryByText(/Fewer than 200 bars/)).toBeNull();
    expect(chart.create).toHaveBeenCalledTimes(1);
});

it("syncs legend removal or hiding during loading and can restore the formula without affecting Pine", async () => {
    let finish!: () => void;
    chart.setMarket.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<ChartWidget widget={widget} />);
    await waitFor(() => expect(chart.create).toHaveBeenCalled());
    const notify = chart.create.mock.calls[0][2] as (enabled: boolean) => void;
    expect(notify).toEqual(expect.any(Function));
    const pineClears = chart.clearPine.mock.calls.length;
    const indicators = chart.setIndicators.mock.calls.length;
    act(() => notify(false));
    expect(screen.getByRole("button", { name: "主图公式" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/主图公式基于当前周期/)).toBeNull();
    expect(chart.clearPine).toHaveBeenCalledTimes(pineClears);
    expect(chart.setIndicators).toHaveBeenCalledTimes(indicators);
    await act(async () => finish());
    act(() => useTerminal.setState({ activeSymbol: "MSFT" }));
    await waitFor(() => expect(chart.setMarket).toHaveBeenLastCalledWith("MSFT", "1D", query.data.bars));
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "主图公式" }));
    expect(chart.setMainFormula).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/主图公式基于当前周期/)).toBeTruthy();
    expect(chart.create).toHaveBeenCalledTimes(1);
    view.unmount();
    const changes = chart.setMainFormula.mock.calls.length;
    act(() => notify(false));
    expect(chart.setMainFormula).toHaveBeenCalledTimes(changes);
});
