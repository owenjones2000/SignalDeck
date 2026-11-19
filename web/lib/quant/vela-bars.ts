import { normalizeBars, type Bar } from "../vela/types";
import type { History } from "./types";

export function toVelaBars(bars: History["bars"]): Bar[] {
    if (bars.length === 0) return [];
    return normalizeBars(bars.map(({ date, ...bar }) => {
        const time = Date.parse(`${date}T15:00:00+08:00`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) {
            throw new Error(`无效日线日期：${date}`);
        }
        return { time, ...bar };
    }), "milliseconds");
}
