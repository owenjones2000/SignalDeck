import { expect, it, vi } from "vitest";
import { NotificationSender } from "./notifications.js";
import type { Notification } from "./types.js";

const notification: Notification = {
  id: "delivery", event_id: "event", alert_id: "alert", channel: "feishu", status: "sending",
  attempts: 1, next_attempt_at: "2026-11-18T02:00:00Z", error: null, created_at: "2026-11-18T02:00:00Z", sent_at: null,
  payload: { code: "600000", key: "ma_cross", name: "均线金叉", type: "buy", date: "2026-11-18", price: 10, alert_name: "自选提醒" },
};

it("reports only channel booleans and checks Feishu application-level failures", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"code":19001,"msg":"secret"}')).mockResolvedValueOnce(new Response('{"code":0}'));
  const sender = new NotificationSender({ QUANT_FEISHU_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/secret" }, fetcher);
  expect(sender.channels()).toEqual({ local: true, feishu: true, email: false });
  await expect(sender.send(notification)).rejects.toThrow("Feishu delivery failed");
  await sender.send(notification);
  expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "POST", redirect: "error" }));
  await new NotificationSender({}).send({ ...notification, channel: "local" });
});

it("delivers SMTP mail using environment recipients, TLS and bounded connection timeouts", async () => {
  const sendMail = vi.fn(async () => ({ accepted: ["owner@example.com"], rejected: [] }));
  const close = vi.fn();
  const transport = vi.fn(() => ({ sendMail, close }));
  const sender = new NotificationSender({
    QUANT_SMTP_HOST: "smtp.example.com", QUANT_SMTP_PORT: "465", QUANT_SMTP_USER: "user", QUANT_SMTP_PASS: "secret",
    QUANT_EMAIL_FROM: "signals@example.com", QUANT_EMAIL_TO: "owner@example.com",
  }, fetch, transport);
  expect(sender.channels().email).toBe(true);
  await sender.send({ ...notification, channel: "email" });
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ secure: true, auth: { user: "user", pass: "secret" }, connectionTimeout: 10000, socketTimeout: 10000 }));
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "signals@example.com", to: "owner@example.com", messageId: "<event@signaldeck.local>" }));
  expect(close).toHaveBeenCalled();
});

it("times out stalled notification transports without leaking credentials", async () => {
  const sender = new NotificationSender({ QUANT_FEISHU_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/secret" }, () => new Promise(() => {}), undefined, 10);
  await expect(sender.send(notification)).rejects.toThrow("Notification delivery timed out");
});
