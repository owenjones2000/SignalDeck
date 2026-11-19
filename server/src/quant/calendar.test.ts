import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TradingCalendar } from "./calendar.js";

const data = { valid_from: "2026-11-01", valid_to: "2026-11-30", trading_days: ["2026-11-18"] };

it("requires authoritative covered calendar days and Shanghai trading sessions", () => {
  const calendar = new TradingCalendar(() => data);
  expect(calendar.check(new Date("2026-11-18T01:30:00Z"))).toEqual({ allowed: true, reason: null });
  expect(calendar.check(new Date("2026-11-18T03:31:00Z"))).toMatchObject({ allowed: false, reason: "Outside trading session" });
  expect(calendar.check(new Date("2026-11-18T05:00:00Z"))).toMatchObject({ allowed: true });
  expect(calendar.check(new Date("2026-11-18T07:00:01Z"))).toMatchObject({ allowed: false });
  expect(calendar.check(new Date("2026-11-19T02:00:00Z"))).toMatchObject({ allowed: false, reason: "Not a trading day" });
  expect(calendar.check(new Date("2026-12-01T02:00:00Z"))).toMatchObject({ allowed: false, reason: "Trading calendar does not cover today" });
});

it.each([undefined, { ...data, trading_days: ["2026-02-30"] }, { ...data, valid_from: "2026-12-01" }])("fails closed on missing or invalid calendar %s", (input) => {
  expect(new TradingCalendar(() => input).check(new Date("2026-11-18T02:00:00Z"))).toEqual({ allowed: false, reason: "Trading calendar unavailable or invalid" });
});

it("ships a valid format example without enabling scans outside its demonstration range", () => {
  const example = JSON.parse(readFileSync(new URL("../../../config/trading-calendar.example.json", import.meta.url), "utf8"));
  const calendar = new TradingCalendar(() => example);
  expect(calendar.check(new Date("2026-01-02T02:00:00Z"))).toEqual({ allowed: true, reason: null });
  expect(calendar.check(new Date("2026-11-18T02:00:00Z"))).toEqual({ allowed: false, reason: "Trading calendar does not cover today" });
});
