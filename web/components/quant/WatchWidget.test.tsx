import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WatchWidget from "./WatchWidget";
import { mockApi, renderQuant, status } from "./test-support";

const vela = vi.hoisted(() => ({ setMarket: vi.fn().mockResolvedValue(undefined), setStyle: vi.fn(), setMainFormula: vi.fn(), destroy: vi.fn() }));
vi.mock("../../lib/vela/chart-adapter", () => ({ createChartAdapter: () => vela }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("adds and removes server watchlist codes and opens real daily bars", async () => {
    let codes: { code: string }[] = [];
    const fetcher = mockApi({
        "GET /api/quant/status": status,
        "GET /api/quant/watchlist": () => codes,
        "POST /api/quant/watchlist": () => { codes = [{ code: "000001" }]; return { code: "000001" }; },
        "GET /api/quant/quotes?codes=000001": [{ code: "000001", name: "平安银行", price: 12.5, source: "akshare", as_of: "2026-11-18T10:00:00+08:00", stale: true }],
        "GET /api/quant/history/000001?count=250": { code: "000001", source: "akshare", adjustment: "qfq", bars: [{ date: "2026-11-17", open: 12, high: 13, low: 11, close: 12.5, volume: 10000 }] },
        "DELETE /api/quant/watchlist/000001": () => { codes = []; return new Response(null, { status: 204 }); },
    });
    renderQuant(<WatchWidget />);
    expect(await screen.findByText("暂无 A 股自选")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("自选代码"), { target: { value: "000001" } });
    fireEvent.click(screen.getByRole("button", { name: "添加自选" }));
    expect(await screen.findByText("平安银行")).toBeTruthy();
    expect(screen.getByText("缓存报价")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看日线 000001" }));
    expect(await screen.findByText("2026-11-17")).toBeTruthy();
    expect(screen.getByRole("img", { name: "000001 Vela 日线蜡烛图" })).toBeTruthy();
    await waitFor(() => expect(vela.setMarket).toHaveBeenCalledWith("000001", "1D", [
        { time: Date.UTC(2026, 10, 17, 7), open: 12, high: 13, low: 11, close: 12.5, volume: 10000 },
    ]));
    expect(vela.setStyle).toHaveBeenCalledWith("candles");
    expect(screen.getByText("akshare · qfq 前复权 · 成交量单位：股")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除自选 000001" }));
    await screen.findByText("暂无 A 股自选");
    await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
    expect(fetcher.mock.calls.find(([, options]) => options?.method === "POST")?.[1]?.body).toBe('{"code":"000001"}');
});

it("shows a quote supplier error with a retry action", async () => {
    mockApi({ "GET /api/quant/status": status, "GET /api/quant/watchlist": [{ code: "600000" }], "GET /api/quant/quotes?codes=600000": () => Response.json({ error: "Missing quote: 600000" }, { status: 502 }) });
    renderQuant(<WatchWidget />);
    expect((await screen.findByRole("alert")).textContent).toContain("Missing quote: 600000");
    expect(screen.getByRole("button", { name: "刷新报价" })).toBeTruthy();
});

it.each([false, true])("marks retained quotes as old after refresh failure and recovers after success (cached=%s)", async (stale) => {
    let reads = 0;
    mockApi({
        "GET /api/quant/status": status,
        "GET /api/quant/watchlist": [{ code: "000001" }],
        "GET /api/quant/quotes?codes=000001": () => {
            reads += 1;
            if (reads === 2) return Response.json({ error: "Quote refresh offline" }, { status: 502 });
            return [{ code: "000001", name: "平安银行", price: reads === 1 ? 12.5 : 13, source: "akshare", as_of: reads === 1 ? "2026-11-18T10:00:00+08:00" : "2026-11-18T10:01:00+08:00", stale: reads === 1 && stale }];
        },
    });
    renderQuant(<WatchWidget />);
    await screen.findByText(stale ? "缓存报价" : "新鲜报价");
    fireEvent.click(screen.getByRole("button", { name: "刷新报价" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Quote refresh offline");
    expect(screen.getByText("旧报价 / 刷新失败")).toBeTruthy();
    expect(screen.getByText("12.50")).toBeTruthy();
    expect(screen.getByText("2026-11-18T10:00:00+08:00")).toBeTruthy();
    expect(screen.queryByText("新鲜报价")).toBeNull();
    expect(screen.queryByText("缓存报价")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "刷新报价" }));
    await screen.findByText("13.00");
    expect(screen.getByText("新鲜报价")).toBeTruthy();
    expect(screen.queryByText("旧报价 / 刷新失败")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
});

it("shows history authentication failures without a fake chart", async () => {
    mockApi({
        "GET /api/quant/status": status, "GET /api/quant/watchlist": [{ code: "000001" }],
        "GET /api/quant/quotes?codes=000001": [],
        "GET /api/quant/history/000001?count=250": () => Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    renderQuant(<WatchWidget />);
    fireEvent.click(await screen.findByRole("button", { name: "查看日线 000001" }));
    expect((await screen.findByRole("alert")).textContent).toContain("鉴权失败（HTTP 403）");
    expect(screen.queryByRole("img")).toBeNull();
});
