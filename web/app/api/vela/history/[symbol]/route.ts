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
    if (!symbol.trim() || symbol.length > 80 || !RANGES.includes(range as Range) || !TIMEFRAMES.includes(timeframe as Timeframe) || (mode !== "live" && mode !== "fixture")) {
        return NextResponse.json({ error: "symbol、range、mode 或 timeframe 无效" }, { status: 400 });
    }
    const result = await loadHistory({ symbol: symbol.trim().toUpperCase(), range: range as Range, mode, timeframe: timeframe as Timeframe }, {
        fetch, apiUrl: process.env.API_URL ?? "http://localhost:4000", apiKey: getApiKey(),
    });
    return NextResponse.json(result, { status: result.bars.length ? 200 : 502, headers: { "Cache-Control": "no-store" } });
}
