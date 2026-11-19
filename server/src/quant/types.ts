export type Channel = "local" | "feishu" | "email";

export interface AlertInput {
  name: string;
  codes: string[];
  signal: "ma_cross" | "macd_cross" | "breakout";
  enabled: boolean;
  interval_minutes: number;
  channel: Channel;
}

export interface Alert extends AlertInput {
  id: string;
  next_scan_at: string;
  last_error: string | null;
  created_at: string;
}

export interface Signal {
  code: string;
  key: string;
  name: string;
  type: string;
  date: string;
  price: number;
}

export interface SignalsResult {
  signals: Signal[];
  failures: { code: string; error: string }[];
}

export interface Notification {
  id: string;
  event_id: string;
  alert_id: string;
  channel: Channel;
  status: "pending" | "sending" | "retrying" | "sent" | "failed";
  attempts: number;
  next_attempt_at: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  payload: Signal & { alert_name: string };
}

export interface ScanGate {
  allowed: boolean;
  reason: string | null;
}
