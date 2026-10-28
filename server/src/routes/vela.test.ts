import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as binance from "../providers/binance.js";
import * as fred from "../providers/fred.js";
import * as nasdaq from "../providers/nasdaq.js";
import * as stooq from "../providers/stooq.js";
import * as yahoo from "../providers/yahoo.js";
import { marketRouter } from "./market.js";
import { velaRouter } from "./vela.js";

vi.mock("../providers/binance.js", () => ({ CRYPTO_SYMBOLS: new Set(["BTC", "ETH"]), history: vi.fn() }));
vi.mock("../providers/fred.js", () => ({ series: vi.fn() }));
vi.mock("../providers/nasdaq.js", () => ({ history: vi.fn() }));
vi.mock("../providers/yahoo.js", () => ({ history: vi.fn() }));
vi.mock("../providers/stooq.js", () => ({ history: vi.fn() }));

const candle = { time: 1704067200, open: 100, high: 103, low: 99, close: 102, volume: 1000 };
let server: Server;
let base: string;
let sequence = 0;

function historyPath(query = ""): string {
  return `/api/vela/history/TEST${++sequence}${query}`;
}

beforeAll(async () => {
  const app = express();
  app.use("/api/vela", velaRouter);
  app.use("/api", marketRouter);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.mocked(nasdaq.history).mockResolvedValue([candle]);
  vi.mocked(yahoo.history).mockResolvedValue([candle]);
  vi.mocked(stooq.history).mockResolvedValue([candle]);
  vi.mocked(binance.history).mockResolvedValue([candle]);
});

