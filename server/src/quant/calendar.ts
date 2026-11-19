import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ScanGate } from "./types.js";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});

const calendarSchema = z.object({
  valid_from: dateSchema,
  valid_to: dateSchema,
  trading_days: z.array(dateSchema).max(10000),
}).strict().refine((value) => value.valid_from <= value.valid_to && value.trading_days.every((day) => day >= value.valid_from && day <= value.valid_to));

export class TradingCalendar {
  constructor(private readonly load: () => unknown = () => {
    const path = process.env.QUANT_CALENDAR_FILE;
    return path ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  }) {}

  check(now = new Date()): ScanGate {
    try {
      const calendar = calendarSchema.parse(this.load());
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).formatToParts(now);
      const part = (name: string) => parts.find((item) => item.type === name)!.value;
      const today = `${part("year")}-${part("month")}-${part("day")}`;
      if (today < calendar.valid_from || today > calendar.valid_to) {
        return { allowed: false, reason: "Trading calendar does not cover today" };
      }
      if (!calendar.trading_days.includes(today)) return { allowed: false, reason: "Not a trading day" };
      const seconds = Number(part("hour")) * 3600 + Number(part("minute")) * 60 + Number(part("second"));
      if ((seconds >= 34200 && seconds <= 41400) || (seconds >= 46800 && seconds <= 54000)) {
        return { allowed: true, reason: null };
      }
      return { allowed: false, reason: "Outside trading session" };
    } catch {
      return { allowed: false, reason: "Trading calendar unavailable or invalid" };
    }
  }
}
