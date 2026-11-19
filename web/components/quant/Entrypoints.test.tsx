import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Sidebar from "../Sidebar";
import { useTerminal } from "../../store/terminal";
import { render } from "@testing-library/react";

afterEach(() => { cleanup(); useTerminal.getState().resetWorkspace(); });

it("adds four distinct quant panels without replacing the existing workspace", () => {
    useTerminal.getState().resetWorkspace();
    const initial = useTerminal.getState().widgets.length;
    render(<Sidebar />);
    for (const label of ["量化选股", "A股自选 / 日线", "策略回测", "提醒 / 历史"]) {
        fireEvent.click(screen.getByRole("button", { name: label }));
    }
    const state = useTerminal.getState();
    expect(state.widgets.length).toBe(initial + 4);
    expect(state.widgets.slice(-4).map((widget) => widget.type)).toEqual(["quant-screen", "quant-watch", "quant-backtest", "quant-alerts"]);
    expect(state.layout.slice(-4).every((item) => item.w >= 6 && item.h >= 10)).toBe(true);
    expect(state.widgets.slice(-4).every((widget) => !widget.linked)).toBe(true);
});
