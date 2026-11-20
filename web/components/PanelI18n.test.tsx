import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ScreenWidget from "./quant/ScreenWidget";
import BacktestWidget from "./quant/BacktestWidget";
import AlertsWidget from "./quant/AlertsWidget";
import WatchWidget from "./quant/WatchWidget";
import ChartWidget from "./widgets/ChartWidget";
import PortfolioWidget from "./widgets/PortfolioWidget";
import CalendarWidget from "./widgets/CalendarWidget";
import { ErrorMessage } from "./quant/Common";
import { mockApi, renderQuant, status } from "./quant/test-support";
import { useLocale } from "../store/locale";
import { useTerminal } from "../store/terminal";
import { quantRequest } from "../lib/quant/client";

vi.mock("../lib/vela/chart-adapter", () => ({ createChartAdapter: () => ({ destroy() {}, clearPine() {}, setMarket: async () => {}, setStyle() {}, setIndicators() {}, runPine: async () => "Example" }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useLocale.getState().setLocale("zh-CN"); });

it("switches quant forms, empty states and service status in place without changing selected formula keys", async () => {
    mockApi({
        "GET /api/quant/status": status,
        "GET /api/quant/formulas": [{ key: "ma_cross", name: "均线金叉", min_history: 30 }],
        "GET /api/quant/strategies": [{ key: "ma_cross", name: "均线金叉", min_history: 30 }],
        "GET /api/quant/jobs?kind=screen": [],
        "GET /api/quant/jobs?kind=backtest": [],
        "GET /api/quant/watchlist": [],
        "GET /api/quant/alerts": [],
        "GET /api/quant/notifications": [],
    });
    useLocale.getState().setLocale("zh-CN");
    renderQuant(<><ScreenWidget /><BacktestWidget /><WatchWidget /><AlertsWidget /></>);
    await screen.findByRole("button", { name: "运行选股" });
    await screen.findByText("暂无 A 股自选");
    fireEvent.change(screen.getByLabelText("选股代码"), { target: { value: "000001" } });
    act(() => useLocale.getState().setLocale("en"));
    expect(screen.getByRole("button", { name: "Run screen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run backtest" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create alert" })).toBeTruthy();
    expect(screen.getByText("No A-share watchlist entries")).toBeTruthy();
    expect(screen.getByLabelText("Screen codes").getAttribute("value")).toBe("000001");
    expect((screen.getByLabelText("Screen formula") as HTMLSelectElement).value).toBe("ma_cross");
    expect(screen.getAllByText("Service online")).toHaveLength(4);
    expect(screen.getByText("No alert rules")).toBeTruthy();
});

it("translates chart controls and Pine result state without using translated text for failure detection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ mode: "live", timeframe: "1D", bars: [{ time: 1735689600000, open: 1, high: 2, low: 1, close: 2, volume: 1 }], source: "fixture", attempts: [] })));
    useLocale.getState().setLocale("en");
    renderQuant(<ChartWidget widget={{ id: "chart", type: "chart", linked: true }} />);
    expect(screen.getByLabelText("Timeframe")).toBeTruthy();
    expect(screen.getByLabelText("Data mode")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "PINE" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Executed: Example");
    act(() => useLocale.getState().setLocale("zh-CN"));
    expect(screen.getByText("已执行：Example")).toBeTruthy();
});

it("translates portfolio and calendar labels while preserving transaction enum values", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    useLocale.getState().setLocale("zh-CN");
    renderQuant(<><PortfolioWidget /><CalendarWidget /></>);
    expect(screen.getByRole("button", { name: "交易记录" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "买入" }).getAttribute("value")).toBe("BUY");
    act(() => useLocale.getState().setLocale("en"));
    expect(screen.getByRole("button", { name: "TRANSACTIONS" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ECONOMIC" })).toBeTruthy();
    expect(useTerminal.getState().activeSymbol).toBeTruthy();
});

it("preserves arbitrary upstream error messages verbatim in both languages", () => {
    renderQuant(<ErrorMessage error={new Error("Upstream 原始错误 / code=503")} />);
    expect(screen.getByRole("alert").textContent).toBe("Upstream 原始错误 / code=503");
    act(() => useLocale.getState().setLocale("en"));
    expect(screen.getByRole("alert").textContent).toBe("Upstream 原始错误 / code=503");
});

it("switches request error prefixes without altering the upstream detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Upstream 原始错误" }, { status: 503 })));
    const error = await quantRequest("/status").catch((reason: unknown) => reason);
    renderQuant(<ErrorMessage error={error} />);
    expect(screen.getByRole("alert").textContent).toBe("请求失败（HTTP 503）：Upstream 原始错误");
    act(() => useLocale.getState().setLocale("en"));
    expect(screen.getByRole("alert").textContent).toBe("Request failed (HTTP 503): Upstream 原始错误");
});
