"use client";

export default function LineChart({ values, label }: { values: number[]; label: string }) {
    if (values.length === 0) return <p className="dim">暂无曲线数据</p>;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const range = high - low || 1;
    const points = values.map((value, index) => `${24 + index / Math.max(values.length - 1, 1) * 552},${135 - (value - low) / range * 110}`).join(" ");
    return <svg className="quant-chart" viewBox="0 0 600 160" role="img" aria-label={label}>
        <title>{label}</title>
        <path d="M24 25H576 M24 80H576 M24 135H576" fill="none" stroke="var(--border)" />
        {values.length === 1
            ? <circle cx="24" cy="135" r="4" fill="var(--amber)" />
            : <polyline points={points} fill="none" stroke="var(--amber)" strokeWidth="2" />}
        <text x="24" y="155" fill="var(--text-dim)" fontSize="10">最低 {low.toFixed(2)} / 最高 {high.toFixed(2)}</text>
    </svg>;
}
