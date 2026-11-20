import express from "express";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { apiKey } from "../auth.js";
import { createLongbridgeGateway } from "./longbridge.js";

const servers: Server[] = [];
const gateways: ReturnType<typeof createLongbridgeGateway>[] = [];

async function listen(server: Server): Promise<string> {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function setup(handler: (req: IncomingMessage, res: ServerResponse) => void, options = {}) {
    const upstream = await listen(createServer(handler));
    const gateway = createLongbridgeGateway({ baseUrl: upstream, ...options });
    gateways.push(gateway);
    const app = express();
    app.use("/api/longbridge", gateway.router);
    return listen(createServer(app));
}

function request(base: string, path: string, signal?: AbortSignal) {
    return fetch(`${base}/api/longbridge/${path}`, { headers: { "x-api-key": apiKey }, signal });
}

afterEach(async () => {
    gateways.splice(0).forEach((gateway) => gateway.close());
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    })));
});

describe("长桥 Express HTTP 边界", () => {
    it("状态响应严格过滤未知错误和额外敏感字段", async () => {
        let calls = 0;
        const base = await setup((_req, res) => {
            calls++;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ configured: true, available: false, source: "longbridge", error: calls === 1 ? "connection_failed" : apiKey, key: apiKey }));
        });
        const response = await request(base, "status");
        expect(await response.json()).toEqual({ configured: true, available: false, source: "longbridge", error: "connection_failed" });
        const invalid = await request(base, "status");
        expect(invalid.status).toBe(502);
        expect(await invalid.text()).not.toContain(apiKey);
    });

    it("错误正文停滞和过大状态正文不会无限读取", async () => {
        let calls = 0;
        const base = await setup((_req, res) => {
            calls++;
            if (calls === 1) {
                res.writeHead(503, { "content-type": "application/json" });
                res.flushHeaders();
            } else {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ error: "x".repeat(20_000) }));
            }
        }, { connectTimeoutMs: 50 });
        expect((await request(base, "stream?symbols=AAPL.US")).status).toBe(504);
        expect((await request(base, "status")).status).toBe(502);
    });

    it("上游心跳保持空闲连接，透明转发后正常关闭", async () => {
        const base = await setup((_req, res) => {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write("event: ready\ndata: {}\n\n");
            const timer = setInterval(() => res.write("event: heartbeat\ndata: {}\n\n"), 20);
            res.on("close", () => clearInterval(timer));
            setTimeout(() => res.end("event: quote\ndata: {}\n\n"), 150);
        }, { idleTimeoutMs: 100, heartbeatMs: 1000 });
        const text = await (await request(base, "stream?symbols=AAPL.US")).text();
        expect(text).toContain("event: heartbeat");
        expect(text).toContain("event: quote");
        expect(text).not.toContain("upstream_timeout");
    });

    it("保留 Python 已知业务错误但过滤其它字段", async () => {
        const base = await setup((_req, res) => {
            res.writeHead(503, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "not_configured", key: apiKey }));
        });
        const response = await request(base, "stream?symbols=AAPL.US");
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: "not_configured" });
    });

    it("状态请求也支持超时与客户端取消", async () => {
        let calls = 0;
        let closed = 0;
        const base = await setup((_req, res) => {
            calls++;
            res.on("close", () => { closed++; });
        }, { connectTimeoutMs: 50 });
        expect((await request(base, "status")).status).toBe(504);
        const controller = new AbortController();
        const pending = request(base, "status", controller.signal).catch(() => null);
        await expect.poll(() => calls).toBe(2);
        controller.abort();
        await pending;
        await expect.poll(() => closed).toBe(2);
    });

    it("全局限额和停机同时关闭流及等待连接，停机后拒绝新流", async () => {
        let calls = 0;
        let closed = 0;
        const base = await setup((_req, res) => {
            calls++;
            res.on("close", () => { closed++; });
            if (calls === 1) {
                res.writeHead(200, { "content-type": "text/event-stream" });
                res.write("event: ready\ndata: {}\n\n");
            }
        }, { maxConnections: 2, maxConnectionsPerIp: 3 });
        const first = await request(base, "stream?symbols=AAPL.US");
        const pending = request(base, "stream?symbols=700.HK");
        await expect.poll(() => calls).toBe(2);
        expect((await request(base, "stream?symbols=600000.SH")).status).toBe(429);
        gateways.at(-1)!.close();
        expect((await pending).status).toBe(502);
        await first.text();
        await expect.poll(() => closed).toBe(2);
        expect((await request(base, "stream?symbols=AAPL.US")).status).toBe(503);
    });

    it.each([422, 429, 503])("保留上游 %s 状态而不透传敏感错误和响应头", async (status) => {
        const base = await setup((_req, res) => {
            res.writeHead(status, { "content-type": "application/json", "x-api-key": apiKey, "retry-after": "2" });
            res.end(JSON.stringify({ error: `private ${apiKey}` }));
        });
        const response = await request(base, "stream?symbols=AAPL.US");
        expect(response.status).toBe(status);
        expect(await response.text()).not.toContain(apiKey);
        expect(response.headers.get("x-api-key")).toBeNull();
    });

    it("拒绝伪 SSE 和重定向，不把鉴权请求发送至新目标", async () => {
        let calls = 0;
        const base = await setup((_req, res) => {
            calls++;
            if (calls === 1) res.writeHead(200, { "content-type": "application/json" });
            else res.writeHead(302, { location: "/private" });
            res.end("private");
        });
        expect((await request(base, "stream?symbols=AAPL.US")).status).toBe(502);
        expect((await request(base, "stream?symbols=AAPL.US")).status).toBe(502);
        expect(calls).toBe(2);
    });

    it("不在被拆分 SSE 事件中插入心跳，正常 EOF 后释放连接", async () => {
        const base = await setup((_req, res) => {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write("event: quote\ndata: {\"price\":");
            setTimeout(() => res.end("123}\n\n"), 50);
        }, { heartbeatMs: 10, maxConnections: 1 });
        expect(await (await request(base, "stream?symbols=AAPL.US")).text()).toBe("event: quote\ndata: {\"price\":123}\n\n");
        expect((await request(base, "stream?symbols=AAPL.US")).status).toBe(200);
    });

    it("本地心跳不能掩盖停滞上游，超时会取消并释放额度", async () => {
        let closed = false;
        const base = await setup((_req, res) => {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write("event: ready\ndata: {}\n\n");
            res.on("close", () => { closed = true; });
        }, { heartbeatMs: 10, idleTimeoutMs: 100, maxConnections: 1 });
        const response = await request(base, "stream?symbols=AAPL.US");
        const text = await response.text();
        expect(text).toContain(": heartbeat\n\n");
        expect(text).toContain("upstream_timeout");
        await expect.poll(() => closed).toBe(true);
        const next = await request(base, "stream?symbols=700.HK");
        expect(next.status).toBe(200);
        await next.body!.cancel();
    });

    it("等待上游响应头超时返回 504", async () => {
        let closed = false;
        const base = await setup((_req, res) => {
            res.on("close", () => { closed = true; });
        }, { connectTimeoutMs: 50 });
        const response = await request(base, "stream?symbols=AAPL.US");
        expect(response.status).toBe(504);
        await expect.poll(() => closed).toBe(true);
    });

    it("认证和证券约束在接入上游前执行", async () => {
        let calls = 0;
        const base = await setup((_req, res) => { calls++; res.end(); });
        expect((await fetch(`${base}/api/longbridge/stream?symbols=AAPL.US&x-api-key=${apiKey}`)).status).toBe(401);
        for (const query of ["", "symbols=", "symbols=aapl.US", "symbols=0.HK", "symbols=600000.BJ", "symbols=AAPL.US,", "symbols=AAPL.US&symbols=700.HK", "symbols[x]=AAPL.US", "symbols=AAPL.US&key=private", `symbols=${Array(21).fill("AAPL.US").join(",")}`]) {
            expect((await request(base, `stream?${query}`)).status).toBe(400);
        }
        expect(calls).toBe(0);
    });

    it("全局和单 IP 限额包括等待响应的连接，取消后释放额度", async () => {
        let calls = 0;
        let closed = 0;
        const base = await setup((_req, res) => {
            calls++;
            res.on("close", () => { closed++; });
        }, { maxConnections: 2, maxConnectionsPerIp: 1 });
        const controller = new AbortController();
        const first = request(base, "stream?symbols=AAPL.US", controller.signal).catch(() => null);
        await expect.poll(() => calls).toBe(1);
        const limited = await request(base, "stream?symbols=700.HK");
        expect(limited.status).toBe(429);
        expect(limited.headers.get("retry-after")).toBe("1");
        controller.abort();
        await first;
        await expect.poll(() => closed).toBe(1);
        const secondController = new AbortController();
        const second = request(base, "stream?symbols=AAPL.US", secondController.signal).catch(() => null);
        await expect.poll(() => calls).toBe(2);
        secondController.abort();
        await second;
    });

    it("逐块转发 SSE，规范化证券代码且断开时取消上游", async () => {
        let upstreamResponse: ServerResponse | undefined;
        let closed = false;
        const base = await setup((req, res) => {
            expect(req.url).toBe("/longbridge/stream?symbols=AAPL.US%2C700.HK%2C600000.SH%2CBRK.B.US");
            expect(req.headers["x-api-key"]).toBeUndefined();
            res.writeHead(200, { "content-type": "text/event-stream", "x-api-key": apiKey });
            res.write("event: ready\ndata: {}\n\n");
            upstreamResponse = res;
            res.on("close", () => { closed = true; });
        });
        const controller = new AbortController();
        const response = await request(base, "stream?symbols=AAPL.US,00700.HK,600000.SH,BRK.B.US,AAPL.US", controller.signal);
        expect(response.status).toBe(200);
        expect(response.headers.get("x-api-key")).toBeNull();
        expect(response.headers.get("x-accel-buffering")).toBe("no");
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: ready\ndata: {}\n\n");
        upstreamResponse!.write("event: quote\ndata: {\"price\":123}\n\n");
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: quote\ndata: {\"price\":123}\n\n");
        controller.abort();
        await expect.poll(() => closed).toBe(true);
    });

    it("状态需要鉴权且不向 Python 或客户端泄露鉴权头", async () => {
        let calls = 0;
        const base = await setup((req, res) => {
            calls++;
            expect(req.url).toBe("/longbridge/status");
            expect(req.headers["x-api-key"]).toBeUndefined();
            expect(req.headers.authorization).toBeUndefined();
            res.setHeader("x-api-key", apiKey);
            res.setHeader("set-cookie", "secret=private");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ configured: false, available: false, source: "longbridge", error: "not_configured" }));
        });
        expect((await fetch(`${base}/api/longbridge/status`)).status).toBe(401);
        expect(calls).toBe(0);
        const response = await request(base, "status");
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ configured: false, available: false, source: "longbridge", error: "not_configured" });
        expect(response.headers.get("x-api-key")).toBeNull();
        expect(response.headers.get("set-cookie")).toBeNull();
    });
});
