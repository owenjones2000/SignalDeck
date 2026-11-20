"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useI18n } from "../../lib/useI18n";
import { fetchLongbridgeStatus, parseLongbridgeSymbols } from "../../lib/longbridge";
import { fmt } from "../../lib/api";
import { useLongbridgeStream } from "./useLongbridgeStream";

export default function LongbridgeWidget() {
    const { t, text } = useI18n();
    const [input, setInput] = useState("");
    const [symbols, setSymbols] = useState<string[] | null>(null);
    const [inputError, setInputError] = useState(false);
    const status = useQuery({
        queryKey: ["longbridge", "status"],
        queryFn: ({ signal }) => fetchLongbridgeStatus(signal),
        retry: false,
    });
    const canSubscribe = Boolean(status.data?.configured && (status.data.available
        || ["connection_failed", "subscription_failed", "unsubscribe_failed", "upstream_timeout"].includes(status.data.error ?? "")));
    const stream = useLongbridgeStream(canSubscribe ? symbols : null);
    useEffect(() => {
        if (status.data && !canSubscribe) setSymbols(null);
    }, [status.data, canSubscribe]);

    return <div className="p-2 flex flex-col gap-2">
        <div className="flex flex-wrap justify-between gap-2 items-center">
            <span className="amber">LONG BRIDGE · QUOTE</span>
            <button className="term-btn" disabled={status.isFetching} onClick={() => status.refetch()}>{t("刷新状态")}</button>
        </div>
        <p role="status" className={status.data?.available ? "up" : "dim"}>{status.isPending ? t("连接长桥服务…") : !status.data?.configured && status.data ? t("长桥未配置，请在服务器配置凭据后刷新状态。") : status.data?.error === "sdk_unavailable" ? t("服务器未安装长桥 SDK，暂时无法订阅。") : status.data?.available ? t("长桥服务就绪") : t("长桥服务暂不可用")}</p>
        {status.error && <p role="alert" className="down">{text(status.error.message)}</p>}
        <form className="flex flex-wrap gap-2 items-center" onSubmit={(event) => {
            event.preventDefault();
            if (!canSubscribe) return;
            try { setSymbols(parseLongbridgeSymbols(input)); setInputError(false); } catch { setInputError(true); }
        }}>
            <label className="flex-1 min-w-48 flex flex-col gap-1"><span className="dim">{t("长桥证券代码")}</span><input aria-label={t("长桥证券代码")} placeholder="AAPL.US,700.HK,600000.SH" value={input} onChange={(event) => setInput(event.target.value)} /></label>
            <button className="term-btn" disabled={!canSubscribe}>{t("订阅")}</button>
            <button type="button" className="term-btn" disabled={!symbols} onClick={() => setSymbols(null)}>{t("取消订阅")}</button>
        </form>
        {inputError && <p role="alert" className="down">{t("长桥代码无效，请输入1–20个带市场后缀的证券代码。")}</p>}
        {symbols && <>
            <p role="status" className="amber">{stream.connection === "connecting" ? t("长桥连接中…") : stream.connection === "ready" ? t("已连接，等待报价") : stream.connection === "live" ? t("长桥报价已更新") : stream.connection === "retrying" ? t("连接已断开，{seconds}秒后重连", { seconds: stream.retrySeconds }) : t("长桥订阅已停止")}</p>
            {stream.error && <p role="alert" className="down">{text(stream.error)}</p>}
            {stream.staleSymbols.length > 0 && <p className="down">{t("连接中断；显示的是上次报价，非实时更新。")}</p>}
            {stream.heartbeat && <p className="dim">{t("最近心跳：{time}", { time: stream.heartbeat })}</p>}
            <div className="overflow-auto"><table className="data-table"><thead><tr>{(["代码", "价格", "开盘", "最高", "最低", "成交量", "成交额", "报价时间", "数据源"] as const).map((key) => <th key={key}>{t(key)}</th>)}</tr></thead><tbody>{symbols.map((symbol) => {
                const quote = stream.quotes[symbol];
                return <tr key={symbol} className={stream.staleSymbols.includes(symbol) ? "dim" : ""}><td>{symbol}</td><td>{fmt(quote?.price)}</td><td>{fmt(quote?.open)}</td><td>{fmt(quote?.high)}</td><td>{fmt(quote?.low)}</td><td>{fmt(quote?.volume, 0)}</td><td>{fmt(quote?.turnover)}</td><td>{quote?.timestamp ?? "—"}</td><td>{quote?.source ?? "—"}</td></tr>;
            })}</tbody></table></div>
        </>}
        <p className="dim text-[11px]">{t("代码须含 .US / .HK / .SH / .SZ 后缀，最多20个；不自动推断市场。")}</p>
        <p className="dim text-[11px]">{t("长桥仅推送最新报价，不提供历史 K 线；行情权限与延迟以账户授权为准。")}</p>
    </div>;
}
