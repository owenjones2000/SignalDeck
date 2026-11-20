"use client";

import { useI18n } from "../../lib/useI18n";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { QuantRequestError, quantRequest } from "../../lib/quant/client";
import type { Status } from "../../lib/quant/types";

export function ErrorMessage({ error }: { error: unknown }) {
    const { t, text } = useI18n();
    if (!error) return null;
    const message = error instanceof QuantRequestError
        ? t(error.status === 401 || error.status === 403 ? "鉴权失败（HTTP {status}）：{detail}" : "请求失败（HTTP {status}）：{detail}", { status: error.status, detail: error.detail })
        : text(error instanceof Error ? error.message : String(error));
    return <div role="alert" className="quant-error">{message}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
    return <label className="quant-field"><span className="dim">{label}</span>{children}</label>;
}

export function ServiceStatus() {
    const { t, text: translateText } = useI18n();
    const query = useQuery({ queryKey: ["quant", "status"], queryFn: () => quantRequest<Status>("/status"), retry: false, refetchInterval: 30000 });
    return <div className="quant-status">
        <div className="flex flex-wrap gap-2 justify-between">
            <span className="amber">{t("A-SHARE / QUANT")}</span>
            <button className="term-btn" onClick={() => query.refetch()} disabled={query.isFetching}>{t("刷新状态")}</button>
        </div>
        {query.isPending && <p role="status" className="dim">{t("连接量化服务…")}</p>}
        <ErrorMessage error={query.error} />
        {query.data && <>
            <p className={query.data.available ? "up" : "down"}>{query.data.available ? t("服务在线") : <>{t("服务不可用：")}{query.data.error ?? t("未知错误")}</>}</p>
            <p className="dim">{query.data.health?.source ?? t("数据源未知")} · {query.data.health?.market_verified ? t("行情已验证") : t("行情未经独立验证")}</p>
            <p className="dim">{t("扫描：")}{query.data.scheduler.allowed ? t("允许") : translateText(query.data.scheduler.reason ?? "暂停")}</p>
        </>}
    </div>;
}
