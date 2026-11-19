import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactNode } from "react";

export function renderQuant(ui: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

export function mockApi(routes: Record<string, unknown | (() => unknown)>) {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
        const key = `${options?.method ?? "GET"} ${url}`;
        if (!(key in routes)) throw new Error(`Unexpected request: ${key}`);
        const route = routes[key];
        const value = typeof route === "function" ? route() : route;
        return value instanceof Response ? value : Response.json(value);
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
}

export const status = {
    available: true, health: { status: "ok", source: "akshare/eastmoney", market_verified: false },
    channels: { local: true, feishu: false, email: false }, scheduler: { allowed: false, reason: "outside trading hours" },
};

export const job = {
    id: "j1", kind: "screen", params: { formula: "ma_cross", codes: ["000001"], count: 250 },
    status: "queued", result: null, error: null, created_at: "2026-11-18T10:00:00Z", updated_at: "2026-11-18T10:00:00Z",
};
