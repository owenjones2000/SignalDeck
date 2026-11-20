"use client";

import { useEffect, useState } from "react";
import { readLongbridgeQuote, type LongbridgeQuote } from "../../lib/longbridge";

type StreamState = {
    connection: "idle" | "connecting" | "ready" | "live" | "retrying" | "stopped";
    quotes: Record<string, LongbridgeQuote>;
    heartbeat: string | null;
    error: string | null;
    retrySeconds: number;
    staleSymbols: string[];
};

const initial: StreamState = { connection: "idle", quotes: {}, heartbeat: null, error: null, retrySeconds: 0, staleSymbols: [] };

export function useLongbridgeStream(symbols: string[] | null) {
    const [state, setState] = useState<StreamState>(initial);

    useEffect(() => {
        setState(initial);
        if (!symbols) return;
        let cancelled = false;
        let attempt = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let close: (() => void) | undefined;
        function connect() {
            if (cancelled) return;
            setState((previous) => ({ ...previous, connection: "connecting" }));
            let stream: EventSource;
            try { stream = new EventSource(`/api/longbridge/stream?${new URLSearchParams({ symbols: symbols!.join(",") })}`); }
            catch { fail("connection_failed"); return; }
            const listeners: [string, EventListener][] = [];
            let closed = false;
            close = () => {
                if (closed) return;
                closed = true;
                for (const [type, listener] of listeners) stream.removeEventListener(type, listener);
                stream.close();
            };
            function listen(type: string, handler: (payload: unknown) => void) {
                const listener: EventListener = (event) => {
                    if (cancelled || closed || !(event instanceof MessageEvent)) return;
                    try { handler(JSON.parse(event.data)); } catch {}
                };
                listeners.push([type, listener]);
                stream.addEventListener(type, listener);
            }
            listen("ready", (payload) => {
                if (typeof payload === "object" && payload !== null && "source" in payload && payload.source === "longbridge") {
                    attempt = 0;
                    setState((previous) => ({ ...previous, connection: "ready", error: null, retrySeconds: 0 }));
                }
            });
            listen("quote", (payload) => {
                const quote = readLongbridgeQuote(payload, symbols!);
                if (quote) setState((previous) => {
                    const prior = previous.quotes[quote.symbol];
                    if (prior?.timestamp && (!quote.timestamp || Date.parse(quote.timestamp) < Date.parse(prior.timestamp))) return previous;
                    return { ...previous, connection: "live", quotes: { ...previous.quotes, [quote.symbol]: quote }, staleSymbols: previous.staleSymbols.filter((symbol) => symbol !== quote.symbol), error: null };
                });
            });
            listen("heartbeat", (payload) => {
                if (typeof payload === "object" && payload !== null && "source" in payload && payload.source === "longbridge") {
                    setState((previous) => ({ ...previous, heartbeat: new Date().toISOString() }));
                }
            });
            const onError: EventListener = (event) => {
                if (cancelled || closed) return;
                let error = "connection_failed";
                if (event instanceof MessageEvent) {
                    try {
                        const payload: unknown = JSON.parse(event.data);
                        if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") error = payload.error;
                    } catch {}
                }
                fail(error);
            };
            listeners.push(["error", onError]);
            stream.addEventListener("error", onError);
        }
        function fail(error: string) {
            if (cancelled) return;
            close?.();
            const terminal = ["not_configured", "sdk_unavailable", "invalid_symbols", "service_closed"].includes(error);
            const retrySeconds = Math.min(30, 2 ** Math.min(attempt++, 5));
            setState((previous) => ({ ...previous, connection: terminal ? "stopped" : "retrying", error, retrySeconds, staleSymbols: Object.keys(previous.quotes) }));
            if (!terminal) timer = setTimeout(connect, retrySeconds * 1000);
        }
        connect();
        return () => {
            cancelled = true;
            clearTimeout(timer);
            close?.();
        };
    }, [symbols]);

    return state;
}
