export type Rule = { key: string; name: string; min_history: number };
export type JobKind = "screen" | "backtest";
export type Job = {
    id: string; kind: JobKind; params: Record<string, unknown>;
    status: "queued" | "running" | "completed" | "failed";
    result: ScreenResult | BacktestResult | null; error: string | null;
    created_at: string; updated_at: string;
};
export type ScreenResult = {
    hits: { code: string; formula: string; date: string; price: number }[];
    failures: { code: string; error: string }[];
};
export type BacktestResult = {
    code: string; source: string; adjustment: string; strategy: string;
    init_capital: number; final_equity: number; total_return: number; max_drawdown: number;
    cash: number; position_shares: number;
    trades: { type: string; signal_date: string; date: string; price: number; shares: number; commission: number; stamp_tax: number }[];
    equity_curve: { date: string; equity: number }[];
    limitations: string[];
};
export type QuantQuote = { code: string; name: string; price: number; source: string; as_of: string; stale: boolean };
export type History = {
    code: string; source: string; adjustment: string;
    bars: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
};
export type Channel = "local" | "feishu" | "email";
export type Status = {
    available: boolean; error?: string;
    health?: { status: string; source: string; market_verified: boolean };
    channels: Record<Channel, boolean>;
    scheduler: { allowed: boolean; reason: string | null };
};
export type Alert = {
    id: string; name: string; codes: string[]; signal: string; enabled: boolean;
    interval_minutes: number; channel: Channel; next_scan_at: string; last_error: string | null; created_at: string;
};
export type Notification = {
    id: string; alert_id: string; channel: Channel; status: string; attempts: number;
    next_attempt_at: string; error: string | null; created_at: string; sent_at: string | null;
    payload: { code: string; key: string; name: string; type: string; date: string; price: number; alert_name: string };
};
