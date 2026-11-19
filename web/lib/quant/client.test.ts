import { afterEach, describe, expect, it, vi } from "vitest";
import { quantRequest, parseCodes } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("quant HTTP contract", () => {
    it("posts jobs to the web proxy without browser credentials", async () => {
        const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "job-1", status: "queued" }, { status: 202 }));
        vi.stubGlobal("fetch", fetcher);
        const input = { kind: "screen", params: { formula: "ma_cross", codes: ["000001"], count: 250 } };
        expect(await quantRequest("/jobs", "POST", input)).toEqual({ id: "job-1", status: "queued" });
        expect(fetcher).toHaveBeenCalledWith("/api/quant/jobs", expect.objectContaining({
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
        }));
    });

    it("accepts empty delete responses and sends PATCH payloads", async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(Response.json({ enabled: false }));
        vi.stubGlobal("fetch", fetcher);
        expect(await quantRequest("/watchlist/000001", "DELETE")).toBeUndefined();
        await quantRequest("/alerts/a1", "PATCH", { enabled: false });
        expect(fetcher).toHaveBeenLastCalledWith("/api/quant/alerts/a1", expect.objectContaining({ method: "PATCH", body: '{"enabled":false}' }));
    });

    it.each([401, 403])("exposes authentication status %s and server detail", async (status) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Invalid API key" }, { status })));
        await expect(quantRequest("/status")).rejects.toThrow(`鉴权失败（HTTP ${status}）：Invalid API key`);
    });

    it("exposes non-JSON service failures", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 502 })));
        await expect(quantRequest("/quotes")).rejects.toThrow("HTTP 502");
    });

    it("keeps leading zeroes, deduplicates and enforces the A-share contract", () => {
        expect(parseCodes("000001，600000 000001\n920001")).toEqual(["000001", "600000", "920001"]);
        expect(() => parseCodes("AAPL")).toThrow("六位 A 股代码");
        expect(() => parseCodes("")).toThrow("1–100");
        expect(() => parseCodes(Array.from({ length: 101 }, (_, i) => String(600000 + i)).join(","))).toThrow("1–100");
    });
});
