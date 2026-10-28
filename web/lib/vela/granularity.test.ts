import { describe, expect, it } from "vitest";
import { adaptGranularity, CoarseGranularityError } from "./granularity";

const bar = { time: Date.UTC(2026, 0, 5, 14, 30), open: 10, high: 12, low: 9, close: 11, volume: 100 };

describe("行情实际粒度", () => {
    it.each(["nasdaq", "stooq", "fred"])("%s 单条日线也不能冒充分钟线", (source) => {
        expect(() => adaptGranularity([bar], "5", source)).toThrow(CoarseGranularityError);
    });

    it("拒绝单条未知来源分钟数据", () => {
        expect(() => adaptGranularity([bar], "5", "unknown")).toThrow("无法确认");
    });

    it("跨夜和周末缺口不影响已有分钟间隔的判断", () => {
        const bars = [bar, { ...bar, time: bar.time + 300_000 }, { ...bar, time: bar.time + 3 * 86_400_000 }];
        expect(adaptGranularity(bars, "5", "yahoo")).toEqual(bars);
    });

    it("实际小时线不能冒充五分钟线", () => {
        expect(() => adaptGranularity([bar, { ...bar, time: bar.time + 3_600_000 }], "5", "binance")).toThrow("粗粒度");
    });

    it("四小时周期由小时线聚合", () => {
        expect(adaptGranularity([bar, { ...bar, time: bar.time + 3_600_000 }], "240", "yahoo"))
            .toEqual([{ ...bar, time: Date.UTC(2026, 0, 5, 12), volume: 200 }]);
    });
});
