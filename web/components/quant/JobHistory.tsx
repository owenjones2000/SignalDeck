"use client";

import { ErrorMessage } from "./Common";
import type { useJobs } from "./useJobs";

export const jobStates = { queued: "排队中", running: "运行中", completed: "已完成", failed: "失败" };

export default function JobHistory({ state }: { state: ReturnType<typeof useJobs> }) {
    return <section className="quant-section" aria-label="任务历史">
        <div className="flex justify-between"><h3 className="amber">任务历史</h3><button className="term-btn" disabled={state.jobs.isFetching} onClick={() => state.jobs.refetch()}>刷新任务</button></div>
        <ErrorMessage error={state.jobs.error} />
        {state.jobs.isPending && <p role="status">加载任务…</p>}
        {!state.jobs.isPending && !state.jobs.error && state.history.length === 0 && <p className="dim">暂无任务</p>}
        <div className="quant-table"><table className="data-table"><thead><tr><th>创建时间</th><th>参数</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{state.history.map((job) => <tr key={job.id}>
                <td>{job.created_at}</td><td>{String(job.params.formula ?? job.params.strategy ?? "")} / {String(job.params.code ?? (Array.isArray(job.params.codes) ? job.params.codes.join(",") : ""))}</td>
                <td>{jobStates[job.status]}</td><td><button className="term-btn" aria-label={`查看任务 ${job.id}`} onClick={() => state.setSelected(job.id)}>查看</button></td>
            </tr>)}</tbody>
        </table></div>
        <ErrorMessage error={state.detail.error} />
        {state.selected && state.detail.isPending && <p role="status">加载报告…</p>}
        {state.detail.data && <div aria-live="polite" className="quant-section">
            <span className="dim">任务 {state.detail.data.id} · </span><span className="amber">{jobStates[state.detail.data.status]}</span>
            {(state.detail.data.status === "running" || state.detail.data.status === "queued") && <span className="dim"> · 自动轮询中</span>}
            <ErrorMessage error={state.detail.data.error} />
            <button className="term-btn ml-2" onClick={() => state.detail.refetch()} disabled={state.detail.isFetching}>刷新报告</button>
        </div>}
    </section>;
}
