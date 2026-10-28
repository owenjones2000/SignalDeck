import { PineTS } from "pinets";
import { describe, expect, it } from "vitest";
import { DEFAULT_PINE } from "./types";

describe("已安装 PineTS 运行时", () => {
    it("默认编辑器脚本生成真实 SMA 数值", async () => {
        const bars = Array.from({ length: 30 }, (_, index) => ({
            openTime: Date.UTC(2026, 0, index + 1),
            closeTime: Date.UTC(2026, 0, index + 2) - 1,
            open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000,
        }));
        const result = await new PineTS(bars).run(DEFAULT_PINE);
        const plots = result.plots as Record<string, { data: Array<{ time: number; value: number }> }>;
        const plot = Object.values(plots).find((item) => item.data.some((point) => Number.isFinite(point.value)));
        expect(plot?.data.at(-1)?.value).toBe(120.5);
        expect(plot?.data.at(-1)?.time).toBe(bars.at(-1)?.openTime);
    });
});
