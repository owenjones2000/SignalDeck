import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import BacktestWidget from "./BacktestWidget";
import { job, mockApi, renderQuant, status } from "./test-support";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("sends all Python backtest parameters and renders metrics, curve, trades and limitations", async () => {
    const completed = { ...job, kind: "backtest", status: "completed", result: {
        code: "000001", source: "akshare", adjustment: "qfq", strategy: "dual_ma", init_capital: 100000, final_equity: 110000, total_return: 0.1, max_drawdown: 0.025, cash: 10000, position_shares: 8000,
        trades: [{ type: "buy", signal_date: "2026-11-16", date: "2026-11-17", price: 12.5, shares: 8000, commission: 30, stamp_tax: 0 }],
        equity_curve: [{ date: "2026-11-16", equity: 100000 }, { date: "2026-11-17", equity: 110000 }], limitations: ["next_open", "no_slippage", "qfq_prices_not_actual_fills"],
    } };
    const fetcher = mockApi({ "GET /api/quant/status": status, "GET /api/quant/strategies": [{ key: "dual_ma", name: "5/20日双均线", min_history: 21 }], "GET /api/quant/jobs": [], "POST /api/quant/jobs": { ...job, kind: "backtest" }, "GET /api/quant/jobs/j1": completed });
    renderQuant(<BacktestWidget />);
    await screen.findByText("5/20日双均线");
    fireEvent.change(screen.getByLabelText("回测代码"), { target: { value: "000001" } });
    fireEvent.click(screen.getByRole("button", { name: "运行回测" }));
    expect(await screen.findByText("10.00%")).toBeTruthy();
    expect(screen.getByText("2.50%")).toBeTruthy();
    expect(screen.getByRole("img", { name: "回测权益曲线" })).toBeTruthy();
    expect(screen.getByText("买入")).toBeTruthy();
    expect(screen.getByText(/不含滑点/)).toBeTruthy();
    const request = fetcher.mock.calls.find(([, options]) => options?.method === "POST");
    expect(JSON.parse(request![1]!.body as string)).toEqual({ kind: "backtest", params: { code: "000001", strategy: "dual_ma", count: 250, init_capital: 100000, position_pct: 1, commission: 0.0003, stamp_tax: 0.0005 } });
});

it("rejects non A-share inputs before submitting", async () => {
    const fetcher = mockApi({ "GET /api/quant/status": status, "GET /api/quant/strategies": [{ key: "dual_ma", name: "双均线", min_history: 21 }], "GET /api/quant/jobs": [] });
    renderQuant(<BacktestWidget />);
    await screen.findByText("双均线");
    fireEvent.change(screen.getByLabelText("回测代码"), { target: { value: "AAPL" } });
    fireEvent.click(screen.getByRole("button", { name: "运行回测" }));
    expect((await screen.findByRole("alert")).textContent).toContain("六位 A 股代码");
    expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});

it("shows submission errors from the API rather than a fabricated report", async () => {
    mockApi({ "GET /api/quant/status": status, "GET /api/quant/strategies": [{ key: "dual_ma", name: "双均线", min_history: 21 }], "GET /api/quant/jobs": [], "POST /api/quant/jobs": () => Response.json({ error: "Insufficient history count for strategy" }, { status: 400 }) });
    renderQuant(<BacktestWidget />);
    await screen.findByText("双均线");
    fireEvent.change(screen.getByLabelText("回测代码"), { target: { value: "000001" } });
    fireEvent.click(screen.getByRole("button", { name: "运行回测" }));
    expect((await screen.findByRole("alert")).textContent).toContain("HTTP 400");
    expect(screen.queryByRole("img", { name: "回测权益曲线" })).toBeNull();
});
