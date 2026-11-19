import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AlertsWidget from "./AlertsWidget";
import { mockApi, renderQuant, status } from "./test-support";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("creates, pauses, tests and deletes alerts and shows delivery history", async () => {
    const alert = { id: "a1", name: "均线提醒", codes: ["000001"], signal: "ma_cross", enabled: true, interval_minutes: 5, channel: "local", next_scan_at: "2026-11-18T10:00:00Z", last_error: null, created_at: "2026-11-18T09:00:00Z" };
    let alerts: typeof alert[] = [];
    const fetcher = mockApi({
        "GET /api/quant/status": status,
        "GET /api/quant/alerts": () => alerts,
        "GET /api/quant/notifications": [{ id: "n1", alert_id: "a1", channel: "local", status: "failed", attempts: 5, error: "Delivery offline", created_at: "2026-11-18T09:00:00Z", sent_at: null, next_attempt_at: "2026-11-18T10:00:00Z", payload: { code: "000001", key: "ma_cross", name: "均线金叉", type: "buy", date: "2026-11-18", price: 12.5, alert_name: "均线提醒" } }],
        "POST /api/quant/alerts": () => { alerts = [alert]; return alert; },
        "PATCH /api/quant/alerts/a1": () => { alerts = [{ ...alert, enabled: false }]; return alerts[0]; },
        "POST /api/quant/alerts/a1/test": { signals: [], failures: [{ code: "000001", error: "History offline" }] },
        "DELETE /api/quant/alerts/a1": () => { alerts = []; return new Response(null, { status: 204 }); },
    });
    renderQuant(<AlertsWidget />);
    await screen.findByText("暂无提醒规则");
    expect((screen.getByRole("option", { name: /飞书/ }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("提醒名称"), { target: { value: "均线提醒" } });
    fireEvent.change(screen.getByLabelText("提醒代码"), { target: { value: "000001" } });
    fireEvent.click(screen.getByRole("button", { name: "创建提醒" }));
    fireEvent.click(await screen.findByRole("button", { name: "暂停提醒 均线提醒" }));
    await screen.findByRole("button", { name: "启用提醒 均线提醒" });
    fireEvent.click(screen.getByRole("button", { name: "试扫提醒 均线提醒" }));
    expect(await screen.findByText(/History offline/)).toBeTruthy();
    expect(screen.getByText("Delivery offline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除提醒 均线提醒" }));
    await screen.findByText("暂无提醒规则");
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === "PATCH" && options.body === '{"enabled":false}')).toBe(true));
    expect(JSON.parse(fetcher.mock.calls.find(([url, options]) => url === "/api/quant/alerts" && options?.method === "POST")![1]!.body as string)).toEqual({ name: "均线提醒", codes: ["000001"], signal: "ma_cross", enabled: true, interval_minutes: 5, channel: "local" });
});

it("shows empty notification history and service unavailability", async () => {
    mockApi({ "GET /api/quant/status": { ...status, available: false, error: "Quant offline" }, "GET /api/quant/alerts": [], "GET /api/quant/notifications": [] });
    renderQuant(<AlertsWidget />);
    expect(await screen.findByText("暂无通知历史")).toBeTruthy();
    expect(screen.getByText("服务不可用：Quant offline")).toBeTruthy();
});

it("shows API rejection when creating an alert and keeps user input", async () => {
    mockApi({ "GET /api/quant/status": status, "GET /api/quant/alerts": [], "GET /api/quant/notifications": [], "POST /api/quant/alerts": () => Response.json({ error: "Alert limit is 100" }, { status: 409 }) });
    renderQuant(<AlertsWidget />);
    await screen.findByText("暂无提醒规则");
    fireEvent.change(screen.getByLabelText("提醒名称"), { target: { value: "提醒" } });
    fireEvent.change(screen.getByLabelText("提醒代码"), { target: { value: "000001" } });
    fireEvent.click(screen.getByRole("button", { name: "创建提醒" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Alert limit is 100");
    expect((screen.getByLabelText("提醒代码") as HTMLInputElement).value).toBe("000001");
});
