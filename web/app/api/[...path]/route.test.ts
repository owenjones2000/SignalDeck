import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PATCH, DELETE } from "./route";

vi.mock("@/lib/api-key", () => ({ getApiKey: () => "server-secret" }));
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

it.each([
    ["GET", GET, ["quant", "history", "000001"], "?count=250", undefined],
    ["POST", POST, ["quant", "jobs"], "", { kind: "screen", params: { codes: ["000001"], formula: "ma_cross", count: 250 } }],
    ["PATCH", PATCH, ["quant", "alerts", "a1"], "", { enabled: false }],
    ["DELETE", DELETE, ["quant", "watchlist", "000001"], "", undefined],
] as const)("proxies %s quant requests with server-only authentication", async (method, handler, path, search, body) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    const req = new NextRequest(`http://localhost/api/${path.join("/")}${search}`, {
        method, headers: { "Content-Type": "application/json", "x-api-key": "untrusted-browser-key" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await handler(req, { params: Promise.resolve({ path: [...path] }) });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain(`/api/${path.join("/")}${search}`);
    expect(options?.method).toBe(method);
    expect((options?.headers as Headers).get("x-api-key")).toBe("server-secret");
    expect(options?.body).toBe(body === undefined ? undefined : JSON.stringify(body));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("x-api-key")).toBeNull();
});

it("preserves upstream authentication errors", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: "Invalid API key" }, { status: 403 }));
    const response = await GET(new NextRequest("http://localhost/api/quant/status"), { params: Promise.resolve({ path: ["quant", "status"] }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid API key" });
});

it("returns a visible service error when the upstream is unreachable", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const response = await GET(new NextRequest("http://localhost/api/quant/status"), { params: Promise.resolve({ path: ["quant", "status"] }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "API 服务无法连接，请检查服务地址和运行状态" });
});
