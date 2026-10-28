import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vela } from "@luxalgo/vela";
import { createPineAdapter } from "./pine-adapter";

const mocks = vi.hoisted(() => ({ terminate: vi.fn() }));
vi.mock("@luxalgo/vela-pinets", () => ({ PineWorkerEngine: class { terminate = mocks.terminate; } }));

function setup() {
    const runIndicator = vi.fn();
    const registerEngine = vi.fn();
    const adapter = createPineAdapter({ runIndicator, registerEngine } as unknown as Vela);
    return { adapter, runIndicator, registerEngine };
}

describe("Pine 适配器", () => {
    beforeEach(() => vi.clearAllMocks());

    it("注册 worker，成功执行后替换旧指标", async () => {
        const { adapter, runIndicator, registerEngine } = setup();
        const old = { title: "old", remove: vi.fn() };
        const next = { title: "next", remove: vi.fn() };
        runIndicator.mockResolvedValueOnce({ ok: true, handle: old }).mockResolvedValueOnce({ ok: true, handle: next });
        expect(registerEngine).toHaveBeenCalledWith("pine", expect.anything());
        await adapter.run("old source");
        expect(await adapter.run("next source")).toBe("next");
        expect(old.remove).toHaveBeenCalledOnce();
        adapter.destroy();
        expect(next.remove).toHaveBeenCalledOnce();
        expect(mocks.terminate).toHaveBeenCalledOnce();
    });

    it("执行失败保留旧指标，空脚本不调用引擎", async () => {
        const { adapter, runIndicator } = setup();
        const old = { title: "old", remove: vi.fn() };
        runIndicator.mockResolvedValueOnce({ ok: true, handle: old }).mockResolvedValueOnce({ ok: false, error: new Error("syntax") });
        await adapter.run("valid");
        await expect(adapter.run("invalid")).rejects.toThrow("syntax");
        await expect(adapter.run(" ")).rejects.toThrow("请输入");
        expect(old.remove).not.toHaveBeenCalled();
        expect(runIndicator).toHaveBeenCalledTimes(2);
    });

    it("清除或销毁后不会挂载过期执行结果", async () => {
        const { adapter, runIndicator } = setup();
        const handle = { title: "late", remove: vi.fn() };
        let finish: (value: unknown) => void = () => {};
        runIndicator.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const run = adapter.run("pending");
        adapter.clear();
        finish({ ok: true, handle });
        await expect(run).rejects.toThrow("取消");
        expect(handle.remove).toHaveBeenCalledOnce();
        adapter.destroy();
        await expect(adapter.run("later")).rejects.toThrow("已销毁");
    });
});
