import { fixtureBars } from "./fixture";
import { adaptGranularity, CoarseGranularityError } from "./granularity";
import { DEFAULT_TIMEFRAME, normalizeBars, type Attempt, type Bar, type HistoryRequest, type HistoryResult } from "./types";

type Dependencies = { fetch: typeof fetch; apiUrl: string; apiKey: string | null };

async function json(url: string, dependencies: Dependencies, headers?: HeadersInit): Promise<unknown> {
    const response = await dependencies.fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function yahoo(request: HistoryRequest, dependencies: Dependencies): Promise<Bar[]> {
    const interval = { "1": "1m", "5": "5m", "15": "15m", "60": "60m", "240": "60m", "1D": "1d", "1W": "1wk", "1M": "1mo" }[request.timeframe];
    const range = { "1D": "1d", "5D": "5d", "1M": "1mo", "6M": "6mo", YTD: "ytd", "1Y": "1y", "5Y": "5y", MAX: "max" }[request.range];
    const value = await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(request.symbol)}?range=${range}&interval=${interval}`, dependencies);
    const payload = value as { chart?: { error?: { description?: string }; result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }> } }> } };
    if (payload.chart?.error) throw new Error(payload.chart.error.description ?? "Yahoo 行情失败");
    const result = payload.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const bars = normalizeBars(result?.timestamp?.map((time, index) => ({
        time, open: quote?.open?.[index], high: quote?.high?.[index], low: quote?.low?.[index], close: quote?.close?.[index], volume: quote?.volume?.[index] ?? 0,
    })), "seconds");
    return adaptGranularity(bars, request.timeframe, "yahoo");
}

async function expressHistory(request: HistoryRequest, dependencies: Dependencies): Promise<HistoryResult & { needsSupplement?: boolean }> {
    const result: HistoryResult & { needsSupplement?: boolean } = { bars: [], source: null, mode: "live", timeframe: request.timeframe, attempts: [] };
    try {
        const headers: HeadersInit = dependencies.apiKey ? { "x-api-key": dependencies.apiKey } : {};
        const response = await dependencies.fetch(`${dependencies.apiUrl}/api/vela/history/${encodeURIComponent(request.symbol)}?range=${request.range}&mode=live`, {
            headers, cache: "no-store", signal: AbortSignal.timeout(12_000),
        });
        const source = response.headers.get("X-Vela-Source");
        const cacheHeader = response.headers.get("X-Vela-Cache");
        const cache: Attempt["cache"] = cacheHeader === "hit" || cacheHeader === "miss" || cacheHeader === "stale" || cacheHeader === "none" ? cacheHeader : "unknown";
        const sources = (response.headers.get("X-Vela-Attempts") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        result.attempts = sources.map((provider) => ({ source: provider, status: "error", cache }));
        const payload: unknown = await response.json();
        if (!response.ok) {
            const error = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
            if (!result.attempts.length) result.attempts.push({ source: "openterminal-api", status: "error", cache });
            result.attempts = result.attempts.map((attempt) => ({ ...attempt, error }));
            return result;
        }
        if (response.headers.get("X-Vela-Mode") === "fixture") throw new Error("Express 返回了 fixture，不能作为 live 行情");
        const unit = response.headers.get("X-Vela-Time-Unit");
        if (unit && unit !== "ms") throw new Error(`Express 时间单位无效：${unit}`);
        if (!Array.isArray(payload)) throw new Error("Express 行情数据不是数组");
        result.bars = normalizeBars(payload.map((row: unknown) => {
            if (!row || typeof row !== "object" || !("timestamp" in row)) return null;
            return { ...row, time: row.timestamp };
        }), "milliseconds");
        result.source = source && source !== "unavailable" ? source : "unknown";
        if (cache === "stale") {
            result.attempts = result.attempts.map((attempt) => ({ ...attempt, error: "本轮获取失败，使用旧缓存" }));
            result.attempts.push({ source: result.source, status: "success", cache });
        } else {
            const winner = result.attempts.findLastIndex((attempt) => attempt.source === result.source);
            if (winner >= 0) result.attempts[winner] = { source: result.source, status: "success", cache };
            else result.attempts.push({ source: result.source, status: "success", cache });
        }
        result.bars = adaptGranularity(result.bars, request.timeframe, result.source);
    } catch (error) {
        if (error instanceof CoarseGranularityError) result.needsSupplement = true;
        result.bars = [];
        result.source = null;
        const message = error instanceof Error ? error.message : String(error);
        result.attempts = (result.attempts.length ? result.attempts : [{ source: "openterminal-api", status: "error" }]).map((attempt) => ({ ...attempt, status: "error", error: message }));
    }
    return result;
}

export async function loadHistory(request: HistoryRequest, dependencies: Dependencies): Promise<HistoryResult> {
    if (request.mode === "fixture") {
        return { bars: fixtureBars(request), source: "fixture", mode: "fixture", timeframe: request.timeframe, attempts: [] };
    }
    let result: HistoryResult = { bars: [], source: null, mode: "live", timeframe: request.timeframe, attempts: [] };
    if (request.timeframe === DEFAULT_TIMEFRAME[request.range]) {
        const { needsSupplement, ...upstream } = await expressHistory(request, dependencies);
        if (!needsSupplement) return upstream;
        result = upstream;
    }
    try {
        result.bars = await yahoo(request, dependencies);
        result.source = "yahoo";
        result.attempts.push({ source: "yahoo", status: "success" });
    } catch (error) {
        result.attempts.push({ source: "yahoo", status: "error", error: error instanceof Error ? error.message : String(error) });
    }
    return result;
}
