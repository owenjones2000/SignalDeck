import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LongbridgeWidget from "./LongbridgeWidget";
import Sidebar from "../Sidebar";
import Workspace from "../Workspace";
import { mockApi, renderQuant } from "../quant/test-support";
import { useLocale } from "../../store/locale";
import { useTerminal } from "../../store/terminal";

class FakeEventSource extends EventTarget {
    static instances: FakeEventSource[] = [];
    close = vi.fn();
    constructor(public readonly url: string) {
        super();
        FakeEventSource.instances.push(this);
    }
    emit(type: string, data?: unknown) {
        this.dispatchEvent(data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) }));
    }
}

const configured = { configured: true, available: true, source: "longbridge", error: null };
const quote = { symbol: "AAPL.US", price: 123.45, open: 120, high: 124, low: 119, volume: 1000, turnover: 120000, timestamp: "2026-11-19T10:00:00Z", source: "longbridge" };

async function subscribe(input = "aapl.us,00700.hk,600000.sh") {
    mockApi({ "GET /api/longbridge/status": configured });
    const view = renderQuant(<LongbridgeWidget />);
    await screen.findByText("长桥服务就绪");
    fireEvent.change(screen.getByLabelText("长桥证券代码"), { target: { value: input } });
    fireEvent.click(screen.getByRole("button", { name: "订阅" }));
    return view;
}

beforeEach(() => {
    useLocale.getState().setLocale("zh-CN");
    useTerminal.setState({ widgets: [], layout: [] });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useLocale.getState().setLocale("zh-CN");
    useTerminal.getState().resetWorkspace();
});

