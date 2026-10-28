import { describe, expect, it, vi } from "vitest";
import { fixtureBars } from "./fixture";
import { fetchHistory } from "./history.client";
import { loadHistory } from "./history.server";
import { aggregateBars, DEFAULT_TIMEFRAME, normalizeBars, RANGES, type HistoryRequest } from "./types";

const request: HistoryRequest = { symbol: "AAPL", range: "6M", mode: "live", timeframe: "1D" };
const candle = { time: 1_770_000_000, open: 10, high: 12, low: 9, close: 11, volume: 100 };
const dependencies = (fetch: typeof globalThis.fetch) => ({ fetch, apiUrl: "http://api.test", apiKey: "secret" });
const expressCandle = { timestamp: candle.time * 1000, open: 10, high: 12, low: 9, close: 11, volume: 100 };
const velaHeaders = { "X-Vela-Source": "nasdaq", "X-Vela-Cache": "miss", "X-Vela-Attempts": "nasdaq", "X-Vela-Time-Unit": "ms", "X-Vela-Mode": "live" };

describe("行情适配", () => {
    it("转换秒为毫秒，排序、去重并过滤无效数据", () => {
        expect(normalizeBars([{ ...candle, time: candle.time + 60 }, candle, { ...candle, close: 12 }, { ...candle, high: 8 }], "seconds"))
            .toEqual([{ ...candle, time: candle.time * 1000, close: 12 }, { ...candle, time: (candle.time + 60) * 1000 }]);
        expect(() => normalizeBars([], "seconds")).toThrow();
    });

    it("按周期聚合，保留 OHLC 和累加成交量", () => {
        const time = Date.UTC(2026, 0, 5);
        expect(aggregateBars([{ ...candle, time }, { ...candle, time: time + 60_000, close: 12, high: 13 }], "5"))
            .toEqual([{ ...candle, time, high: 13, close: 12, volume: 200 }]);
        expect(aggregateBars([{ ...candle, time }, { ...candle, time: time + 86_400_000 }], "1W")[0].time).toBe(time);
        expect(aggregateBars([{ ...candle, time }], "1M")[0].time).toBe(Date.UTC(2026, 0, 1));
    });

    it("fixture 可重复且仅显式使用，不访问网络", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>();
        const fixture = { ...request, mode: "fixture" as const };
        const result = await loadHistory(fixture, dependencies(fetch));
        expect(result).toEqual({ bars: fixtureBars(fixture), source: "fixture", mode: "fixture", timeframe: "1D", attempts: [] });
        expect(fetch).not.toHaveBeenCalled();
        expect(fixtureBars({ ...fixture, symbol: "MSFT" })).not.toEqual(result.bars);
        expect(fixtureBars({ ...fixture, timeframe: "60" })).toHaveLength(4392);
    });

    it("Yahoo 仅补充非默认粒度，转换秒为毫秒且不泄露密钥", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ chart: { result: [{ timestamp: [candle.time], indicators: { quote: [{ open: [10], high: [12], low: [9], close: [11], volume: [100] }] } }] } }));
        const result = await loadHistory({ ...request, timeframe: "60" }, dependencies(fetch));
        expect(result.source).toBe("yahoo");
        expect(result.bars[0].time).toBe(candle.time * 1000);
        expect(result.attempts).toEqual([{ source: "yahoo", status: "success" }]);
        expect(fetch.mock.calls[0][0]).toContain("range=6mo&interval=60m");
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][1]?.headers).toBeUndefined();
    });

    it("默认周期调用 Express Vela 接口，保留原始毫秒和真实来源", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([expressCandle], { headers: velaHeaders }));
        const result = await loadHistory(request, dependencies(fetch));
        expect(result.source).toBe("nasdaq");
        expect(result.bars).toEqual([{ ...candle, time: expressCandle.timestamp }]);
        expect(result.attempts).toEqual([{ source: "nasdaq", status: "success", cache: "miss" }]);
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][0]).toBe("http://api.test/api/vela/history/AAPL?range=6M&mode=live");
        expect(fetch.mock.calls[0][1]?.headers).toEqual({ "x-api-key": "secret" });
    });

    it.each(RANGES)("范围 %s 的兼容默认周期只调用 Express", async (range) => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([expressCandle], { headers: { ...velaHeaders, "X-Vela-Source": "yahoo", "X-Vela-Attempts": "yahoo" } }));
        await loadHistory({ ...request, range, timeframe: DEFAULT_TIMEFRAME[range] }, dependencies(fetch));
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][0]).toContain(`/api/vela/history/AAPL?range=${range}&mode=live`);
    });

    it("默认周期失败不绕过 Express 请求 Yahoo，也不会变成 fixture", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
        const result = await loadHistory(request, dependencies(fetch));
        expect(result).toMatchObject({ bars: [], source: null, mode: "live", timeframe: "1D" });
        expect(result.attempts).toEqual([{ source: "openterminal-api", status: "error", error: "offline" }]);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it("不会把日线上游伪装为分钟线", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
        await loadHistory({ ...request, timeframe: "5" }, dependencies(fetch));
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        { range: "1D" as const, timeframe: "5" as const, source: "nasdaq", interval: "5m" },
        { range: "5D" as const, timeframe: "15" as const, source: "stooq", interval: "15m" },
        { range: "1M" as const, timeframe: "60" as const, source: "nasdaq", interval: "60m" },
    ])("$range 拒绝 $source 日线后补充 Yahoo 分钟线", async ({ range, timeframe, source, interval }) => {
        const fetch = vi.fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(Response.json([expressCandle], { headers: { ...velaHeaders, "X-Vela-Source": source, "X-Vela-Attempts": source } }))
            .mockResolvedValueOnce(Response.json({ chart: { result: [{ timestamp: [candle.time, candle.time + Number(timeframe) * 60], indicators: { quote: [{ open: [10, 10], high: [12, 12], low: [9, 9], close: [11, 11], volume: [100, 100] }] } }] } }));
        const result = await loadHistory({ ...request, range, timeframe }, dependencies(fetch));
        expect(result.source).toBe("yahoo");
        expect(result.bars).toHaveLength(2);
        expect(result.attempts).toEqual([
            { source, status: "error", cache: "miss", error: expect.stringContaining("日线") },
            { source: "yahoo", status: "success" },
        ]);
        expect(fetch.mock.calls[0][0]).toContain("/api/vela/history/");
        expect(fetch.mock.calls[1][0]).toContain(`interval=${interval}`);
        expect(fetch.mock.calls[1][1]?.headers).toBeUndefined();
    });

    it("缓存日线和 Yahoo 补充失败均保留诊断，不返回伪分钟线", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(Response.json([expressCandle], { headers: { ...velaHeaders, "X-Vela-Cache": "stale", "X-Vela-Attempts": "nasdaq,stooq" } }))
            .mockRejectedValueOnce(new Error("Yahoo offline"));
        const result = await loadHistory({ ...request, range: "1D", timeframe: "5" }, dependencies(fetch));
        expect(result).toMatchObject({ bars: [], source: null, mode: "live", timeframe: "5" });
        expect(result.attempts.filter((attempt) => attempt.cache === "stale")).toHaveLength(3);
        expect(result.attempts.every((attempt) => attempt.status === "error")).toBe(true);
        expect(result.attempts.at(-1)).toEqual({ source: "yahoo", status: "error", error: "Yahoo offline" });
        expect(result).not.toHaveProperty("needsSupplement");
    });

    it("未知来源的实际日间隔也会被拒绝并尝试 Yahoo", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(Response.json([expressCandle, { ...expressCandle, timestamp: expressCandle.timestamp + 86_400_000 }]))
            .mockRejectedValueOnce(new Error("offline"));
        const result = await loadHistory({ ...request, range: "1D", timeframe: "5" }, dependencies(fetch));
        expect(result.bars).toEqual([]);
        expect(result.attempts[0]).toMatchObject({ source: "unknown", status: "error", error: expect.stringContaining("粗粒度") });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("Yahoo 返回粗粒度不能作为分钟补充", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(Response.json([expressCandle], { headers: velaHeaders }))
            .mockResolvedValueOnce(Response.json({ chart: { result: [{ timestamp: [candle.time, candle.time + 86_400], indicators: { quote: [{ open: [10, 10], high: [12, 12], low: [9, 9], close: [11, 11], volume: [100, 100] }] } }] } }));
        const result = await loadHistory({ ...request, range: "1D", timeframe: "5" }, dependencies(fetch));
        expect(result.bars).toEqual([]);
        expect(result.source).toBeNull();
        expect(result.attempts.at(-1)).toMatchObject({ source: "yahoo", status: "error", error: expect.stringContaining("粗粒度") });
    });

    it.each([
        { range: "5Y" as const, timeframe: "1W" as const, source: "nasdaq", expected: Date.UTC(2026, 0, 5) },
        { range: "MAX" as const, timeframe: "1M" as const, source: "stooq", expected: Date.UTC(2026, 0, 1) },
    ])("$range 将 $source 日线聚合为 $timeframe", async ({ range, timeframe, source, expected }) => {
        const time = Date.UTC(2026, 0, 5);
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([
            { ...expressCandle, timestamp: time },
            { ...expressCandle, timestamp: time + 86_400_000, high: 14, low: 8, close: 13, volume: 200 },
        ], { headers: { ...velaHeaders, "X-Vela-Source": source, "X-Vela-Attempts": source } }));
        const result = await loadHistory({ ...request, range, timeframe }, dependencies(fetch));
        expect(result.bars).toEqual([{ time: expected, open: 10, high: 14, low: 8, close: 13, volume: 300 }]);
        expect(result.source).toBe(source);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it("读取回退来源及命中缓存，保留上游尝试顺序", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([expressCandle], { headers: { ...velaHeaders, "X-Vela-Source": "yahoo", "X-Vela-Cache": "hit", "X-Vela-Attempts": "nasdaq, yahoo" } }));
        const result = await loadHistory(request, dependencies(fetch));
        expect(result.source).toBe("yahoo");
        expect(result.attempts).toEqual([{ source: "nasdaq", status: "error", cache: "hit" }, { source: "yahoo", status: "success", cache: "hit" }]);
    });

    it("旧缓存明确标记，本轮提供方尝试全部保留为失败", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([expressCandle], { headers: { ...velaHeaders, "X-Vela-Cache": "stale", "X-Vela-Attempts": "nasdaq,yahoo,stooq" } }));
        const result = await loadHistory(request, dependencies(fetch));
        expect(result.source).toBe("nasdaq");
        expect(result.bars).toHaveLength(1);
        expect(result.attempts).toEqual([
            ...["nasdaq", "yahoo", "stooq"].map((source) => ({ source, status: "error", cache: "stale", error: "本轮获取失败，使用旧缓存" })),
            { source: "nasdaq", status: "success", cache: "stale" },
        ]);
    });

    it("上游 502 保留 X-Vela-Attempts 和错误，不调用 Yahoo", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ error: "unavailable" }, { status: 502, headers: { ...velaHeaders, "X-Vela-Source": "unavailable", "X-Vela-Cache": "none", "X-Vela-Attempts": "nasdaq,yahoo,stooq" } }));
        const result = await loadHistory(request, dependencies(fetch));
        expect(result.bars).toEqual([]);
        expect(result.source).toBeNull();
        expect(result.attempts).toEqual(["nasdaq", "yahoo", "stooq"].map((source) => ({ source, status: "error", cache: "none", error: "unavailable" })));
        expect(fetch).toHaveBeenCalledOnce();
    });

    it("缺少诊断头时明确标记来源及缓存未知", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([expressCandle]));
        const result = await loadHistory(request, dependencies(fetch));
        expect(result.source).toBe("unknown");
        expect(result.attempts).toEqual([{ source: "unknown", status: "success", cache: "unknown" }]);
    });

    it.each([
        { headers: { ...velaHeaders, "X-Vela-Mode": "fixture" }, bars: [expressCandle] },
        { headers: { ...velaHeaders, "X-Vela-Time-Unit": "s" }, bars: [expressCandle] },
        { headers: velaHeaders, bars: [candle] },
    ])("拒绝模式、时间单位或 timestamp 字段不符合约定的上游", async ({ headers, bars }) => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(bars, { headers }));
        const result = await loadHistory(request, dependencies(fetch));
        expect(result.bars).toEqual([]);
        expect(result.source).toBeNull();
        expect(result.attempts[0].status).toBe("error");
    });

    it("客户端携带周期、模式和取消信号，拒绝模式不匹配", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ bars: [candle], source: "fixture", mode: "fixture", timeframe: "1D", attempts: [] }));
        vi.stubGlobal("fetch", fetch);
        try {
            const signal = new AbortController().signal;
            await expect(fetchHistory(request, signal)).rejects.toThrow("不匹配");
            expect(fetch.mock.calls[0][0]).toContain("range=6M&mode=live&timeframe=1D");
            expect(fetch.mock.calls[0][1]?.signal).toBe(signal);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
