import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";
import { loadHistory } from "@/lib/vela/history.server";
import { DEFAULT_TIMEFRAME, RANGES, TIMEFRAMES, type Range, type Timeframe } from "@/lib/vela/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await context.params;
    const range = request.nextUrl.searchParams.get("range") ?? "6M";
    const mode = request.nextUrl.searchParams.get("mode") ?? "live";
    const timeframe = request.nextUrl.searchParams.get("timeframe") ?? DEFAULT_TIMEFRAME[range as Range];
    if (!symbol.trim() || symbol.length > 80 || !RANGES.includes(range as Range) || !TIMEFRAMES.includes(timeframe as Timeframe) || (mode !== "live" && mode !== "fixture" && mode !== "longbridge")) {
        return NextResponse.json({ error: "symbol、range、mode 或 timeframe 无效" }, { status: 400 });
    }
    if (mode === "longbridge") {
        if (!/^(?:0?7709)(?:\.HK)?$/i.test(symbol.trim()) || !["30", "1D", "1W"].includes(timeframe)) {
            return NextResponse.json({ error: "长桥前复权仅支持 07709.HK 的 30m、1D、1W" }, { status: 400 });
        }
        try {
            const response = await fetch(`${process.env.QUANT_URL ?? "http://127.0.0.1:8010"}/kline/longbridge/${timeframe}`, {
                cache: "no-store", signal: AbortSignal.timeout(6000),
            });
            if (!response.ok) throw new Error();
            const bars = await response.json();
            if (!Array.isArray(bars) || !bars.length) throw new Error();
            return NextResponse.json({ bars, source: "longbridge", mode, timeframe, attempts: [{ source: "longbridge", status: "success" }] });
        } catch {
            return NextResponse.json({ error: "长桥前复权历史不可用" }, { status: 503 });
        }
    }
    const result = await loadHistory({ symbol: symbol.trim().toUpperCase(), range: range as Range, mode, timeframe: timeframe as Timeframe }, {
        fetch, apiUrl: process.env.API_URL ?? "http://localhost:4000", apiKey: getApiKey(),
    });
    return NextResponse.json(result, { status: result.bars.length ? 200 : 502, headers: { "Cache-Control": "no-store" } });
}
