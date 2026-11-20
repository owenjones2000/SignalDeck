import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CalendarWidget from "./CalendarWidget";
import { mockApi, renderQuant } from "../quant/test-support";
import { useLocale } from "../../store/locale";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useLocale.getState().setLocale("zh-CN"); });

it("uses stable timezone ids and preserves the selected timezone across language switches", async () => {
    useLocale.getState().setLocale("zh-CN");
    mockApi({ "GET /api/econ-calendar": [{ title: "Test event", country: "USD", date: "2026-11-19T15:00:00Z", impact: "High", forecast: null, previous: null, actual: null }] });
    renderQuant(<CalendarWidget />);
    await screen.findByText("Test event");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("local");
    expect(screen.getByRole("option", { name: "纽约" }).getAttribute("value")).toBe("America/New_York");
    fireEvent.change(select, { target: { value: "America/New_York" } });
    const row = screen.getByRole("row", { name: /Test event/ });
    expect(within(row).getAllByRole("cell")[0].textContent).toContain("10:00");
    act(() => useLocale.getState().setLocale("en"));
    expect(select.value).toBe("America/New_York");
    expect((screen.getByRole("option", { name: "New York" }) as HTMLOptionElement).selected).toBe(true);
    expect(within(row).getAllByRole("cell")[0].textContent).toContain("10:00");
    act(() => useLocale.getState().setLocale("zh-CN"));
    expect(select.value).toBe("America/New_York");
    expect((screen.getByRole("option", { name: "纽约" }) as HTMLOptionElement).selected).toBe(true);
});
