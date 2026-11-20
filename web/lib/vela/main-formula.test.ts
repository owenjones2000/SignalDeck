import { describe, expect, it } from "vitest";
import { calculateMainFormula } from "./main-formula";
import type { Bar } from "./types";

function bar(close: number, index = 0, high = 10, low = 0): Bar {
    return { time: (index + 1) * 60_000, open: close, high, low, close, volume: 1 };
}

describe("内置主图公式计算", () => {
    it("首次有效 RSV 初始化 K 和 D，随后按三分之一递推", () => {
        const result = calculateMainFormula([bar(5), bar(8, 1)]);
        expect(result.kdj5[0]).toEqual({ rsv: 50, k: 50, d: 50, j: 50 });
        expect(result.kdj5[1].k).toBeCloseTo(60);
        expect(result.kdj5[1].d).toBeCloseTo(160 / 3);
        expect(result.kdj5[1].j).toBeCloseTo(220 / 3);
        expect(result.kdj55).toEqual(result.kdj5);
    });

    it("零振幅不输出并保留上一有效平滑状态，缺失前值不交叉", () => {
        const bars = [bar(5, 0, 5, 5), bar(8, 1)];
        for (let index = 2; index < 7; index++) bars.push(bar(8, index, 8, 8));
        bars.push(bar(10, 7, 10, 0));
        const result = calculateMainFormula(bars);
        expect(result.kdj5[0]).toEqual({});
        expect(result.kdj5[6]).toEqual({});
        expect(result.kdj5[7].k).toBeCloseTo(260 / 3);
        expect(result.kdj5[7].d).toBeCloseTo(740 / 9);
    });

    it("相等前值允许 CROSS，VALUEWHEN 保持事件根高低且不提前输出", () => {
        const closes = [8, 10, 4, 13, 16, 5, 3, 3, 1, 13, 18, 10, 2, 8, 17, 18, 12, 9, 6, 4, 9, 7, 1, 9, 9];
        const bars = closes.map((close, index) => bar(close, index, index === 0 ? 40 : 20, index === 10 ? -20 : 0));
        const result = calculateMainFormula(bars);
        expect(result.support.slice(0, 5)).toEqual(Array(5).fill(undefined));
        expect(result.support.slice(5)).toEqual(Array(20).fill(0));
        expect(result.pressure.slice(0, 17)).toEqual(Array(17).fill(undefined));
        expect(result.pressure.slice(17)).toEqual(Array(8).fill(20));
        expect(calculateMainFormula(Array.from({ length: 60 }, (_, index) => bar(5, index))).support).toEqual(Array(60).fill(undefined));
    });

    it("七条 MA 只使用完整窗口，199 根不输出 MA200", () => {
        const bars = Array.from({ length: 200 }, (_, index) => bar(index + 1, index, 200));
        const result = calculateMainFormula(bars);
        expect(Object.keys(result.ma).map(Number)).toEqual([5, 10, 15, 30, 50, 100, 200]);
        expect(result.ma[5].slice(0, 5)).toEqual([undefined, undefined, undefined, undefined, 3]);
        expect(result.ma[200][198]).toBeUndefined();
        expect(result.ma[200][199]).toBe(100.5);
        expect(result.insufficientHistory).toBe(false);
        expect(calculateMainFormula(bars.slice(0, 199)).insufficientHistory).toBe(true);
    });

    it("相邻 bar 涨幅包含 8.5% 边界，前收为零和首根不触发", () => {
        const closes = [100, 108.4999, 100, 108.5, 0, 100, 109];
        expect(calculateMainFormula(closes.map((close, index) => bar(close, index, 110))).surge).toEqual([false, false, false, true, false, false, true]);
    });

    it.each([[20, 21.7], [10, 10.85]])("%s→%s 精确门槛允许受控浮点误差，但略低价格不触发", (previous, close) => {
        expect(calculateMainFormula([bar(previous, 0, 30), bar(close, 1, 30)]).surge).toEqual([false, true]);
        expect(calculateMainFormula([bar(previous, 0, 30), bar(close - 1e-12, 1, 30)]).surge).toEqual([false, false]);
    });

    it("各证券独立计算，前缀不会受未来数据影响且不修改行情", () => {
        const bars = Array.from({ length: 220 }, (_, index) => bar(index % 17 + 1, index, index === 0 ? 40 : 20));
        const original = structuredClone(bars);
        const full = calculateMainFormula(bars);
        for (const length of [0, 1, 5, 55, 199, 200]) {
            const prefix = calculateMainFormula(bars.slice(0, length));
            expect(prefix.kdj5).toEqual(full.kdj5.slice(0, length));
            expect(prefix.kdj55).toEqual(full.kdj55.slice(0, length));
            expect(prefix.pressure).toEqual(full.pressure.slice(0, length));
            expect(prefix.support).toEqual(full.support.slice(0, length));
            expect(prefix.surge).toEqual(full.surge.slice(0, length));
            for (const period of Object.keys(prefix.ma)) expect(prefix.ma[Number(period)]).toEqual(full.ma[Number(period)].slice(0, length));
        }
        expect(calculateMainFormula([bar(5, 0, 5, 5)]).kdj55).toEqual([{}]);
        expect(bars).toEqual(original);
        expect(calculateMainFormula(bars)).toEqual(full);
    });
});
