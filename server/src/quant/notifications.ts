import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { QuantError, withTimeout } from "./client.js";
import type { Channel, Notification } from "./types.js";

interface MailTransport {
  sendMail(options: { from: string; to: string; subject: string; text: string; messageId: string }): Promise<{ accepted: unknown[]; rejected: unknown[] }>;
  close(): void;
}

type TransportFactory = (options: {
  host: string; port: number; secure: boolean; requireTLS: boolean;
  auth: { user: string; pass: string }; connectionTimeout: number; greetingTimeout: number; socketTimeout: number;
}) => MailTransport;

export class NotificationSender {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly transport: TransportFactory = (options) => nodemailer.createTransport(options),
    private readonly timeoutMs = 10000,
  ) {}

  channels(): Record<Channel, boolean> {
    let feishu = false;
    try {
      const url = new URL(this.env.QUANT_FEISHU_WEBHOOK ?? "");
      feishu = url.protocol === "https:" && ["open.feishu.cn", "open.larksuite.com"].includes(url.hostname)
        && !url.username && !url.password && url.pathname.startsWith("/open-apis/bot/v2/hook/");
    } catch {
      feishu = false;
    }
    const port = Number(this.env.QUANT_SMTP_PORT ?? 587);
    const email = Boolean(this.env.QUANT_SMTP_HOST && this.env.QUANT_SMTP_USER && this.env.QUANT_SMTP_PASS
      && this.env.QUANT_EMAIL_FROM && this.env.QUANT_EMAIL_TO && Number.isInteger(port) && port > 0 && port <= 65535);
    return { local: true, feishu, email };
  }

  async send(notification: Notification): Promise<void> {
    if (notification.channel === "local") return;
    if (!this.channels()[notification.channel]) throw new Error("Notification channel is not configured");
    const payload = notification.payload;
    const text = `${payload.alert_name}\n${payload.code} ${payload.name} ${payload.type}\n${payload.date} ${payload.price}\nSignalDeck event: ${notification.event_id}`;
    try {
      if (notification.channel === "feishu") {
        await withTimeout(async (signal) => {
          const timestamp = String(Math.floor(Date.now() / 1000));
          const secret = this.env.QUANT_FEISHU_SECRET;
          const signed = secret ? { timestamp, sign: createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64") } : {};
          const response = await this.fetcher(this.env.QUANT_FEISHU_WEBHOOK!, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ msg_type: "text", content: { text }, ...signed }), signal, redirect: "error",
          });
          const body = await response.json() as { code?: number; StatusCode?: number };
          if (!response.ok || (body.code ?? body.StatusCode) !== 0) throw new Error("Feishu delivery failed");
        }, this.timeoutMs);
      } else {
        const port = Number(this.env.QUANT_SMTP_PORT ?? 587);
        const mailer = this.transport({
          host: this.env.QUANT_SMTP_HOST!, port, secure: port === 465, requireTLS: port !== 465,
          auth: { user: this.env.QUANT_SMTP_USER!, pass: this.env.QUANT_SMTP_PASS! },
          connectionTimeout: this.timeoutMs, greetingTimeout: this.timeoutMs, socketTimeout: this.timeoutMs,
        });
        try {
          await withTimeout(async () => {
            const result = await mailer.sendMail({ from: this.env.QUANT_EMAIL_FROM!, to: this.env.QUANT_EMAIL_TO!,
              subject: `SignalDeck: ${payload.alert_name}`, text, messageId: `<${notification.event_id}@signaldeck.local>` });
            if (!result.accepted.length || result.rejected.length) throw new Error("Email delivery failed");
          }, this.timeoutMs);
        } finally {
          mailer.close();
        }
      }
    } catch (error) {
      if (error instanceof QuantError && error.status === 504) throw new Error("Notification delivery timed out");
      throw new Error(notification.channel === "feishu" ? "Feishu delivery failed" : "Email delivery failed");
    }
  }
}