describe("Vela history HTTP contract", () => {
  it("returns numeric millisecond OHLCV with default range and source diagnostics", async () => {
    const response = await fetch(base + historyPath());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ timestamp: 1704067200000, open: 100, high: 103, low: 99, close: 102, volume: 1000 }]);
    expect(vi.mocked(nasdaq.history).mock.calls[0][1]).toBe("6M");
    expect(response.headers.get("x-vela-time-unit")).toBe("ms");
    expect(response.headers.get("x-vela-mode")).toBe("live");
    expect(response.headers.get("x-vela-source")).toBe("nasdaq");
    expect(response.headers.get("x-vela-cache")).toBe("miss");
    expect(response.headers.get("x-vela-fallback")).toBe("false");
    expect(response.headers.get("x-vela-attempts")).toBe("nasdaq");
    expect(yahoo.history).not.toHaveBeenCalled();
  });

  it("sorts, deduplicates and removes invalid candles without mutating provider data", async () => {
    const rows = [
      { ...candle, time: candle.time + 86400 },
      candle,
      { ...candle, close: 101 },
      { ...candle, time: NaN },
      { ...candle, volume: -1 },
      { ...candle, high: 90 },
      { ...candle, low: 110 },
      { ...candle, open: Infinity },
      { ...candle, time: Number.MAX_SAFE_INTEGER },
    ];
    vi.mocked(nasdaq.history).mockResolvedValue(rows);
    const response = await fetch(base + historyPath());
    expect(await response.json()).toEqual([
      { timestamp: 1704067200000, open: 100, high: 103, low: 99, close: 101, volume: 1000 },
      { timestamp: 1704153600000, open: 100, high: 103, low: 99, close: 102, volume: 1000 },
    ]);
    expect(rows[0].time).toBe(1704153600);
    expect(candle.close).toBe(102);
  });

  it("falls back from failed Nasdaq to Yahoo using the existing range mapping", async () => {
    vi.mocked(nasdaq.history).mockRejectedValue(new Error("down"));
    const response = await fetch(base + historyPath("?range=1D"));
    expect(response.status).toBe(200);
    expect(yahoo.history).toHaveBeenCalledWith(expect.any(String), "1d", "5m");
    expect(response.headers.get("x-vela-source")).toBe("yahoo");
    expect(response.headers.get("x-vela-fallback")).toBe("true");
    expect(response.headers.get("x-vela-attempts")).toBe("nasdaq,yahoo");
  });

  it("treats empty and invalid history as failures and continues to Stooq", async () => {
    vi.mocked(nasdaq.history).mockResolvedValue([]);
    vi.mocked(yahoo.history).mockResolvedValue([{ ...candle, close: NaN }]);
    const response = await fetch(base + historyPath());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vela-source")).toBe("stooq");
    expect(response.headers.get("x-vela-attempts")).toBe("nasdaq,yahoo,stooq");
  });

  it("shares the cache with the old endpoint while preserving its second-based contract", async () => {
    const symbol = `SHARED${++sequence}`;
    const old = await fetch(`${base}/api/history/${symbol}?range=1M`);
    expect(await old.json()).toEqual([candle]);
    const response = await fetch(`${base}/api/vela/history/${symbol.toLowerCase()}?range=1M`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vela-cache")).toBe("hit");
    expect((await response.json())[0].timestamp).toBe(candle.time * 1000);
    expect(nasdaq.history).toHaveBeenCalledTimes(1);
    const oldAgain = await fetch(`${base}/api/history/${symbol}?range=1M`);
    expect(await oldAgain.json()).toEqual([candle]);
  });

  it("serves stale real data with explicit diagnostics when all providers fail", async () => {
    const path = historyPath();
    const first = await fetch(base + path);
    expect(first.status).toBe(200);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 21000);
    vi.mocked(nasdaq.history).mockRejectedValue(new Error("down"));
    vi.mocked(yahoo.history).mockRejectedValue(new Error("down"));
    vi.mocked(stooq.history).mockRejectedValue(new Error("down"));
    const response = await fetch(base + path);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vela-cache")).toBe("stale");
    expect(response.headers.get("x-vela-source")).toBe("nasdaq");
    expect(response.headers.get("x-vela-fallback")).toBe("true");
    expect(response.headers.get("x-vela-attempts")).toBe("nasdaq,yahoo,stooq");
    expect((await response.json())[0].timestamp).toBe(1704067200000);
  });

  it("returns 502 without silently generating fixture data or leaking upstream errors", async () => {
    vi.mocked(nasdaq.history).mockRejectedValue(new Error("secret upstream URL"));
    vi.mocked(yahoo.history).mockResolvedValue([]);
    vi.mocked(stooq.history).mockResolvedValue([]);
    const response = await fetch(base + historyPath());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "All data providers are temporarily unavailable. Try again shortly." });
    expect(response.headers.get("x-vela-mode")).toBe("live");
    expect(response.headers.get("x-vela-source")).toBe("unavailable");
    expect(response.headers.get("x-vela-attempts")).toBe("nasdaq,yahoo,stooq");
  });

  it("provides deterministic fixture data only on explicit opt-in and never pollutes the live cache", async () => {
    const path = historyPath();
    const response = await fetch(base + path + "?mode=fixture");
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toHaveLength(3);
    expect(data[0]).toEqual({ timestamp: 1704067200000, open: 100, high: 103, low: 99, close: 102, volume: 1000 });
    expect(response.headers.get("x-vela-source")).toBe("fixture");
    expect(response.headers.get("x-vela-cache")).toBe("none");
    expect(response.headers.get("x-vela-mode")).toBe("fixture");
    expect(nasdaq.history).not.toHaveBeenCalled();
    expect(yahoo.history).not.toHaveBeenCalled();
    expect(stooq.history).not.toHaveBeenCalled();
    expect(binance.history).not.toHaveBeenCalled();
    expect(fred.series).not.toHaveBeenCalled();
    const again = await fetch(base + path + "?mode=fixture");
    expect(await again.json()).toEqual(data);
    const live = await fetch(base + path + "?mode=live");
    expect(live.headers.get("x-vela-cache")).toBe("miss");
    expect(live.headers.get("x-vela-source")).toBe("nasdaq");
  });

  it("routes supported crypto to Binance", async () => {
    const response = await fetch(`${base}/api/vela/history/btc?range=5D`);
    expect(response.status).toBe(200);
    expect(binance.history).toHaveBeenCalledWith("BTC", "5D");
    expect(response.headers.get("x-vela-source")).toBe("binance");
    expect(nasdaq.history).not.toHaveBeenCalled();
  });

  it.each(["VIX", "^VIX"])("routes %s to FRED", async (symbol) => {
    vi.mocked(fred.series).mockResolvedValue([{ date: "2024-01-01", value: 15 }]);
    const response = await fetch(`${base}/api/vela/history/${encodeURIComponent(symbol)}?range=1Y`);
    expect(response.status).toBe(200);
    expect(fred.series).toHaveBeenCalledWith("VIXCLS", 252);
    expect(response.headers.get("x-vela-source")).toBe("fred");
    expect(await response.json()).toEqual([{ timestamp: 1704067200000, open: 15, high: 15, low: 15, close: 15, volume: 0 }]);
    expect(nasdaq.history).not.toHaveBeenCalled();
  });

  it.each(["?range=unknown", "?range=1D&range=5D", "?mode=auto", "?mode=fixture&mode=live", "?range[x]=1D"])("rejects invalid query %s before accessing providers", async (query) => {
    const response = await fetch(base + historyPath(query));
    expect(response.status).toBe(400);
    expect(nasdaq.history).not.toHaveBeenCalled();
  });

  it.each(["AAA&limit=5000", " ", "A".repeat(33)])("rejects invalid symbol %s", async (symbol) => {
    const response = await fetch(`${base}/api/vela/history/${encodeURIComponent(symbol)}`);
    expect(response.status).toBe(400);
    expect(nasdaq.history).not.toHaveBeenCalled();
  });

  it.each(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"])("accepts range %s", async (range) => {
    const response = await fetch(base + historyPath(`?range=${range}`));
    expect(response.status).toBe(200);
    expect(nasdaq.history).toHaveBeenCalledWith(expect.any(String), range);
  });
});
