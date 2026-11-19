import { expect, it } from "vitest";
import { toVelaBars } from "./vela-bars";

it("maps quant daily OHLCV to Shanghai 15:00 close in UTC milliseconds", () => {
    expect(toVelaBars([
        { date: "2026-11-18", open: 12, high: 13, low: 11, close: 12.5, volume: 10000 },
        { date: "2026-01-05", open: 10, high: 12, low: 9, close: 11, volume: 20000 },
    ])).toEqual([
        { time: Date.UTC(2026, 0, 5, 7), open: 10, high: 12, low: 9, close: 11, volume: 20000 },
        { time: Date.UTC(2026, 10, 18, 7), open: 12, high: 13, low: 11, close: 12.5, volume: 10000 },
    ]);
});

it.each(["2026-02-30", "2026-11-18T00:00:00Z", "invalid"])("rejects invalid quant dates %s rather than rolling into another day", (date) => {
    expect(() => toVelaBars([{ date, open: 12, high: 13, low: 11, close: 12.5, volume: 10000 }])).toThrow("无效日线日期");
});

it("keeps empty history empty and rejects invalid OHLCV", () => {
    expect(toVelaBars([])).toEqual([]);
    expect(() => toVelaBars([{ date: "2026-11-18", open: 12, high: 10, low: 11, close: 12.5, volume: 10000 }])).toThrow("没有有效 OHLCV");
});
