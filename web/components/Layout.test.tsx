import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Terminal from "./Terminal";
import { useTerminal, type WidgetInstance } from "../store/terminal";
import type { Layout } from "react-grid-layout";
import type { ReactNode } from "react";

const grid = vi.hoisted(() => ({ width: 0 }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock("./CommandPalette", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => <div>Quant body</div> }));
vi.mock("react-grid-layout", () => ({
    default: ({ children, width, layout, onLayoutChange, onDragStop, onResizeStop }: { children: ReactNode; width: number; layout: Layout[]; onLayoutChange?: (layout: Layout[]) => void; onDragStop: (layout: Layout[]) => void; onResizeStop: (layout: Layout[]) => void }) => {
        grid.width = width;
        return <div data-testid="grid"><button onClick={() => onLayoutChange?.(layout.map((item) => ({ ...item, y: 0 })))}>Automatic grid layout</button><button onClick={() => onDragStop(layout.map((item) => ({ ...item, y: 2 })))}>Drag panel</button><button onClick={() => onResizeStop(layout.map((item) => ({ ...item, h: 8 })))}>Resize panel</button>{children}</div>;
    },
    WidthProvider: (component: unknown) => component,
}));
vi.mock("./widgets/ChartWidget", () => ({ default: () => <div>Chart body</div> }));
vi.mock("./widgets/QuoteWidget", () => ({ default: () => <div>Quote body</div> }));
vi.mock("./widgets/WatchlistWidget", () => ({ default: () => null }));
vi.mock("./widgets/NewsWidget", () => ({ default: () => null }));
vi.mock("./widgets/MacroWidget", () => ({ default: () => null }));

let resize: ResizeObserverCallback;
beforeEach(() => {
    useTerminal.getState().resetWorkspace();
    useTerminal.setState({ sidebarCollapsed: false });
    vi.stubGlobal("ResizeObserver", class {
        constructor(callback: ResizeObserverCallback) { resize = callback; }
        observe() {}
        disconnect() {}
    });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useTerminal.getState().resetWorkspace(); });

it("collapses and restores the sidebar without modifying the saved layout", () => {
    const original = structuredClone(useTerminal.getState().layout);
    render(<Terminal />);
    fireEvent.click(screen.getByRole("button", { name: /收起侧栏|Collapse sidebar/ }));
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(useTerminal.getState().sidebarCollapsed).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /展开侧栏|Expand sidebar/ }));
    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(useTerminal.getState().layout).toEqual(original);
});

it("fills the available workspace only for a lone chart and restores its saved geometry when adding a panel", () => {
    const original = [{ i: "chart", x: 3, y: 4, w: 7, h: 12 }];
    useTerminal.setState({ widgets: [{ id: "chart", type: "chart", linked: true }], layout: original });
    render(<Terminal />);
    expect(screen.queryByTestId("grid")).toBeNull();
    expect(screen.getByTestId("single-chart").className).toContain("h-full");
    expect(useTerminal.getState().layout).toEqual(original);
    act(() => useTerminal.getState().addWidget("quote"));
    expect(screen.queryByTestId("single-chart")).toBeNull();
    expect(screen.getByTestId("grid")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Automatic grid layout" }));
    expect(useTerminal.getState().layout[0]).toEqual(original[0]);
});

it.each<{ widgets: WidgetInstance[] }>([{ widgets: [] }, { widgets: [{ id: "quote", type: "quote", linked: true }] }, { widgets: [{ id: "a", type: "chart", linked: true }, { id: "b", type: "chart", linked: true }] }])("keeps non-single-chart workspaces in the grid", ({ widgets }) => {
    useTerminal.setState({ widgets, layout: [] });
    render(<Terminal />);
    expect(screen.getByTestId("grid")).toBeTruthy();
    expect(screen.queryByTestId("single-chart")).toBeNull();
});

it("remeasures grid width when its container changes size", () => {
    render(<Terminal />);
    act(() => resize([{ contentRect: { width: 900 } }] as ResizeObserverEntry[], {} as ResizeObserver));
    expect(grid.width).toBe(900);
    act(() => resize([{ contentRect: { width: 1028 } }] as ResizeObserverEntry[], {} as ResizeObserver));
    expect(grid.width).toBe(1028);
});

it("persists explicit user drag and resize changes rather than automatic grid callbacks", () => {
    render(<Terminal />);
    fireEvent.click(screen.getByRole("button", { name: "Drag panel" }));
    expect(useTerminal.getState().layout.every((item) => item.y === 2)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Resize panel" }));
    expect(useTerminal.getState().layout.every((item) => item.h === 8)).toBe(true);
    expect(JSON.parse(localStorage.getItem("openterminal-workspace")!).state.layout[0].h).toBe(8);
});
