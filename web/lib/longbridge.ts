export type LongbridgeStatus = { configured: boolean; available: boolean; source: "longbridge"; error: string | null };
export type LongbridgeQuote = {
    symbol: string;
    price: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
    turnover: number | null;
    timestamp: string | null;
    source: "longbridge";
};

export function parseLongbridgeSymbols(input: string): string[] {
    const raw = input.trim().toUpperCase().split(/[\s,，;；]+/).filter(Boolean);
    if (raw.length === 0 || raw.length > 20 || raw.some((symbol) => !(
        /^[A-Z][A-Z0-9]{0,14}(?:[.-][A-Z0-9]{1,10})?\.US$/.test(symbol)
        || (/^\d{1,5}\.HK$/.test(symbol) && Number(symbol.slice(0, -3)) > 0)
        || /^\d{6}\.(SH|SZ)$/.test(symbol)
    ))) throw new Error("invalid_symbols");
    return [...new Set(raw.map((symbol) => symbol.endsWith(".HK") ? `${Number(symbol.slice(0, -3))}.HK` : symbol))];
}

export async function fetchLongbridgeStatus(signal?: AbortSignal): Promise<LongbridgeStatus> {
    const response = await fetch("/api/longbridge/status", { signal, cache: "no-store" });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
    if (typeof body !== "object" || body === null || !("configured" in body) || typeof body.configured !== "boolean"
        || !("available" in body) || typeof body.available !== "boolean" || !("source" in body) || body.source !== "longbridge"
        || !("error" in body) || !(body.error === null || typeof body.error === "string")) throw new Error("invalid_status");
    return body as LongbridgeStatus;
}

export function readLongbridgeQuote(value: unknown, symbols: string[]): LongbridgeQuote | null {
    if (typeof value !== "object" || value === null) return null;
    const row = value as Record<string, unknown>;
    if (row.source !== "longbridge" || typeof row.symbol !== "string" || !symbols.includes(row.symbol)) return null;
    const numbers = ["price", "open", "high", "low", "volume", "turnover"] as const;
    if (numbers.some((key) => row[key] !== null && !(typeof row[key] === "number" && Number.isFinite(row[key])))) return null;
    if (row.timestamp !== null && !(typeof row.timestamp === "string" && Number.isFinite(Date.parse(row.timestamp)))) return null;
    return { symbol: row.symbol, source: "longbridge", timestamp: row.timestamp as string | null,
        ...Object.fromEntries(numbers.map((key) => [key, row[key]])) } as LongbridgeQuote;
}
