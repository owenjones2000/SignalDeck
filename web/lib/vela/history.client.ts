import { normalizeBars, type HistoryRequest, type HistoryResult } from "./types";

export async function fetchHistory(request: HistoryRequest, signal?: AbortSignal): Promise<HistoryResult> {
    const query = new URLSearchParams({ range: request.range, mode: request.mode, timeframe: request.timeframe });
    const response = await fetch(`/api/vela/history/${encodeURIComponent(request.symbol)}?${query}`, { signal });
    const result = await response.json() as HistoryResult & { error?: string };
    if (!response.ok) {
        throw new Error(result.error ?? result.attempts?.map((attempt) => `${attempt.source}: ${attempt.error}`).join("; ") ?? `HTTP ${response.status}`);
    }
    if (result.mode !== request.mode || result.timeframe !== request.timeframe) throw new Error("行情模式或周期不匹配");
    return { ...result, bars: normalizeBars(result.bars, "milliseconds") };
}
