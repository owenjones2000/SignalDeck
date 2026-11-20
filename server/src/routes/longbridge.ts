import { Router, type Response } from "express";
import { z } from "zod";
import { requireApiKey } from "../auth.js";

interface LongbridgeOptions {
    baseUrl?: string;
    maxConnections?: number;
    maxConnectionsPerIp?: number;
    connectTimeoutMs?: number;
    idleTimeoutMs?: number;
    heartbeatMs?: number;
}

const errorSchema = z.enum(["service_closed", "not_configured", "sdk_unavailable", "subscription_failed", "unsubscribe_failed", "connection_failed", "invalid_symbols"]);

const statusSchema = z.object({
    configured: z.boolean(),
    available: z.boolean(),
    source: z.literal("longbridge"),
    error: errorSchema.nullable(),
});

async function jsonBody(upstream: globalThis.Response): Promise<unknown> {
    if (!upstream.body) throw new Error("Missing body");
    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 16_384) throw new Error("Response too large");
            chunks.push(chunk.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

async function upstreamError(upstream: globalThis.Response): Promise<string> {
    try {
        const parsed = z.object({ error: errorSchema }).safeParse(await jsonBody(upstream));
        if (parsed.success) return parsed.data.error;
    } catch {}
    return "Longbridge service unavailable";
}

function parseSymbols(query: unknown): string {
    const { symbols } = z.object({ symbols: z.string().max(1000) }).strict().parse(query);
    const raw = symbols.split(",");
    if (raw.length > 20) throw new Error("invalid_symbols");
    return [...new Set(raw.map((symbol) => {
        if (/^[A-Z][A-Z0-9]{0,14}(?:[.-][A-Z0-9]{1,10})?\.US$/.test(symbol)) return symbol;
        if (/^\d{1,5}\.HK$/.test(symbol) && Number(symbol.slice(0, -3)) > 0) return `${Number(symbol.slice(0, -3))}.HK`;
        if (/^\d{6}\.(SH|SZ)$/.test(symbol)) return symbol;
        throw new Error("invalid_symbols");
    }))].join(",");
}

async function write(res: Response, value: Uint8Array, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error("cancelled");
    if (res.write(value)) return;
    await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            res.off("drain", drained);
            signal.removeEventListener("abort", aborted);
        };
        const drained = () => { cleanup(); resolve(); };
        const aborted = () => { cleanup(); reject(new Error("cancelled")); };
        res.once("drain", drained);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
    });
}

