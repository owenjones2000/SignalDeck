import { expect, it, vi } from "vitest";
import { PythonClient, QuantError } from "./client.js";

it("uses the existing Python POST contract and preserves supplier failures", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ hits: [], failures: [{ code: "600000", error: "No history" }] })));
  const client = new PythonClient("http://127.0.0.1:8001", 100, fetcher);
  expect(await client.execute({ kind: "screen", params: { formula: "ma_cross", codes: ["600000"], count: 250 } }))
    .toEqual({ hits: [], failures: [{ code: "600000", error: "No history" }] });
  expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8001/screen", expect.objectContaining({ method: "POST", body: '{"formula":"ma_cross","codes":["600000"],"count":250}', redirect: "error" }));
});

it("bounds stalled requests and rejects malformed or failed upstream responses", async () => {
  const stalled = new PythonClient("http://127.0.0.1:8001", 10, () => new Promise(() => {}));
  await expect(stalled.health()).rejects.toMatchObject({ status: 504, message: "Quant request timed out" });
  const unavailable = new PythonClient("http://127.0.0.1:8001", 100, async () => new Response('{"error":"No supplier data"}', { status: 502 }));
  await expect(unavailable.health()).rejects.toMatchObject({ status: 502, message: "No supplier data" });
  const malformed = new PythonClient("http://127.0.0.1:8001", 100, async () => new Response('{}'));
  await expect(malformed.signals(["600000"])).rejects.toBeInstanceOf(QuantError);
});

it("rejects incomplete quote and backtest responses rather than inventing data", async () => {
  const client = new PythonClient("http://127.0.0.1:8001", 100, async () => new Response('[{"code":"600000","source":"akshare","as_of":"2026-11-18","stale":false}]'));
  await expect(client.quotes(["600000"])).rejects.toMatchObject({ message: "Invalid quant service response" });
  const backtest = new PythonClient("http://127.0.0.1:8001", 100, async () => new Response('{"code":"600000","source":"akshare","adjustment":"qfq"}'));
  await expect(backtest.execute({ kind: "backtest", params: {} })).rejects.toMatchObject({ message: "Invalid quant service response" });
});

it("defaults to the existing Python launcher port 8010", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"status":"ok","source":"akshare/eastmoney","market_verified":false}'));
  await new PythonClient(undefined, 100, fetcher).health();
  expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8010/health");
});
