"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { quantRequest } from "../../lib/quant/client";
import type { Status } from "../../lib/quant/types";

export function ErrorMessage({ error }: { error: unknown }) {
    return error ? <div role="alert" className="quant-error">{error instanceof Error ? error.message : String(error)}</div> : null;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
    return <label className="quant-field"><span className="dim">{label}</span>{children}</label>;
}

export function ServiceStatus() {
    const query = useQuery({ queryKey: ["quant", "status"], queryFn: () => quantRequest<Status>("/status"), retry: false, refetchInterval: 30000 });
    return <div className="quant-status">
        <div className="flex flex-wrap gap-2 justify-between">
            <span className="amber">A-SHARE / QUANT</span>
            <button className="term-btn" onClick={() => query.refetch()} disabled={query.isFetching}>刷新状态</button>
        </div>
        {query.isPending && <p role="status" className="dim">连接量化服务…</p>}
        <ErrorMessage error={query.error} />
        {query.data && <>
            <p className={query.data.available ? "up" : "down"}>{query.data.available ? "服务在线" : `服务不可用：${query.data.error ?? "未知错误"}`}</p>
            <p className="dim">{query.data.health?.source ?? "数据源未知"} · {query.data.health?.market_verified ? "行情已验证" : "行情未经独立验证"}</p>
            <p className="dim">扫描：{query.data.scheduler.allowed ? "允许" : query.data.scheduler.reason ?? "暂停"}</p>
        </>}
    </div>;
}
