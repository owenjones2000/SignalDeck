import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: NextRequest): boolean {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") return false;
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    try {
        if (origin && new URL(origin).origin !== request.nextUrl.origin) return false;
        if (referer && new URL(referer).origin !== request.nextUrl.origin) return false;
    } catch {
        return false;
    }
    return site === "same-origin" || Boolean(origin || referer);
}

function symbolsQuery(request: NextRequest): string | null {
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some((key) => key !== "symbols") || params.getAll("symbols").length !== 1) return null;
    const raw = params.get("symbols")!;
    if (raw.length > 1000) return null;
    const symbols = raw.split(",");
    if (symbols.length > 20 || symbols.some((symbol) => !(
        /^[A-Z][A-Z0-9]{0,14}(?:[.-][A-Z0-9]{1,10})?\.US$/.test(symbol)
        || (/^\d{1,5}\.HK$/.test(symbol) && Number(symbol.slice(0, -3)) > 0)
        || /^\d{6}\.(SH|SZ)$/.test(symbol)
    ))) return null;
    return raw;
}

async function upstreamError(upstream: Response): Promise<string> {
    const allowed = new Set([
        "service_closed", "not_configured", "sdk_unavailable", "subscription_failed", "unsubscribe_failed",
        "connection_failed", "invalid_symbols", "upstream_timeout", "Longbridge connection limit exceeded",
    ]);
    const reader = upstream.body?.getReader();
    if (!reader) return "长桥服务暂不可用";
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 16_384) break;
            chunks.push(chunk.value);
        }
        if (size <= 16_384) {
            const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" && allowed.has(payload.error)) {
                return payload.error;
            }
        }
    } catch {} finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    return "长桥服务暂不可用";
}

export async function GET(request: NextRequest) {
    if (!sameOrigin(request)) return NextResponse.json({ error: "仅允许同源请求" }, { status: 403 });
    const symbols = symbolsQuery(request);
    if (!symbols) return NextResponse.json({ error: "invalid_symbols" }, { status: 400 });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timedOut = false;
    const timeout = () => { timedOut = true; controller.abort(); };
    let deadline = setTimeout(timeout, 10_000);
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = async () => {
        if (!cleanupPromise) cleanupPromise = (async () => {
            clearTimeout(deadline);
            request.signal.removeEventListener("abort", cancel);
            controller.abort();
            await reader?.cancel().catch(() => {});
            reader?.releaseLock();
        })();
        await cleanupPromise;
    };
    const cancel = () => { void cleanup(); };
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) {
        await cleanup();
        return NextResponse.json({ error: "长桥服务暂不可用" }, { status: 502 });
    }
    try {
        const url = new URL("/api/longbridge/stream", process.env.API_URL ?? "http://localhost:4000");
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid API_URL");
        url.searchParams.set("symbols", symbols);
        const headers = new Headers({ Accept: "text/event-stream" });
        const key = getApiKey();
        if (!key) throw new Error("Missing API key");
        headers.set("x-api-key", key);
        const upstream = await fetch(url, { headers, signal: controller.signal, redirect: "error", cache: "no-store" });
        if (!upstream.ok) {
            const error = await upstreamError(upstream);
            const retry = upstream.headers.get("retry-after");
            const responseHeaders = new Headers({ "Cache-Control": "no-store" });
            if (retry && /^\d{1,5}$/.test(retry)) responseHeaders.set("Retry-After", retry);
            await cleanup();
            return NextResponse.json({ error }, { status: timedOut ? 504 : upstream.status, headers: responseHeaders });
        }
        clearTimeout(deadline);
        if (!upstream.body || upstream.headers.get("content-type")?.split(";")[0].trim() !== "text/event-stream") {
            await upstream.body?.cancel();
            throw new Error("Invalid stream");
        }
        reader = upstream.body.getReader();
        if (controller.signal.aborted) {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
            throw new Error("Cancelled");
        }
        deadline = setTimeout(timeout, 60_000);
        let finished = false;
        const body = new ReadableStream<Uint8Array>({
            async pull(stream) {
                try {
                    const chunk = await reader!.read();
                    if (finished) return;
                    if (chunk.done) {
                        finished = true;
                        stream.close();
                        await cleanup();
                    } else {
                        clearTimeout(deadline);
                        deadline = setTimeout(timeout, 60_000);
                        stream.enqueue(chunk.value);
                    }
                } catch {
                    if (!finished) {
                        finished = true;
                        stream.error(new Error("长桥流已断开"));
                    }
                    await cleanup();
                }
            },
            async cancel() {
                finished = true;
                await cleanup();
            },
        }, { highWaterMark: 0 });
        return new NextResponse(body, { headers: {
            "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
        } });
    } catch {
        await cleanup();
        return NextResponse.json({ error: "长桥服务暂不可用" }, { status: timedOut ? 504 : 502 });
    }
}
