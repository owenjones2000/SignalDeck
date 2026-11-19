"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fmt, pctClass } from "../../lib/api";
import { parseCodes, quantRequest } from "../../lib/quant/client";
import type { BacktestResult, Rule } from "../../lib/quant/types";
import { ErrorMessage, Field, ServiceStatus } from "./Common";
import JobHistory from "./JobHistory";
import LineChart from "./LineChart";
import { useJobs } from "./useJobs";

const limitations: Record<string, string> = {
    long_only: "仅做多", single_position: "单一持仓", next_open: "信号次日开盘成交", "100_share_lots": "100股整手",
    no_slippage: "不含滑点", no_price_limit_matching: "不模拟涨跌停撮合", qfq_prices_not_actual_fills: "前复权价格不代表实际成交价",
};

export default function BacktestWidget() {
    const [code, setCode] = useState("");
    const [strategy, setStrategy] = useState("");
    const [params, setParams] = useState({ count: 250, init_capital: 100000, position_pct: 1, commission: 0.0003, stamp_tax: 0.0005 });
    const [error, setError] = useState<unknown>(null);
    const rules = useQuery({ queryKey: ["quant", "strategies"], queryFn: () => quantRequest<Rule[]>("/strategies"), retry: false });
    const selected = rules.data?.find((rule) => rule.key === strategy) ?? rules.data?.[0];
    const state = useJobs("backtest");
    const result = state.detail.data?.status === "completed" ? state.detail.data.result as BacktestResult | null : null;
    const fields: { key: keyof typeof params; label: string; min: number; max?: number; step: number }[] = [
        { key: "count", label: "回测日数", min: selected?.min_history ?? 1, max: 2000, step: 1 },
        { key: "init_capital", label: "初始资金", min: 0.01, step: 0.01 },
        { key: "position_pct", label: "仓位比例", min: 0.0001, max: 1, step: 0.0001 },
        { key: "commission", label: "佣金比例", min: 0, max: 0.9999, step: 0.0001 },
        { key: "stamp_tax", label: "印花税比例", min: 0, max: 0.9999, step: 0.0001 },
    ];
    return <div className="quant-widget">
        <ServiceStatus />
        <form className="quant-form" onSubmit={(event) => {
            event.preventDefault(); setError(null);
            try {
                const codes = parseCodes(code);
                if (codes.length !== 1) throw new Error("回测仅支持单个 A 股代码");
                if (!selected) throw new Error("请先加载回测策略");
                state.submit.mutate({ code: codes[0], strategy: selected.key, ...params });
            } catch (err) { setError(err); }
        }}>
            <Field label="回测代码"><input aria-label="回测代码" placeholder="000001" required value={code} onChange={(event) => setCode(event.target.value)} /></Field>
            <Field label="回测策略"><select aria-label="回测策略" value={selected?.key ?? ""} onChange={(event) => setStrategy(event.target.value)}>{rules.data?.map((rule) => <option key={rule.key} value={rule.key}>{rule.name}</option>)}</select></Field>
            {fields.map((field) => <Field key={field.key} label={field.label}><input aria-label={field.label} type="number" required min={field.min} max={field.max} step={field.step} value={params[field.key]} onChange={(event) => setParams({ ...params, [field.key]: Number(event.target.value) })} /></Field>)}
            <button className="term-btn" disabled={!selected || state.submit.isPending}>{state.submit.isPending ? "提交中…" : "运行回测"}</button>
        </form>
        <p className="dim">比例使用小数：1 = 100% · 至少 {selected?.min_history ?? "—"} 日 · 模拟结果非投资建议</p>
        <ErrorMessage error={rules.error ?? error ?? state.submit.error} />
        {rules.error && <button className="term-btn" onClick={() => rules.refetch()}>重试策略</button>}
        <JobHistory state={state} />
        {result && <section className="quant-section" aria-label="回测报告">
            <h3 className="amber">{result.code} / BACKTEST REPORT</h3><p className="dim">{result.source} · {result.adjustment} · {result.strategy}</p>
            <div className="quant-metrics">
                <div className="quant-metric"><span className="dim">总收益率</span><strong className={pctClass(result.total_return)}>{fmt(result.total_return * 100)}%</strong></div>
                <div className="quant-metric"><span className="dim">最大回撤</span><strong className="down">{fmt(result.max_drawdown * 100)}%</strong></div>
                <div className="quant-metric"><span className="dim">最终权益</span><strong>{fmt(result.final_equity)}</strong></div>
                <div className="quant-metric"><span className="dim">剩余现金 / 持仓股数</span><strong>{fmt(result.cash)} / {fmt(result.position_shares, 0)}</strong></div>
            </div>
            <LineChart label="回测权益曲线" values={result.equity_curve.map((point) => point.equity)} />
            <p className="dim">{result.equity_curve[0]?.date} — {result.equity_curve.at(-1)?.date}</p>
            <details><summary className="amber cursor-pointer">权益明细 / {result.equity_curve.length} 日</summary><div className="quant-table"><table className="data-table"><thead><tr><th>日期</th><th>权益</th></tr></thead><tbody>{result.equity_curve.map((point) => <tr key={point.date}><td>{point.date}</td><td>{fmt(point.equity)}</td></tr>)}</tbody></table></div></details>
            <h4 className="amber">成交明细 / {result.trades.length} 笔</h4>
            {result.trades.length === 0 && <p className="dim">暂无成交</p>}
            <div className="quant-table"><table className="data-table"><thead><tr><th>方向</th><th>信号日期</th><th>成交日期</th><th>价格</th><th>股数</th><th>佣金</th><th>印花税</th></tr></thead><tbody>{result.trades.map((trade, index) => <tr key={index}><td>{trade.type === "buy" ? "买入" : "卖出"}</td><td>{trade.signal_date}</td><td>{trade.date}</td><td>{fmt(trade.price)}</td><td>{fmt(trade.shares, 0)}</td><td>{fmt(trade.commission)}</td><td>{fmt(trade.stamp_tax)}</td></tr>)}</tbody></table></div>
            <p className="quant-error">模型限制：{result.limitations.map((key) => limitations[key] ?? key).join(" · ")}</p>
        </section>}
    </div>;
}