it("adds an independent Longbridge panel through the bilingual sidebar and renders it in the workspace", async () => {
    const fetcher = mockApi({ "GET /api/longbridge/status": { configured: false, available: false, source: "longbridge", error: "not_configured" } });
    renderQuant(<><Sidebar /><Workspace /></>);
    fireEvent.click(screen.getByRole("button", { name: "长桥行情" }));
    expect(useTerminal.getState().widgets[0]).toMatchObject({ type: "longbridge", linked: false });
    expect(useTerminal.getState().layout[0]).toMatchObject({ w: 12, h: 10 });
    await screen.findByText("长桥未配置，请在服务器配置凭据后刷新状态。");
    expect((screen.getByRole("button", { name: "订阅" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/api/longbridge/status", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(FakeEventSource.instances).toHaveLength(0);
    act(() => useLocale.getState().setLocale("en"));
    expect(screen.getByRole("button", { name: "Longbridge Quotes" })).toBeTruthy();
    expect(screen.getByText("Longbridge is not configured. Configure credentials on the server, then refresh status.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(useTerminal.getState().widgets).toEqual([]);
});

it("shows an unavailable SDK separately from missing credentials", async () => {
    mockApi({ "GET /api/longbridge/status": { configured: true, available: false, source: "longbridge", error: "sdk_unavailable" } });
    renderQuant(<LongbridgeWidget />);
    await screen.findByText("服务器未安装长桥 SDK，暂时无法订阅。");
    expect(FakeEventSource.instances).toHaveLength(0);
});

it("uses the dedicated same-origin stream and handles ready, latest quote and heartbeat without reconnecting on language changes", async () => {
    await subscribe();
    expect(FakeEventSource.instances).toHaveLength(1);
    const stream = FakeEventSource.instances[0];
    const url = new URL(stream.url, "http://localhost");
    expect(url.pathname).toBe("/api/longbridge/stream");
    expect([...url.searchParams]).toEqual([["symbols", "AAPL.US,700.HK,600000.SH"]]);
    act(() => stream.emit("ready", { symbols: ["AAPL.US", "700.HK", "600000.SH"], source: "longbridge" }));
    expect(screen.getByText("已连接，等待报价")).toBeTruthy();
    act(() => stream.emit("quote", quote));
    const row = screen.getByRole("row", { name: /AAPL.US/ });
    expect(within(row).getByText("123.45")).toBeTruthy();
    expect(within(row).getByText("2026-11-19T10:00:00Z")).toBeTruthy();
    act(() => stream.emit("quote", { ...quote, price: 125 }));
    expect(screen.getAllByRole("row", { name: /AAPL.US/ })).toHaveLength(1);
    expect(within(row).getByText("125.00")).toBeTruthy();
    act(() => stream.emit("heartbeat", { source: "longbridge" }));
    expect(screen.getByText(/最近心跳：/)).toBeTruthy();
    act(() => useLocale.getState().setLocale("en"));
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeTruthy();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(stream.close).not.toHaveBeenCalled();
});

it("closes failed streams and reconnects with capped exponential backoff, then resets backoff on ready", async () => {
    await subscribe("AAPL.US");
    vi.useFakeTimers();
    let stream = FakeEventSource.instances[0];
    act(() => stream.emit("quote", quote));
    act(() => stream.emit("error"));
    expect(stream.close).toHaveBeenCalledTimes(1);
    expect(screen.getByText("连接已断开，1秒后重连")).toBeTruthy();
    expect(screen.getByText("连接中断；显示的是上次报价，非实时更新。")).toBeTruthy();
    act(() => vi.advanceTimersByTime(999));
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(2);
    for (const delay of [2, 4, 8, 16, 30, 30]) {
        stream = FakeEventSource.instances.at(-1)!;
        act(() => stream.emit("error"));
        expect(screen.getByText(`连接已断开，${delay}秒后重连`)).toBeTruthy();
        act(() => vi.advanceTimersByTime(delay * 1000));
    }
    stream = FakeEventSource.instances.at(-1)!;
    act(() => stream.emit("ready", { source: "longbridge", symbols: ["AAPL.US"] }));
    act(() => stream.emit("error"));
    expect(screen.getByText("连接已断开，1秒后重连")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消订阅" }));
    const count = FakeEventSource.instances.length;
    act(() => vi.advanceTimersByTime(60000));
    expect(FakeEventSource.instances).toHaveLength(count);
});

it("shows application SSE errors, retries transient errors and stops for missing configuration", async () => {
    await subscribe("AAPL.US");
    vi.useFakeTimers();
    const stream = FakeEventSource.instances[0];
    act(() => stream.emit("error", { source: "longbridge", error: "upstream_timeout" }));
    expect(screen.getByRole("alert").textContent).toBe("长桥上游连接超时");
    act(() => vi.advanceTimersByTime(1000));
    const next = FakeEventSource.instances[1];
    act(() => next.emit("error", { source: "longbridge", error: "not_configured" }));
    expect(screen.getByRole("alert").textContent).toBe("长桥未配置，请在服务器配置凭据后刷新状态。");
    expect(next.close).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(60000));
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => useLocale.getState().setLocale("en"));
    expect(screen.getByRole("alert").textContent).toBe("Longbridge is not configured. Configure credentials on the server, then refresh status.");
});

it("cancels active subscriptions on replacement and unmount, ignoring late events and pending reconnects", async () => {
    const view = await subscribe("AAPL.US");
    const first = FakeEventSource.instances[0];
    fireEvent.change(screen.getByLabelText("长桥证券代码"), { target: { value: "700.HK" } });
    fireEvent.click(screen.getByRole("button", { name: "订阅" }));
    expect(first.close).toHaveBeenCalledTimes(1);
    const second = FakeEventSource.instances[1];
    act(() => first.emit("quote", quote));
    expect(screen.queryByRole("row", { name: /AAPL.US/ })).toBeNull();
    expect(screen.getByRole("row", { name: /700.HK/ })).toBeTruthy();
    vi.useFakeTimers();
    act(() => second.emit("error"));
    view.unmount();
    act(() => vi.advanceTimersByTime(60000));
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(2);
});

it.each(["AAPL", "0.HK", "920001.BJ", "AAPL.US?key=secret", Array.from({ length: 21 }, (_, index) => `A${index}.US`).join(",")])("rejects unsupported symbols without opening a stream: %s", async (input) => {
    await subscribe(input);
    expect(screen.getByRole("alert").textContent).toBe("长桥代码无效，请输入1–20个带市场后缀的证券代码。");
    expect(FakeEventSource.instances).toHaveLength(0);
});

it("deduplicates subscriptions and ignores malformed, foreign and out-of-order quote events", async () => {
    await subscribe("AAPL.US,AAPL.US");
    const stream = FakeEventSource.instances[0];
    expect(new URL(stream.url, "http://localhost").searchParams.get("symbols")).toBe("AAPL.US");
    act(() => {
        stream.dispatchEvent(new MessageEvent("quote", { data: "not json" }));
        stream.emit("quote", { ...quote, symbol: "MSFT.US" });
        stream.emit("quote", { ...quote, price: "123" });
        stream.emit("quote", { ...quote, timestamp: "invalid" });
        stream.emit("quote", { ...quote, source: "other" });
    });
    expect(screen.queryByText("123.45")).toBeNull();
    act(() => stream.emit("quote", quote));
    act(() => stream.emit("quote", { ...quote, price: 1, timestamp: "2026-11-19T09:00:00Z" }));
    expect(screen.getByText("123.45")).toBeTruthy();
    expect(screen.queryByText("1.00")).toBeNull();
});

it("unmount closes the active stream and prevents late events from reconnecting", async () => {
    const view = await subscribe("AAPL.US");
    const stream = FakeEventSource.instances[0];
    vi.useFakeTimers();
    view.unmount();
    expect(stream.close).toHaveBeenCalledTimes(1);
    act(() => stream.emit("error"));
    act(() => vi.advanceTimersByTime(60000));
    expect(FakeEventSource.instances).toHaveLength(1);
});

it("refreshes service configuration without connecting automatically and stops if credentials disappear", async () => {
    let available = false;
    mockApi({ "GET /api/longbridge/status": () => ({ configured: available, available, source: "longbridge", error: available ? null : "not_configured" }) });
    renderQuant(<LongbridgeWidget />);
    await screen.findByText("长桥未配置，请在服务器配置凭据后刷新状态。");
    available = true;
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    await screen.findByText("长桥服务就绪");
    expect(FakeEventSource.instances).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("长桥证券代码"), { target: { value: "AAPL.US" } });
    fireEvent.click(screen.getByRole("button", { name: "订阅" }));
    const stream = FakeEventSource.instances[0];
    available = false;
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    await screen.findByText("长桥未配置，请在服务器配置凭据后刷新状态。");
    await waitFor(() => expect(stream.close).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "订阅" }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(["connection_failed", "subscription_failed", "unsubscribe_failed", "upstream_timeout"])("allows subscriptions despite a retryable status error: %s", async (error) => {
    mockApi({ "GET /api/longbridge/status": { ...configured, available: false, error } });
    renderQuant(<LongbridgeWidget />);
    await screen.findByText("长桥服务暂不可用");
    expect((screen.getByRole("button", { name: "订阅" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("长桥证券代码"), { target: { value: "AAPL.US" } });
    fireEvent.click(screen.getByRole("button", { name: "订阅" }));
    expect(FakeEventSource.instances).toHaveLength(1);
});

it("preserves pending reconnection when status refresh reports a retryable failure", async () => {
    let failed = false;
    mockApi({ "GET /api/longbridge/status": () => ({ ...configured, available: !failed, error: failed ? "subscription_failed" : null }) });
    renderQuant(<LongbridgeWidget />);
    await screen.findByText("长桥服务就绪");
    fireEvent.change(screen.getByLabelText("长桥证券代码"), { target: { value: "AAPL.US" } });
    fireEvent.click(screen.getByRole("button", { name: "订阅" }));
    act(() => FakeEventSource.instances[0].emit("error"));
    failed = true;
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    await screen.findByText("长桥服务暂不可用");
    expect((screen.getByRole("button", { name: "订阅" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "取消订阅" }) as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2), { timeout: 2000 });
    expect(new URL(FakeEventSource.instances[1].url, "http://localhost").searchParams.get("symbols")).toBe("AAPL.US");
});
