import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ScreenWidget from "./ScreenWidget";
import { job, mockApi, renderQuant, status } from "./test-support";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("submits a screen job, polls it and shows hits and individual failures", async () => {
    let reads = 0;
    const fetcher = mockApi({
        "GET /api/quant/status": status,
        "GET /api/quant/formulas": [{ key: "ma_cross", name: "5/20日均线金叉", min_history: 21 }],
        "GET /api/quant/jobs": [],
        "POST /api/quant/jobs": job,
        "GET /api/quant/jobs/j1": () => ++reads === 1 ? { ...job, status: "running" } : {
            ...job, status: "completed", result: { hits: [{ code: "000001", formula: "ma_cross", date: "2026-11-18", price: 12.5 }], failures: [{ code: "600000", error: "Insufficient history" }] },
        },
    });
    renderQuant(<ScreenWidget />);
    await screen.findByText("5/20日均线金叉");
    fireEvent.change(screen.getByLabelText("选股代码"), { target: { value: "000001,600000" } });
    fireEvent.click(screen.getByRole("button", { name: "运行选股" }));
    await screen.findByText("Insufficient history", {}, { timeout: 4000 });
    expect(screen.getByText("12.50")).toBeTruthy();
    const request = fetcher.mock.calls.find(([, options]) => options?.method === "POST");
    expect(JSON.parse(request![1]!.body as string)).toEqual({ kind: "screen", params: { formula: "ma_cross", codes: ["000001", "600000"], count: 250 } });
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    const terminalReads = reads;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(reads).toBe(terminalReads);
});

it("opens a failed historical job and shows its error", async () => {
    mockApi({
        "GET /api/quant/status": status,
        "GET /api/quant/formulas": [{ key: "ma_cross", name: "均线", min_history: 21 }],
        "GET /api/quant/jobs": [{ ...job, status: "failed", error: "Supplier offline" }],
        "GET /api/quant/jobs/j1": { ...job, status: "failed", error: "Supplier offline" },
    });
    renderQuant(<ScreenWidget />);
    fireEvent.click(await screen.findByRole("button", { name: /查看任务/ }));
    expect(await screen.findByText("Supplier offline")).toBeTruthy();
});

it("makes authentication failure visible instead of presenting an empty result", async () => {
    mockApi(Object.fromEntries(["status", "formulas", "jobs"].map((path) => [`GET /api/quant/${path}`, () => Response.json({ error: "Invalid API key" }, { status: 401 })])));
    renderQuant(<ScreenWidget />);
    expect((await screen.findAllByRole("alert"))[0].textContent).toContain("鉴权失败（HTTP 401）");
});

it("shows no-hit reports and adds a hit through the server watchlist API", async () => {
    const empty = { ...job, status: "completed", result: { hits: [], failures: [] } };
    const fetcher = mockApi({
        "GET /api/quant/status": status,
        "GET /api/quant/formulas": [{ key: "ma_cross", name: "均线", min_history: 21 }],
        "GET /api/quant/jobs": [empty, { ...job, id: "j2" }],
        "GET /api/quant/jobs/j1": empty,
        "GET /api/quant/jobs/j2": { ...empty, id: "j2", result: { hits: [{ code: "000001", formula: "ma_cross", date: "2026-11-18", price: 12.5 }], failures: [] } },
        "POST /api/quant/watchlist": { code: "000001" },
    });
    renderQuant(<ScreenWidget />);
    fireEvent.click(await screen.findByRole("button", { name: "查看任务 j1" }));
    expect(await screen.findByText("无命中股票")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看任务 j2" }));
    fireEvent.click(await screen.findByRole("button", { name: "加入自选 000001" }));
    expect(await screen.findByText("已加入 A 股自选")).toBeTruthy();
    expect(fetcher.mock.calls.find(([url]) => url === "/api/quant/watchlist")?.[1]?.body).toBe('{"code":"000001"}');
});
