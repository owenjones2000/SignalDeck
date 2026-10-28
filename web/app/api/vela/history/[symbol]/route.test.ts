import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ loadHistory: vi.fn() }));
vi.mock("@/lib/vela/history.server", () => ({ loadHistory: mocks.loadHistory }));
vi.mock("@/lib/api-key", () => ({ getApiKey: () => "secret" }));

describe("Vela 行情接口", () => {
    beforeEach(() => vi.clearAllMocks());
    const context = { params: Promise.resolve({ symbol: "aapl" }) };

    it("默认 6M/live/1D 并返回约定结构", async () => {
        const result = { bars: [{ time: 1 }], source: "yahoo", mode: "live", timeframe: "1D", attempts: [] };
        mocks.loadHistory.mockResolvedValue(result);
        const response = await GET(new NextRequest("http://localhost/api/vela/history/aapl"), context);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(result);
        expect(mocks.loadHistory.mock.calls[0][0]).toEqual({ symbol: "AAPL", range: "6M", mode: "live", timeframe: "1D" });
        expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("支持显式 fixture 和 timeframe", async () => {
        mocks.loadHistory.mockResolvedValue({ bars: [{ time: 1 }] });
        await GET(new NextRequest("http://localhost/api/vela/history/aapl?range=1D&mode=fixture&timeframe=15"), context);
        expect(mocks.loadHistory.mock.calls[0][0]).toMatchObject({ mode: "fixture", timeframe: "15", range: "1D" });
    });

    it.each(["range=BAD", "mode=auto", "timeframe=invalid"])("无效参数 %s 返回 400", async (query) => {
        const response = await GET(new NextRequest(`http://localhost/api/vela/history/aapl?${query}`), context);
        expect(response.status).toBe(400);
        expect(mocks.loadHistory).not.toHaveBeenCalled();
    });

    it("真实行情全部失败返回 502 和尝试记录", async () => {
        const result = { bars: [], source: null, mode: "live", timeframe: "1D", attempts: [{ source: "yahoo", status: "error", error: "offline" }] };
        mocks.loadHistory.mockResolvedValue(result);
        const response = await GET(new NextRequest("http://localhost/api/vela/history/aapl"), context);
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual(result);
    });
});