export function createLongbridgeGateway(options: LongbridgeOptions = {}) {
    const base = new URL(options.baseUrl ?? process.env.QUANT_URL ?? "http://127.0.0.1:8010");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
        throw new Error("Invalid QUANT_URL");
    }
    const router = Router();
    const active = new Set<AbortController>();
    const statusRequests = new Set<AbortController>();
    const perIp = new Map<string, number>();
    const maxConnections = options.maxConnections ?? 100;
    const maxConnectionsPerIp = options.maxConnectionsPerIp ?? 5;
    let closed = false;
    router.use(requireApiKey);
    router.get("/stream", async (req, res) => {
        let symbols: string;
        try {
            symbols = parseSymbols(req.query);
        } catch {
            res.status(400).json({ error: "invalid_symbols" });
            return;
        }
        if (closed) {
            res.status(503).json({ error: "service_closed" });
            return;
        }
        const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
        if (active.size >= maxConnections || (perIp.get(ip) ?? 0) >= maxConnectionsPerIp) {
            res.setHeader("Retry-After", "1");
            res.status(429).json({ error: "Longbridge connection limit exceeded" });
            return;
        }
        const controller = new AbortController();
        active.add(controller);
        perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
        const cancel = () => controller.abort();
        res.once("close", cancel);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let timedOut = false;
        const timeout = () => { timedOut = true; controller.abort(); };
        let deadline = setTimeout(timeout, options.connectTimeoutMs ?? 10_000);
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        try {
            const url = new URL("longbridge/stream", `${base.href.replace(/\/$/, "")}/`);
            url.searchParams.set("symbols", symbols);
            const upstream = await fetch(url, {
                headers: { Accept: "text/event-stream" }, redirect: "error", cache: "no-store", signal: controller.signal,
            });
            if (!upstream.ok) {
                const error = await upstreamError(upstream);
                const retry = upstream.headers.get("retry-after");
                if (retry && /^\d{1,5}$/.test(retry)) res.setHeader("Retry-After", retry);
                res.status(timedOut ? 504 : upstream.status).json({ error: timedOut ? "upstream_timeout" : error });
                return;
            }
            clearTimeout(deadline);
            if (upstream.headers.get("content-type")?.split(";")[0].trim() !== "text/event-stream" || !upstream.body) {
                await upstream.body?.cancel();
                throw new Error("Invalid stream");
            }
            reader = upstream.body.getReader();
            res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
            res.flushHeaders();
            const decoder = new TextDecoder();
            let tail = "";
            let boundary = true;
            deadline = setTimeout(timeout, options.idleTimeoutMs ?? 45_000);
            heartbeat = setInterval(() => {
                if (boundary && !res.writableNeedDrain && !controller.signal.aborted) res.write(": heartbeat\n\n");
            }, options.heartbeatMs ?? 15_000);
            while (!controller.signal.aborted) {
                const chunk = await reader.read();
                if (chunk.done) break;
                clearTimeout(deadline);
                deadline = setTimeout(timeout, options.idleTimeoutMs ?? 45_000);
                tail = (tail + decoder.decode(chunk.value, { stream: true })).slice(-4);
                boundary = tail.endsWith("\n\n") || tail.endsWith("\r\n\r\n");
                await write(res, chunk.value, controller.signal);
            }
            res.end();
        } catch {
            if (!res.destroyed) {
                if (!res.headersSent) res.status(timedOut ? 504 : 502).json({ error: timedOut ? "upstream_timeout" : "Longbridge service unavailable" });
                else res.end(timedOut ? "\n\nevent: error\ndata: {\"error\":\"upstream_timeout\",\"source\":\"longbridge\"}\n\n" : undefined);
            }
        } finally {
            clearTimeout(deadline);
            clearInterval(heartbeat);
            controller.abort();
            await reader?.cancel().catch(() => {});
            reader?.releaseLock();
            res.off("close", cancel);
            active.delete(controller);
            const remaining = (perIp.get(ip) ?? 1) - 1;
            if (remaining) perIp.set(ip, remaining);
            else perIp.delete(ip);
        }
    });
    router.get("/status", async (_req, res) => {
        if (closed) {
            res.status(503).json({ error: "service_closed" });
            return;
        }
        const controller = new AbortController();
        statusRequests.add(controller);
        const cancel = () => controller.abort();
        res.once("close", cancel);
        let timedOut = false;
        const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, options.connectTimeoutMs ?? 10_000);
        try {
            const upstream = await fetch(new URL("longbridge/status", `${base.href.replace(/\/$/, "")}/`), {
                redirect: "error", cache: "no-store", signal: controller.signal,
            });
            if (!upstream.ok) {
                const error = await upstreamError(upstream);
                res.status(timedOut ? 504 : upstream.status).json({ error: timedOut ? "upstream_timeout" : error });
                return;
            }
            res.setHeader("Cache-Control", "no-store");
            res.json(statusSchema.parse(await jsonBody(upstream)));
        } catch {
            if (!res.destroyed) res.status(timedOut ? 504 : 502).json({ error: timedOut ? "upstream_timeout" : "Longbridge service unavailable" });
        } finally {
            clearTimeout(deadline);
            controller.abort();
            res.off("close", cancel);
            statusRequests.delete(controller);
        }
    });
    return { router, close() {
        closed = true;
        active.forEach((controller) => controller.abort());
        statusRequests.forEach((controller) => controller.abort());
    } };
}
