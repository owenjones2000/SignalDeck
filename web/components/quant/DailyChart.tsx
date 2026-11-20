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

    useEffect(() => {
        let cancelled = false;
        let adapter: ChartAdapter | null = null;
        setError(null);
        setReady(false);
        setLegend(null);
        if (history.bars.length === 0) return;
        async function initialize() {
            try {
                const bars = toVelaBars(history.bars);
                const { createChartAdapter } = await import("../../lib/vela/chart-adapter");
                if (cancelled || !container.current) return;
                adapter = createChartAdapter(container.current, (bar) => { if (!cancelled) setLegend(bar); });
                adapter.setStyle("candles");
                await adapter.setMarket(history.code, "1D", bars);
                if (!cancelled) setReady(true);
            } catch (reason) {
                if (!cancelled) setError(reason);
            }
        }
        void initialize();
        return () => {
            cancelled = true;
            adapter?.destroy();
        };
    }, [history]);

    if (history.bars.length === 0) return <p className="dim">{t("暂无日线数据")}</p>;
    return <div>
        <ErrorMessage error={error} />
        <p role="status" className="dim">{ready ? t("Vela · 1D · {count} bars · 上海收盘 15:00", { count: history.bars.length }) : error ? t("日线图加载失败") : t("加载 Vela 日线图…")}</p>
        {legend && <p className="dim">{new Date(legend.time).toLocaleDateString(locale, { timeZone: "Asia/Shanghai" })} · O {fmt(legend.open)} · H {fmt(legend.high)} · L {fmt(legend.low)} · C {fmt(legend.close)} · Vol {fmt(legend.volume, 0)}</p>}
        <div ref={container} className="w-full h-[320px] min-h-[240px]" role="img" aria-label={t("{code} Vela 日线蜡烛图", { code: history.code })} />
    </div>;
}
