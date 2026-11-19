"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fmt } from "../../lib/api";
import { parseCodes, quantRequest } from "../../lib/quant/client";
import type { History, QuantQuote } from "../../lib/quant/types";
import { ErrorMessage, Field, ServiceStatus } from "./Common";
import DailyChart from "./DailyChart";

export default function WatchWidget() {
    const client = useQueryClient();
    const [draft, setDraft] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    const [count, setCount] = useState(250);
    const [error, setError] = useState<unknown>(null);
    const watchlist = useQuery({ queryKey: ["quant", "watchlist"], queryFn: () => quantRequest<{ code: string }[]>("/watchlist"), retry: false });
    const codes = watchlist.data?.map((item) => item.code) ?? [];
    const quotes = useQuery({ queryKey: ["quant", "quotes", codes], queryFn: () => quantRequest<QuantQuote[]>(`/quotes?codes=${codes.join(",")}`), enabled: codes.length > 0, retry: false, refetchInterval: 30000 });
    const history = useQuery({ queryKey: ["quant", "history", selected, count], queryFn: () => quantRequest<History>(`/history/${selected}?count=${count}`), enabled: selected !== null, retry: false });
    const add = useMutation({ mutationFn: (code: string) => quantRequest("/watchlist", "POST", { code }), onSuccess: () => { setDraft(""); client.invalidateQueries({ queryKey: ["quant", "watchlist"] }); } });
    const remove = useMutation({ mutationFn: (code: string) => quantRequest(`/watchlist/${code}`, "DELETE"), onSuccess: (_, code) => { if (selected === code) setSelected(null); client.invalidateQueries({ queryKey: ["quant", "watchlist"] }); } });

    return <div className="quant-widget">
        <ServiceStatus />
        <form className="quant-form" onSubmit={(event) => {
            event.preventDefault(); setError(null);
            try {
                const parsed = parseCodes(draft);
                if (parsed.length !== 1) throw new Error("每次添加一个 A 股代码");
                add.mutate(parsed[0]);
            } catch (err) { setError(err); }
        }}>
            <Field label="自选代码"><input aria-label="自选代码" placeholder="000001 · 六位 A 股代码" required value={draft} onChange={(event) => setDraft(event.target.value)} /></Field>
            <button className="term-btn" disabled={add.isPending}>添加自选</button>
            <button type="button" className="term-btn" disabled={watchlist.isFetching} onClick={() => watchlist.refetch()}>刷新自选</button>
            <button type="button" className="term-btn" disabled={codes.length === 0 || quotes.isFetching} onClick={() => quotes.refetch()}>刷新报价</button>
        </form>
        <ErrorMessage error={error ?? add.error ?? remove.error} />
        <ErrorMessage error={watchlist.error} /><ErrorMessage error={quotes.error} />
        {watchlist.isPending && <p role="status">加载自选…</p>}
        {watchlist.isSuccess && codes.length === 0 && <p className="dim">暂无 A 股自选</p>}
        {codes.length > 0 && <div className="quant-table"><table className="data-table"><thead><tr><th>代码 / 名称</th><th>价格</th><th>数据时间 / 来源</th><th>操作</th></tr></thead><tbody>{codes.map((code) => {
            const quote = quotes.data?.find((item) => item.code === code);
            const quoteStatus = quote
                ? quotes.isError ? "旧报价 / 刷新失败" : quote.stale ? "缓存报价" : "新鲜报价"
                : quotes.isFetching ? "加载中…" : "报价未取得";
            return <tr key={code}><td>{code}<br /><span className="dim">{quote?.name ?? "—"}</span></td><td>{fmt(quote?.price)}</td><td>{quote?.as_of ?? "—"}<br /><span className="dim">{quote?.source ?? "—"} · </span><span className={quote && quotes.isError ? "down" : quote?.stale ? "amber" : "dim"}>{quoteStatus}</span></td><td><button className="term-btn" aria-label={`查看日线 ${code}`} onClick={() => setSelected(code)}>日线</button> <button className="term-btn" aria-label={`删除自选 ${code}`} disabled={remove.isPending} onClick={() => remove.mutate(code)}>删除</button></td></tr>;
        })}</tbody></table></div>}
        {selected && <section className="quant-section" aria-label="日线行情">
            <div className="quant-form"><h3 className="amber">{selected} / DAILY</h3><Field label="日线日数"><input aria-label="日线日数" type="number" min={1} max={2000} step={1} value={count} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 2000) setCount(value); }} /></Field><button className="term-btn" disabled={history.isFetching} onClick={() => history.refetch()}>刷新日线</button></div>
            <ErrorMessage error={history.error} />
            {history.isPending && <p role="status">加载日线…</p>}
            {history.data && <><p className="dim">{history.data.source} · {history.data.adjustment} 前复权 · 成交量单位：股</p><DailyChart history={history.data} />
                <div className="quant-table"><table className="data-table"><thead><tr><th>日期</th><th>开盘</th><th>最高</th><th>最低</th><th>收盘</th><th>成交量</th></tr></thead><tbody>{[...history.data.bars].reverse().map((bar) => <tr key={bar.date}><td>{bar.date}</td><td>{fmt(bar.open)}</td><td>{fmt(bar.high)}</td><td>{fmt(bar.low)}</td><td>{fmt(bar.close)}</td><td>{fmt(bar.volume, 0)}</td></tr>)}</tbody></table></div></>}
        </section>}
    </div>;
}
