import { PineWorkerEngine } from "@luxalgo/vela-pinets";
import type { IndicatorHandle, Vela } from "@luxalgo/vela";

export function createPineAdapter(chart: Vela) {
    const engine = new PineWorkerEngine();
    chart.registerEngine("pine", engine);
    let handle: IndicatorHandle | null = null;
    let destroyed = false;
    let generation = 0;

    return {
        async run(source: string): Promise<string> {
            if (destroyed) throw new Error("图表已销毁");
            if (!source.trim()) throw new Error("请输入 Pine 脚本");
            const current = ++generation;
            const result = await chart.runIndicator(source, { language: "pine" });
            if (destroyed || current !== generation) {
                result.handle?.remove();
                throw new Error("执行已取消");
            }
            if (!result.ok || !result.handle) throw result.error ?? new Error("Pine 执行失败");
            handle?.remove();
            handle = result.handle;
            return handle.title;
        },
        clear() {
            generation++;
            handle?.remove();
            handle = null;
        },
        destroy() {
            destroyed = true;
            generation++;
            handle?.remove();
            handle = null;
            engine.terminate();
        },
    };
}
