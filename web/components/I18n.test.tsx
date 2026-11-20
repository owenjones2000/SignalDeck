import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import { useTerminal } from "../store/terminal";
import { useLocale } from "../store/locale";
import { translate } from "../lib/i18n";

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
afterEach(() => { cleanup(); useLocale.getState().setLocale("zh-CN"); useTerminal.getState().resetWorkspace(); });

it("switches shell controls and widget names without changing widget identity or saved layout", () => {
    useLocale.getState().setLocale("zh-CN");
    const layout = structuredClone(useTerminal.getState().layout);
    render(<><TopBar /><Sidebar /></>);
    expect(screen.getByRole("button", { name: "量化选股" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("button", { name: "Quant Screen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset layout" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    expect(useTerminal.getState().layout).toEqual(layout);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("button", { name: "量化选股" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("zh-CN");
});

it("persists language separately and rehydrates it without overwriting an older workspace", async () => {
    const legacy = { state: { activeSymbol: "MSFT", widgets: [{ id: "legacy", type: "chart", linked: true }], layout: [{ i: "legacy", x: 2, y: 3, w: 6, h: 9 }], watchlist: ["MSFT"] }, version: 0 };
    localStorage.setItem("openterminal-workspace", JSON.stringify(legacy));
    await act(() => useTerminal.persist.rehydrate());
    act(() => useLocale.getState().setLocale("en"));
    expect(JSON.parse(localStorage.getItem("openterminal-locale")!).state.locale).toBe("en");
    useLocale.setState({ locale: "zh-CN" });
    localStorage.setItem("openterminal-locale", JSON.stringify({ state: { locale: "en" }, version: 0 }));
    await act(() => useLocale.persist.rehydrate());
    expect(useLocale.getState().locale).toBe("en");
    expect(useTerminal.getState().layout).toEqual(legacy.state.layout);
});

it("translates known statuses while preserving unknown upstream errors", () => {
    expect(translate("en", "加载中…")).toBe("Loading…");
    expect(translate("en", "未知错误")).toBe("Unknown error");
    expect(translate("en", "服务在线")).toBe("Service online");
});
