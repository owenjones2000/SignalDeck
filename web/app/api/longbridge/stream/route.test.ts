import { NextRequest } from "next/server";
import { createServer, type Server, type ServerResponse, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const servers: Server[] = [];

async function setup(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    vi.stubEnv("API_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    vi.stubEnv("API_KEY", "server-private-key");
}

function request(headers: HeadersInit = { "sec-fetch-site": "same-origin" }, signal?: AbortSignal, query = "symbols=AAPL.US") {
    return new NextRequest(`http://localhost:3000/api/longbridge/stream?${query}`, { headers, signal });
}

afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    })));
});

describe("长桥 Next GET 边界", () => {
    it("拒绝重定向且不向重定向目标发送鉴权头", async () => {
        let calls = 0;
        await setup((_req, res) => {
            calls++;
            res.writeHead(302, { location: "/private" });
            res.end();
        });
        expect((await GET(request())).status).toBe(502);
        expect(calls).toBe(1);
    });

    it("拒绝非 SSE 内容并过滤上游正文", async () => {
        await setup((_req, res) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end("server-private-key");
        });
        const response = await GET(request());
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain("server-private-key");
    });

    it("错误响应正文停滞也返回 504，不只限制响应头", async () => {
        let closed = false;
        await setup((_req, res) => {
            res.writeHead(503, { "content-type": "application/json" });
            res.flushHeaders();
            res.on("close", () => { closed = true; });
        });
        const original = globalThis.setTimeout;
        vi.spyOn(globalThis, "setTimeout").mockImplementationOnce((callback) => original(callback, 50));
        expect((await GET(request())).status).toBe(504);
        await expect.poll(() => closed).toBe(true);
    });

    it("上游中断时流报错不包含异常详情", async () => {
        let upstream: ServerResponse | undefined;
        await setup((_req, res) => {
            upstream = res;
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write("event: ready\ndata: {}\n\n");
        });
        const response = await GET(request());
        const reader = response.body!.getReader();
        await reader.read();
        const pending = reader.read();
        upstream!.destroy(new Error("server-private-key"));
        await expect(pending).rejects.toThrow("长桥流已断开");
    });

    it("上游持续有数据时跨越普通 30 秒代理时限仍保持流", async () => {
        let upstream: ServerResponse | undefined;
        await setup((_req, res) => {
            upstream = res;
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write("event: ready\ndata: {}\n\n");
        });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const response = await GET(request());
        const reader = response.body!.getReader();
        await reader.read();
        await vi.advanceTimersByTimeAsync(40_000);
        upstream!.write("event: heartbeat\ndata: {}\n\n");
        expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: heartbeat");
        await vi.advanceTimersByTimeAsync(40_000);
        upstream!.end("event: quote\ndata: {}\n\n");
        expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: quote");
        expect((await reader.read()).done).toBe(true);
    });

    it.each([401, 422, 429, 503])("保留 %s 状态、业务错误和安全 Retry-After，过滤凭据响应头", async (status) => {
        await setup((_req, res) => {
            res.writeHead(status, {
                "content-type": "application/json", "retry-after": "2", "x-api-key": "server-private-key", "set-cookie": "secret=private",
            });
            res.end(JSON.stringify({ error: "not_configured", key: "server-private-key" }));
        });
        const response = await GET(request());
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error: "not_configured" });
        expect(response.headers.get("retry-after")).toBe("2");
        expect(response.headers.get("x-api-key")).toBeNull();
        expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("不透传未知上游错误正文和异常详情", async () => {
        await setup((_req, res) => {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "Bearer server-private-key" }));
        });
        const response = await GET(request());
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain("server-private-key");
    });

    it.each<Record<string, string>>([
        { origin: "http://localhost:3000" },
        { referer: "http://localhost:3000/page" },
        { "sec-fetch-site": "same-origin" },
    ])("同源证据 %j 可以连接，EOF 正常关闭", async (headers) => {
        await setup((_req, res) => {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end("event: ready\ndata: {}\n\n");
        });
        const response = await GET(request(headers));
        expect(await response.text()).toBe("event: ready\ndata: {}\n\n");
    });

    it("等待响应头时请求取消会中止上游", async () => {
        let connected = false;
        let closed = false;
        await setup((_req, res) => {
            connected = true;
            res.on("close", () => { closed = true; });
        });
        const controller = new AbortController();
        const response = GET(request(undefined, controller.signal));
        await expect.poll(() => connected).toBe(true);
        controller.abort();
        expect((await response).status).toBe(502);
        await expect.poll(() => closed).toBe(true);
    });

    it("响应头超时返回 504 并取消上游", async () => {
        let closed = false;
        await setup((_req, res) => {
            res.on("close", () => { closed = true; });
        });
        const original = globalThis.setTimeout;
        vi.spyOn(globalThis, "setTimeout").mockImplementationOnce((callback) => original(callback, 50));
        expect((await GET(request())).status).toBe(504);
        await expect.poll(() => closed).toBe(true);
    });

    it("拒绝额外查询参数和无效证券，不把 key 放入上游 URL", async () => {
        let calls = 0;
        await setup((_req, res) => { calls++; res.end(); });
        for (const query of ["", "symbols=AAPL.US&key=private", "symbols=AAPL.US&symbols=700.HK", "symbols=600000.BJ", "symbols=0.HK", `symbols=${Array(21).fill("AAPL.US").join(",")}`]) {
            expect((await GET(request(undefined, undefined, query))).status).toBe(400);
        }
        expect(calls).toBe(0);
    });

    it("请求中止即使没有读取响应体也关闭上游", async () => {
        let closed = false;
        await setup((_req, res) => {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write("event: ready\ndata: {}\n\n");
            res.on("close", () => { closed = true; });
        });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const controller = new AbortController();
        expect((await GET(request(undefined, controller.signal))).status).toBe(200);
        controller.abort();
        await Promise.resolve();
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
        await expect.poll(() => closed).toBe(true);
    });

    it("Next 上游空闲超时取消连接，不自行产生掩盖停滞的心跳", async () => {
        let closed = false;
        await setup((_req, res) => {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write("event: ready\ndata: {}\n\n");
            res.on("close", () => { closed = true; });
        });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const response = await GET(request());
        const reader = response.body!.getReader();
        await reader.read();
        const pending = reader.read();
        const rejected = expect(pending).rejects.toThrow("长桥流已断开");
        await vi.advanceTimersByTimeAsync(60_001);
        await rejected;
        vi.useRealTimers();
        await expect.poll(() => closed).toBe(true);
    });

    it("服务器注入 key、逐块转发，不转发浏览器凭据或敏感响应头，取消传播至上游", async () => {
        let upstream: ServerResponse | undefined;
        let closed = false;
        await setup((req, res) => {
            expect(req.url).toBe("/api/longbridge/stream?symbols=AAPL.US");
            expect(req.headers["x-api-key"]).toBe("server-private-key");
            expect(req.headers.authorization).toBeUndefined();
            expect(req.headers.cookie).toBeUndefined();
            res.writeHead(200, {
                "content-type": "text/event-stream", "x-api-key": "server-private-key", "set-cookie": "private=secret",
            });
            res.write("event: ready\ndata: {}\n\n");
            upstream = res;
            res.on("close", () => { closed = true; });
        });
        const response = await GET(request({
            "sec-fetch-site": "same-origin", "x-api-key": "browser-key", authorization: "Bearer private", cookie: "secret=browser",
        }));
        expect(response.status).toBe(200);
        expect(response.headers.get("x-api-key")).toBeNull();
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(response.headers.get("x-accel-buffering")).toBe("no");
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: ready\ndata: {}\n\n");
        upstream!.write("event: quote\ndata: {\"price\":123}\n\n");
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: quote\ndata: {\"price\":123}\n\n");
        await reader.cancel();
        await expect.poll(() => closed).toBe(true);
    });

    it("拒绝跨源及无同源证据请求，不连接上游", async () => {
        let calls = 0;
        await setup((_req, res) => { calls++; res.end(); });
        const denied: Record<string, string>[] = [
            {},
            { origin: "https://evil.example" },
            { origin: "null" },
            { "sec-fetch-site": "same-site" },
            { "sec-fetch-site": "cross-site", origin: "http://localhost:3000" },
            { referer: "http://localhost:3000.evil.example/page" },
            { origin: "https://evil.example", "x-forwarded-host": "evil.example" },
        ];
        for (const headers of denied) {
            expect((await GET(request(headers))).status).toBe(403);
        }
        expect(calls).toBe(0);
    });
});
