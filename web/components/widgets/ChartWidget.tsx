"use client";

import { useI18n } from "../../lib/useI18n";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fmt, fmtBig } from "../../lib/api";
import { fetchHistory } from "../../lib/vela/history.client";
import type { ChartAdapter } from "../../lib/vela/chart-adapter";
import { CHART_TYPES, DEFAULT_PINE, DEFAULT_TIMEFRAME, INDICATORS, RANGES, TIMEFRAMES, type Bar, type ChartType, type HistoryMode, type Indicator, type Range, type Timeframe } from "../../lib/vela/types";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
    const { t, text: translateText } = useI18n();
    const symbol = useWidgetSymbol(widget);
    const [range, setRange] = useState<Range>("6M");
    const [timeframe, setTimeframe] = useState<Timeframe>("1D");
    const [mode, setMode] = useState<HistoryMode>("live");
    const [chartType, setChartType] = useState<ChartType>("candles");
    const [active, setActive] = useState<Set<Indicator>>(new Set(["SMA20"]));
    const [mainFormulaEnabled, setMainFormulaEnabled] = useState(true);
    const mainFormulaRef = useRef(true);
    const [legend, setLegend] = useState<Bar | null>(null);
    const [adapter, setAdapter] = useState<ChartAdapter | null>(null);
    const [chartError, setChartError] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [source, setSource] = useState(DEFAULT_PINE);
    const [pineStatus, setPineStatus] = useState<{ state: "idle" | "running" | "done" | "failed" | "cleared"; detail?: string }>({ state: "idle" });
    const [running, setRunning] = useState(false);
    const [marketReady, setMarketReady] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const executionRef = useRef(0);

    const { data, error, isFetching } = useQuery({
        queryKey: ["vela-history", symbol, range, timeframe, mode],
        queryFn: ({ signal }) => fetchHistory({ symbol, range, timeframe, mode }, signal),
        refetchInterval: mode === "fixture" ? false : range === "1D" ? 8_000 : 60_000,
        retry: false,
    });

    useEffect(() => {
        let cancelled = false;
        let instance: ChartAdapter | null = null;
        import("../../lib/vela/chart-adapter").then(({ createChartAdapter }) => {
            if (cancelled || !containerRef.current) return;
            instance = createChartAdapter(containerRef.current, (bar) => {
                if (!cancelled) setLegend(bar);
            }, (enabled) => {
                if (cancelled) return;
                mainFormulaRef.current = enabled;
                setMainFormulaEnabled(enabled);
            });
            instance.setMainFormula(mainFormulaRef.current);
            setAdapter(instance);
        }).catch((reason: unknown) => {
            if (!cancelled) setChartError(reason instanceof Error ? reason.message : String(reason));
        });
        return () => {
            cancelled = true;
            executionRef.current++;
            instance?.destroy();
        };
    }, []);

    useEffect(() => {
        executionRef.current++;
        setRunning(false);
        setPineStatus({ state: "idle" });
        adapter?.clearPine();
    }, [adapter, symbol, timeframe, range, mode]);

    useEffect(() => {
        let cancelled = false;
        setMarketReady(false);
        setLegend(null);
        setChartError("");
        if (!adapter) return;
        adapter.setMarket(symbol, timeframe, data?.bars ?? []).then(() => {
            if (!cancelled) setMarketReady(Boolean(data?.bars.length));
        }).catch((reason: unknown) => {
            if (!cancelled) setChartError(reason instanceof Error ? reason.message : String(reason));
        });
        return () => { cancelled = true; };
    }, [adapter, data, symbol, timeframe, range, mode]);

    useEffect(() => { adapter?.setStyle(chartType); }, [adapter, chartType]);
    useEffect(() => { adapter?.setIndicators(active); }, [adapter, active]);
    useEffect(() => { adapter?.setMainFormula(mainFormulaEnabled); }, [adapter, mainFormulaEnabled]);

    async function runPine() {
        if (!adapter || !marketReady || running) return;
        const execution = ++executionRef.current;
        setRunning(true);
        setPineStatus({ state: "running" });
        try {
            const title = await adapter.runPine(source);
            if (execution === executionRef.current) setPineStatus({ state: "done", detail: title });
        } catch (reason) {
            if (execution === executionRef.current) setPineStatus({ state: "failed", detail: reason instanceof Error ? reason.message : String(reason) });
        } finally {
            if (execution === executionRef.current) setRunning(false);
        }
    }

    function toggleIndicator(indicator: Indicator) {
        setActive((previous) => {
            const next = new Set(previous);
            if (next.has(indicator)) next.delete(indicator);
            else next.add(indicator);
            return next;
        });
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex gap-1 p-1 flex-wrap shrink-0">
                {RANGES.map((value) => (
                    <button key={value} className={`term-btn ${range === value ? "active" : ""}`} aria-pressed={range === value} onClick={() => { setRange(value); if (mode !== "longbridge") setTimeframe(DEFAULT_TIMEFRAME[value]); }}>{value}</button>
                ))}
                <label className="flex items-center gap-1 text-[11px] dim">{t("周期")}
                    <select aria-label={t("Timeframe")} className="term-btn" value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)}>
                        {TIMEFRAMES.filter((value) => mode !== "longbridge" || ["30", "1D", "1W"].includes(value)).map((value) => <option key={value} value={value}>{/^\d+$/.test(value) ? `${value}m` : value}</option>)}
                    </select>
                </label>
                <label className="flex items-center gap-1 text-[11px] dim">{t("数据")}
                    <select aria-label={t("数据模式")} className="term-btn" value={mode} onChange={(event) => { const next = event.target.value as HistoryMode; setMode(next); if (next === "longbridge" && !["30", "1D", "1W"].includes(timeframe)) setTimeframe("1D"); }}>
                        <option value="longbridge">长桥 · 前复权</option><option value="live">{t("LIVE")}</option><option value="fixture">{t("FIXTURE · 模拟")}</option>
                    </select>
                </label>
                {CHART_TYPES.map((value) => <button key={value} className={`term-btn ${chartType === value ? "active" : ""}`} aria-pressed={chartType === value} onClick={() => setChartType(value)}>{translateText(value)}</button>)}
                {INDICATORS.map((value) => <button key={value} className={`term-btn ${active.has(value) ? "active" : ""}`} aria-pressed={active.has(value)} onClick={() => toggleIndicator(value)}>{value}</button>)}
                <button className={`term-btn ${mainFormulaEnabled ? "active" : ""}`} aria-pressed={mainFormulaEnabled} onClick={() => { mainFormulaRef.current = !mainFormulaEnabled; setMainFormulaEnabled(mainFormulaRef.current); }}>{t("主图公式")}</button>
                <button className={`term-btn ${editorOpen ? "active" : ""}`} aria-expanded={editorOpen} onClick={() => setEditorOpen(!editorOpen)}>PINE</button>
            </div>
            <div className="px-2 pb-1 text-[11px] dim flex gap-3 flex-wrap" role="status">
                <a href="https://velacharts.dev" target="_blank" rel="noreferrer">Vela™</a>
                <span>{symbol} · {timeframe} · {mode === "fixture" ? t("FIXTURE 模拟数据") : mode === "longbridge" ? "长桥 · 前复权" : t("LIVE")}</span>
                <span>{isFetching ? t("加载中…") : t("{count} bars · {source}", { count: data?.bars.length ?? 0, source: data?.source ?? t("无数据源") })}</span>
                {data?.attempts.map((attempt, index) => <span key={`${attempt.source}-${index}`} title={attempt.error}>{attempt.source}: {translateText(attempt.status)}{attempt.cache ? ` · ${attempt.cache === "stale" ? t("旧缓存 (stale)") : `cache=${attempt.cache}`}` : ""}</span>)}
            </div>
            {mainFormulaEnabled && <div className="px-2 pb-1 text-[11px] dim">
                <p>{t("主图公式周期说明", { timeframe })}</p>
                {data && data.bars.length < 200 && <p>{t("主图公式历史不足")}</p>}
            </div>}
            {(error || chartError) && <div className="p-2 down text-[11px]" role="alert">{error?.message ?? chartError}</div>}
            <div className="relative flex-1 min-h-0">
                {legend && <div className="absolute top-1 left-2 z-10 flex gap-3 flex-wrap text-[11px] pointer-events-none bg-[rgba(10,10,10,0.7)] px-2 py-1 rounded">
                    <span>O {fmt(legend.open)}</span><span className="up">H {fmt(legend.high)}</span><span className="down">L {fmt(legend.low)}</span><span>C {fmt(legend.close)}</span><span className="dim">{t("Vol")} {fmtBig(legend.volume)}</span>
                </div>}
                <div ref={containerRef} className="w-full h-full" aria-label={t("{symbol} Vela 图表", { symbol })} />
            </div>
            {editorOpen && <div className="shrink-0 border-t border-[var(--border)] p-2 flex flex-col gap-1">
                <div className="flex items-center gap-2 text-[11px]">
                    <span className="dim">Pine Script · PineTS Worker</span>
                    <button className="term-btn" disabled={!marketReady || running} onClick={runPine}>{running ? t("执行中…") : t("执行")}</button>
                    <button className="term-btn" disabled={running} onClick={() => { adapter?.clearPine(); setPineStatus({ state: "cleared" }); }}>{t("清除")}</button>
                </div>
                <textarea aria-label={t("Pine 脚本编辑器")} spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void runPine(); } }} className="w-full h-28 resize-y bg-[var(--bg)] text-[var(--text)] font-mono text-[11px] p-2 border border-[var(--border)]" />
                <div role="status" className={`text-[11px] ${pineStatus.state === "failed" ? "down" : "dim"}`}>{pineStatus.state === "done" ? t("已执行：{title}", { title: pineStatus.detail ?? "" }) : pineStatus.state === "failed" ? t("执行失败：{error}", { error: pineStatus.detail ?? "" }) : pineStatus.state === "running" ? t("执行中…") : pineStatus.state === "cleared" ? t("已清除") : t("Ctrl / Cmd + Enter 执行")}</div>
            </div>}
        </div>
    );
}
