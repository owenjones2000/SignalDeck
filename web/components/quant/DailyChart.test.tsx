import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DailyChart from "./DailyChart";

const chart = vi.hoisted(() => ({
    setMarket: vi.fn(), setStyle: vi.fn(), destroy: vi.fn(), create: vi.fn(),
}));

vi.mock("../../lib/vela/chart-adapter", () => ({ createChartAdapter: chart.create }));

const history = {
    code: "000001", source: "akshare", adjustment: "qfq",
    bars: [{ date: "2026-11-18", open: 12, high: 13, low: 11, close: 12.5, volume: 10000 }],
};

beforeEach(() => {
    vi.resetAllMocks();
    chart.create.mockReturnValue(chart);
    chart.setMarket.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("uses the existing Vela adapter with daily candles and Shanghai close timestamps", async () => {
    const view = render(<DailyChart history={history} />);
    const container = screen.getByRole("img", { name: "000001 Vela 日线蜡烛图" });
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledWith("000001", "1D", [
        { time: Date.UTC(2026, 10, 18, 7), open: 12, high: 13, low: 11, close: 12.5, volume: 10000 },
    ]));
    expect(chart.create).toHaveBeenCalledWith(container, expect.any(Function));
    expect(chart.setStyle).toHaveBeenCalledWith("candles");
    expect(await screen.findByText("Vela · 1D · 1 bars · 上海收盘 15:00")).toBeTruthy();
    view.unmount();
    expect(chart.destroy).toHaveBeenCalledTimes(1);
});

it("replaces the market on history changes and destroys previous resources", async () => {
    const view = render(<DailyChart history={history} />);
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledTimes(1));
    view.rerender(<DailyChart history={{ ...history, code: "600000" }} />);
    await waitFor(() => expect(chart.setMarket).toHaveBeenCalledTimes(2));
    expect(chart.destroy).toHaveBeenCalledTimes(1);
    expect(chart.setMarket.mock.calls[1][0]).toBe("600000");
    expect(screen.queryByRole("img", { name: "000001 Vela 日线蜡烛图" })).toBeNull();
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
