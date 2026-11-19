"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fmt } from "../../lib/api";
import { parseCodes, quantRequest } from "../../lib/quant/client";
import type { Rule, ScreenResult } from "../../lib/quant/types";
import { ErrorMessage, Field, ServiceStatus } from "./Common";
import JobHistory from "./JobHistory";
import { useJobs } from "./useJobs";

export default function ScreenWidget() {
    const [codes, setCodes] = useState("");
    const [formula, setFormula] = useState("");
    const [count, setCount] = useState(250);
    const [error, setError] = useState<unknown>(null);
    const rules = useQuery({ queryKey: ["quant", "formulas"], queryFn: () => quantRequest<Rule[]>("/formulas"), retry: false });
    const state = useJobs("screen");
    const client = useQueryClient();
    const add = useMutation({ mutationFn: (code: string) => quantRequest("/watchlist", "POST", { code }), onSuccess: () => client.invalidateQueries({ queryKey: ["quant", "watchlist"] }) });
    const selected = rules.data?.find((rule) => rule.key === formula) ?? rules.data?.[0];
    const result = state.detail.data?.status === "completed" ? state.detail.data.result as ScreenResult | null : null;

    return <div className="quant-widget">
        <ServiceStatus />
        <form className="quant-form" onSubmit={(event) => {
            event.preventDefault(); setError(null);
            try {
                if (!selected) throw new Error("请先加载选股公式");
                state.submit.mutate({ formula: selected.key, codes: parseCodes(codes), count });
            } catch (err) { setError(err); }
        }}>
            <Field label="选股代码"><input aria-label="选股代码" placeholder="000001,600000 · 最多100个" value={codes} onChange={(event) => setCodes(event.target.value)} required /></Field>
            <Field label="选股公式"><select aria-label="选股公式" value={selected?.key ?? ""} onChange={(event) => setFormula(event.target.value)}>{rules.data?.map((rule) => <option key={rule.key} value={rule.key}>{rule.name}</option>)}</select></Field>
            <Field label="历史日数"><input aria-label="历史日数" type="number" min={selected?.min_history ?? 1} max={2000} step={1} value={count} onChange={(event) => setCount(Number(event.target.value))} required /></Field>
            <button className="term-btn" disabled={!selected || state.submit.isPending}>{state.submit.isPending ? "提交中…" : "运行选股"}</button>
        </form>
        <p className="dim">六位 A 股代码 · 前复权日线 · 公式至少 {selected?.min_history ?? "—"} 日</p>
        <ErrorMessage error={rules.error ?? error ?? state.submit.error} />
        {rules.error && <button className="term-btn" onClick={() => rules.refetch()}>重试公式</button>}
        <JobHistory state={state} />
        {result && <section className="quant-section" aria-label="选股结果">
            <h3 className="amber">选股结果 / {result.hits.length} 命中</h3>
            {result.hits.length === 0 && <p className="dim">无命中股票</p>}
            <div className="quant-table"><table className="data-table"><thead><tr><th>代码</th><th>日期</th><th>价格</th><th>操作</th></tr></thead><tbody>{result.hits.map((hit) => <tr key={hit.code}><td>{hit.code}</td><td>{hit.date}</td><td>{fmt(hit.price)}</td><td><button className="term-btn" disabled={add.isPending} onClick={() => add.mutate(hit.code)}>加入自选 {hit.code}</button></td></tr>)}</tbody></table></div>
            {result.failures.map((failure) => <div key={failure.code} className="quant-error"><span>{failure.code} · </span><span>{failure.error}</span></div>)}
            <ErrorMessage error={add.error} />
            {add.isSuccess && <p role="status" className="up">已加入 A 股自选</p>}
        </section>}
    </div>;
}
