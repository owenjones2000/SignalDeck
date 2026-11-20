import type { Bar } from "./types";

export type KdjPoint = { rsv?: number; k?: number; d?: number; j?: number };
export const MAIN_FORMULA_PERIODS = [5, 10, 15, 30, 50, 100, 200] as const;

function calculateKdj(bars: readonly Bar[], period: number): KdjPoint[] {
    let k: number | undefined;
    let d: number | undefined;
    return bars.map((bar, index) => {
        const window = bars.slice(Math.max(0, index - period + 1), index + 1);
        const low = Math.min(...window.map((item) => item.low));
        const high = Math.max(...window.map((item) => item.high));
        if (high === low) return {};
        const rsv = (bar.close - low) / (high - low) * 100;
        k = k === undefined ? rsv : (rsv + 2 * k) / 3;
        d = d === undefined ? k : (k + 2 * d) / 3;
        return { rsv, k, d, j: 3 * k - 2 * d };
    });
}

export function calculateMainFormula(bars: readonly Bar[]) {
    const ma: Record<number, (number | undefined)[]> = {};
    for (const period of MAIN_FORMULA_PERIODS) {
        let sum = 0;
        ma[period] = bars.map((bar, index) => {
            sum += bar.close;
            if (index >= period) sum -= bars[index - period].close;
            return index + 1 >= period ? sum / period : undefined;
        });
    }
    const kdj5 = calculateKdj(bars, 5);
    const kdj55 = calculateKdj(bars, 55);
    let lastPressure: number | undefined;
    let lastSupport: number | undefined;
    const pressure: (number | undefined)[] = [];
    const support: (number | undefined)[] = [];
    bars.forEach((bar, index) => {
        const fast = kdj5[index].j;
        const slow = kdj55[index].j;
        const previousFast = kdj5[index - 1]?.j;
        const previousSlow = kdj55[index - 1]?.j;
        if (fast !== undefined && slow !== undefined && previousFast !== undefined && previousSlow !== undefined) {
            if (slow > fast && previousSlow <= previousFast) lastPressure = bar.high;
            if (fast > slow && previousFast <= previousSlow) lastSupport = bar.low;
        }
        pressure.push(lastPressure);
        support.push(lastSupport);
    });
    const surge = bars.map((bar, index) => {
        const previous = bars[index - 1]?.close;
        if (previous === undefined || previous === 0) return false;
        const change = (bar.close - previous) / previous * 100;
        const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(bar.close), Math.abs(previous)) / Math.abs(previous) * 100;
        return Number.isFinite(change) && change >= 8.5 - tolerance;
    });
    return { ma, kdj5, kdj55, pressure, support, surge, insufficientHistory: bars.length < 200 };
}
