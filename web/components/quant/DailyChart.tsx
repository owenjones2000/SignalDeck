"use client";

import { useI18n } from "../../lib/useI18n";

import { useEffect, useRef, useState } from "react";
import { fmt } from "../../lib/api";
import { toVelaBars } from "../../lib/quant/vela-bars";
import type { History } from "../../lib/quant/types";
import type { ChartAdapter } from "../../lib/vela/chart-adapter";
import type { Bar } from "../../lib/vela/types";
import { ErrorMessage } from "./Common";

export default function DailyChart({ history }: { history: History }) {
    const { t, locale } = useI18n();
    const container = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<unknown>(null);
    const [ready, setReady] = useState(false);
    const [legend, setLegend] = useState<Bar | null>(null);
    const [adapter, setAdapter] = useState<ChartAdapter | null>(null);
    const [mainFormulaEnabled, setMainFormulaEnabled] = useState(true);
    const mainFormulaRef = useRef(true);
    const hasBars = history.bars.length > 0;

    useEffect(() => {
        let cancelled = false;
        let instance: ChartAdapter | null = null;
        if (!hasBars) return;
        async function initialize() {
            try {
                const { createChartAdapter } = await import("../../lib/vela/chart-adapter");
                if (cancelled || !container.current) return;
                instance = createChartAdapter(container.current, (bar) => { if (!cancelled) setLegend(bar); }, (enabled) => {
                    if (cancelled) return;
                    mainFormulaRef.current = enabled;
                    setMainFormulaEnabled(enabled);
                });
                instance.setMainFormula(mainFormulaRef.current);
                instance.setStyle("candles");
                setAdapter(instance);
            } catch (reason) {
                if (!cancelled) setError(reason);
            }
        }
        void initialize();
        return () => {
            cancelled = true;
            instance?.destroy();
            setAdapter(null);
        };
    }, [hasBars]);

    useEffect(() => {
        let cancelled = false;
        setError(null);
        setReady(false);
        setLegend(null);
        if (!adapter || !hasBars) return;
        const instance = adapter;
        async function updateMarket() {
            try {
                await instance.setMarket(history.code, "1D", toVelaBars(history.bars));
                if (!cancelled) setReady(true);
            } catch (reason) {
                if (!cancelled) setError(reason);
            }
        }
        void updateMarket();
        return () => { cancelled = true; };
    }, [adapter, history, hasBars]);

    useEffect(() => { adapter?.setMainFormula(mainFormulaEnabled); }, [adapter, mainFormulaEnabled]);

    if (history.bars.length === 0) return <p className="dim">{t("暂无日线数据")}</p>;
    return <div>
        <ErrorMessage error={error} />
        <button className={`term-btn ${mainFormulaEnabled ? "active" : ""}`} aria-pressed={mainFormulaEnabled} onClick={() => { mainFormulaRef.current = !mainFormulaEnabled; setMainFormulaEnabled(mainFormulaRef.current); }}>{t("主图公式")}</button>
        <p role="status" className="dim">{ready ? t("Vela · 1D · {count} bars · 上海收盘 15:00", { count: history.bars.length }) : error ? t("日线图加载失败") : t("加载 Vela 日线图…")}</p>
        {mainFormulaEnabled && <div className="dim text-[11px]">
            <p>{t("主图公式周期说明", { timeframe: "1D" })}</p>
            {history.bars.length < 200 && <p>{t("主图公式历史不足")}</p>}
        </div>}
        {legend && <p className="dim">{new Date(legend.time).toLocaleDateString(locale, { timeZone: "Asia/Shanghai" })} · O {fmt(legend.open)} · H {fmt(legend.high)} · L {fmt(legend.low)} · C {fmt(legend.close)} · Vol {fmt(legend.volume, 0)}</p>}
        <div ref={container} className="w-full h-[320px] min-h-[240px]" role="img" aria-label={t("{code} Vela 日线蜡烛图", { code: history.code })} />
    </div>;
}
