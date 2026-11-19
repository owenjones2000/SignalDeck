"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fmt } from "../../lib/api";
import { parseCodes, quantRequest } from "../../lib/quant/client";
import type { Alert, Channel, Notification, Status } from "../../lib/quant/types";
import { ErrorMessage, Field, ServiceStatus } from "./Common";

const channels: Record<Channel, string> = { local: "本地", feishu: "飞书", email: "邮件" };
const signals: Record<string, string> = { ma_cross: "均线金叉", macd_cross: "MACD金叉", breakout: "20日突破" };
const deliveryStates: Record<string, string> = { pending: "待发送", sending: "发送中", retrying: "重试中", sent: "已发送", failed: "失败" };
type ScanResult = { signals: { code: string; key: string }[]; failures: { code: string; error: string }[] };

export default function AlertsWidget() {
    const client = useQueryClient();
    const [name, setName] = useState("");
    const [codes, setCodes] = useState("");
    const [signal, setSignal] = useState("ma_cross");
    const [channel, setChannel] = useState<Channel>("local");
    const [interval, setInterval] = useState(5);
    const [error, setError] = useState<unknown>(null);
    const status = useQuery({ queryKey: ["quant", "status"], queryFn: () => quantRequest<Status>("/status"), retry: false });
    const alerts = useQuery({ queryKey: ["quant", "alerts"], queryFn: () => quantRequest<Alert[]>("/alerts"), retry: false, refetchInterval: 10000 });
    const history = useQuery({ queryKey: ["quant", "notifications"], queryFn: () => quantRequest<Notification[]>("/notifications"), retry: false, refetchInterval: 10000 });
    const refresh = () => { client.invalidateQueries({ queryKey: ["quant", "alerts"] }); client.invalidateQueries({ queryKey: ["quant", "notifications"] }); };
    const create = useMutation({ mutationFn: (body: Record<string, unknown>) => quantRequest("/alerts", "POST", body), onSuccess: () => { setName(""); setCodes(""); refresh(); } });
    const action = useMutation({
        mutationFn: ({ alert, kind }: { alert: Alert; kind: "toggle" | "delete" | "test" }) => {
            const path = `/alerts/${encodeURIComponent(alert.id)}`;
            if (kind === "test") return quantRequest<ScanResult>(`${path}/test`, "POST", {});
            if (kind === "toggle") return quantRequest(path, "PATCH", { enabled: !alert.enabled });
            return quantRequest(path, "DELETE");
        }, onSuccess: refresh,
    });
    const scan = action.variables?.kind === "test" && action.isSuccess ? action.data as ScanResult : null;
    const matching = scan?.signals.filter((item) => item.key === action.variables?.alert.signal).length ?? 0;

    return <div className="quant-widget">
        <ServiceStatus />
        <form className="quant-form" onSubmit={(event) => {
            event.preventDefault(); setError(null);
            try {
                if (!status.data?.channels[channel]) throw new Error("通知渠道未配置");
                create.mutate({ name: name.trim(), codes: parseCodes(codes), signal, enabled: true, interval_minutes: interval, channel });
            } catch (err) { setError(err); }
        }}>
            <Field label="提醒名称"><input aria-label="提醒名称" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="提醒代码"><input aria-label="提醒代码" required placeholder="000001,600000" value={codes} onChange={(event) => setCodes(event.target.value)} /></Field>
            <Field label="提醒信号"><select aria-label="提醒信号" value={signal} onChange={(event) => setSignal(event.target.value)}>{Object.entries(signals).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
            <Field label="扫描间隔（分钟）"><input aria-label="扫描间隔（分钟）" type="number" required min={1} max={1440} step={1} value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></Field>
            <Field label="通知渠道"><select aria-label="通知渠道" value={channel} onChange={(event) => setChannel(event.target.value as Channel)}>{Object.entries(channels).map(([key, label]) => <option key={key} value={key} disabled={!status.data?.channels[key as Channel]}>{label}{status.data?.channels[key as Channel] ? "" : "（未配置）"}</option>)}</select></Field>
            <button className="term-btn" disabled={create.isPending || !status.data?.channels[channel]}>创建提醒</button>
        </form>
        <p className="dim">自动扫描受交易时段限制；试扫可手动执行，仅命中对应信号才发送，重复事件去重。</p>
        <ErrorMessage error={error ?? create.error ?? action.error} />
        {scan && <div role="status"><p className="amber">试扫完成：{matching} 个匹配信号；实际投递结果见通知历史</p>{scan.failures.map((failure) => <p key={failure.code} className="quant-error">{failure.code} · {failure.error}</p>)}</div>}
        <section className="quant-section" aria-label="提醒规则">
            <div className="flex justify-between"><h3 className="amber">提醒规则</h3><button className="term-btn" disabled={alerts.isFetching} onClick={() => alerts.refetch()}>刷新提醒</button></div>
            <ErrorMessage error={alerts.error} />
            {alerts.isPending && <p role="status">加载提醒…</p>}
            {alerts.isSuccess && alerts.data.length === 0 && <p className="dim">暂无提醒规则</p>}
            <div className="quant-table"><table className="data-table"><thead><tr><th>名称 / 代码</th><th>信号 / 渠道</th><th>状态 / 下次扫描</th><th>操作</th></tr></thead><tbody>{alerts.data?.map((alert) => <tr key={alert.id}>
                <td>{alert.name}<br /><span className="dim">{alert.codes.join(",")}</span></td><td>{signals[alert.signal] ?? alert.signal}<br /><span className="dim">{channels[alert.channel]} / {alert.interval_minutes}分钟</span></td>
                <td><span className={alert.enabled ? "up" : "dim"}>{alert.enabled ? "启用" : "暂停"}</span><br />{alert.next_scan_at}{alert.last_error && <p className="down">{alert.last_error}</p>}</td>
                <td>{(["toggle", "test", "delete"] as const).map((kind) => { const label = kind === "toggle" ? alert.enabled ? "暂停" : "启用" : kind === "test" ? "试扫" : "删除"; return <button key={kind} className="term-btn" disabled={action.isPending} aria-label={`${label}提醒 ${alert.name}`} onClick={() => action.mutate({ alert, kind })}>{label}</button>; })}</td>
            </tr>)}</tbody></table></div>
        </section>
        <section className="quant-section" aria-label="通知历史">
            <div className="flex justify-between"><h3 className="amber">通知历史 / 最近500条</h3><button className="term-btn" disabled={history.isFetching} onClick={() => history.refetch()}>刷新通知</button></div>
            <ErrorMessage error={history.error} />
            {history.isPending && <p role="status">加载通知…</p>}
            {history.isSuccess && history.data.length === 0 && <p className="dim">暂无通知历史</p>}
            <div className="quant-table"><table className="data-table"><thead><tr><th>提醒 / 信号</th><th>代码 / 价格</th><th>渠道 / 状态</th><th>尝试 / 时间</th><th>错误</th></tr></thead><tbody>{history.data?.map((item) => <tr key={item.id}>
                <td>{item.payload.alert_name}<br /><span className="dim">{item.payload.name} / {item.payload.date}</span></td><td>{item.payload.code}<br />{fmt(item.payload.price)}</td><td>{channels[item.channel]}<br /><span className={item.status === "failed" ? "down" : item.status === "sent" ? "up" : "amber"}>{deliveryStates[item.status] ?? item.status}</span></td><td>{item.attempts}次 / {item.created_at}<br /><span className="dim">{item.sent_at ? `送达 ${item.sent_at}` : `计划 ${item.next_attempt_at}`}</span></td><td className="down">{item.error ?? "—"}</td>
            </tr>)}</tbody></table></div>
        </section>
    </div>;
}
