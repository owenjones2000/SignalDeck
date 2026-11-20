"use client";

import { useI18n } from "../lib/useI18n";

import { useEffect, useRef, useState } from "react";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { normalizeSymbol } from "../lib/symbol";
import { useTerminal, type WidgetInstance } from "../store/terminal";
import QuoteWidget from "./widgets/QuoteWidget";
import ChartWidget from "./widgets/ChartWidget";
import WatchlistWidget from "./widgets/WatchlistWidget";
import NewsWidget from "./widgets/NewsWidget";
import HeatmapWidget from "./widgets/HeatmapWidget";
import ScreenerWidget from "./widgets/ScreenerWidget";
import CryptoWidget from "./widgets/CryptoWidget";
import MacroWidget from "./widgets/MacroWidget";
import OptionsWidget from "./widgets/OptionsWidget";
import PortfolioWidget from "./widgets/PortfolioWidget";
import AiWidget from "./widgets/AiWidget";
import CalendarWidget from "./widgets/CalendarWidget";
import InsiderWidget from "./widgets/InsiderWidget";
import TvWidget from "./widgets/TvWidget";
import RecapWidget from "./widgets/RecapWidget";
import LongbridgeWidget from "./widgets/LongbridgeWidget";
import WidgetErrorBoundary from "./WidgetErrorBoundary";
import dynamic from "next/dynamic";

function PanelLoading() {
  const { t } = useI18n();
  return <p className="dim p-2">{t("加载中…")}</p>;
}

const ScreenWidget = dynamic(() => import("./quant/ScreenWidget"), { loading: PanelLoading });
const QuantWatchWidget = dynamic(() => import("./quant/WatchWidget"), { loading: PanelLoading });
const BacktestWidget = dynamic(() => import("./quant/BacktestWidget"), { loading: PanelLoading });
const AlertsWidget = dynamic(() => import("./quant/AlertsWidget"), { loading: PanelLoading });

function WidgetBody({ widget }: { widget: WidgetInstance }) {
  switch (widget.type) {
    case "quote": return <QuoteWidget widget={widget} />;
    case "chart": return <ChartWidget widget={widget} />;
    case "watchlist": return <WatchlistWidget />;
    case "news": return <NewsWidget widget={widget} />;
    case "heatmap": return <HeatmapWidget />;
    case "screener": return <ScreenerWidget />;
    case "crypto": return <CryptoWidget />;
    case "macro": return <MacroWidget />;
    case "options": return <OptionsWidget widget={widget} />;
    case "portfolio": return <PortfolioWidget />;
    case "ai": return <AiWidget />;
    case "calendar": return <CalendarWidget />;
    case "insider": return <InsiderWidget widget={widget} />;
    case "tv": return <TvWidget />;
    case "recap": return <RecapWidget />;
    case "longbridge": return <LongbridgeWidget />;
    case "quant-screen": return <ScreenWidget />;
    case "quant-watch": return <QuantWatchWidget />;
    case "quant-backtest": return <BacktestWidget />;
    case "quant-alerts": return <AlertsWidget />;
  }
}

function SymbolTag({ widget, activeSymbol }: { widget: WidgetInstance; activeSymbol: string }) {
    const { t } = useI18n();
  const setWidgetSymbol = useTerminal((s) => s.setWidgetSymbol);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = widget.linked ? activeSymbol : widget.symbol ?? activeSymbol;

  useEffect(() => {
    if (!editing) return;
    setDraft(shown);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = normalizeSymbol(draft);
            if (v) setWidgetSymbol(widget.id, v);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className="ml-2 w-16 !border-0 !border-b !border-[var(--amber-dim)] bg-transparent text-[var(--text)] px-0 py-0 text-[13px] leading-none"
      />
    );
  }

  return (
    <span
      className="ml-2 text-[var(--text)] cursor-pointer hover:text-[var(--amber)]"
      title={t("Click to set this widget's ticker")}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => setEditing(true)}
    >
      {shown}
    </span>
  );
}

const TITLES: Record<string, string> = {
  quote: "Quote", chart: "Chart", watchlist: "Watchlist", news: "News",
  heatmap: "Heatmap", screener: "Screener", crypto: "Crypto",
  macro: "Macro / Indexes", options: "Option Chain", portfolio: "Portfolio", ai: "AI Assistant",
  calendar: "Calendar", insider: "Insider Transactions", tv: "Live TV", recap: "Market Recap",
  longbridge: "长桥行情",
  "quant-screen": "量化选股 / Screen", "quant-watch": "A股自选 / Daily",
  "quant-backtest": "策略回测 / Backtest", "quant-alerts": "提醒 / Notifications",
};

export default function Workspace() {
    const { t, text: translateText } = useI18n();
  const widgets = useTerminal((s) => s.widgets);
  const layout = useTerminal((s) => s.layout);
  const setLayout = useTerminal((s) => s.setLayout);
  const removeWidget = useTerminal((s) => s.removeWidget);
  const toggleLinked = useTerminal((s) => s.toggleLinked);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const singleChart = widgets.length === 1 && widgets[0].type === "chart";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setWidth(container.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const symbolAware = new Set(["quote", "chart", "news", "options", "insider"]);

  return (
    <div ref={containerRef} className="h-full min-h-0">
    {singleChart ? <div data-testid="single-chart" className="h-full p-1">
      <div className="terminal-panel">
        <div className="panel-title"><span>{translateText(TITLES.chart)}<SymbolTag widget={widgets[0]} activeSymbol={activeSymbol} /></span><span className="flex gap-2 items-center"><button title={widgets[0].linked ? t("Linked to active symbol (click to unlink)") : t("Unlinked (click to link)")} onClick={() => toggleLinked(widgets[0].id)}>⛓</button><button aria-label={t("Close chart")} onClick={() => removeWidget(widgets[0].id)}>✕</button></span></div>
        <div className="flex-1 min-h-0 overflow-auto"><WidgetErrorBoundary name={translateText(TITLES.chart)}><WidgetBody widget={widgets[0]} /></WidgetErrorBoundary></div>
      </div>
    </div> : <GridLayout
      className="layout"
      width={width}
      layout={layout}
      cols={12}
      rowHeight={30}
      margin={[4, 4]}
      compactType={null}
      draggableHandle=".panel-title"
      onDragStop={(l) => setLayout(l.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })))}
      onResizeStop={(l) => setLayout(l.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })))}
    >
      {widgets.map((w) => (
        <div key={w.id}>
          <div className="terminal-panel">
            <div className="panel-title">
              <span>
                {translateText(TITLES[w.type])}
                {symbolAware.has(w.type) && <SymbolTag widget={w} activeSymbol={activeSymbol} />}
              </span>
              <span className="flex gap-2 items-center">
                {symbolAware.has(w.type) && (
                  <button
                    title={w.linked ? t("Linked to active symbol (click to unlink)") : t("Unlinked (click to link)")}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => toggleLinked(w.id)}
                    className={w.linked ? "text-[var(--amber)]" : "dim"}
                  >
                    ⛓
                  </button>
                )}
                <button
                  aria-label={t("Close panel")}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => removeWidget(w.id)}
                  className="dim hover:text-[var(--down)]"
                >
                  ✕
                </button>
              </span>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              <WidgetErrorBoundary name={translateText(TITLES[w.type])}>
                <WidgetBody widget={w} />
              </WidgetErrorBoundary>
            </div>
          </div>
        </div>
      ))}
    </GridLayout>}
    </div>
  );
}
