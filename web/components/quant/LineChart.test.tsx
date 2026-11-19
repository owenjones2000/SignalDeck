import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import LineChart from "./LineChart";

afterEach(cleanup);

it("renders a visible circle for a single bar instead of a zero-length line", () => {
    render(<LineChart values={[12.5]} label="单日收盘价" />);
    const chart = screen.getByRole("img", { name: "单日收盘价" });
    const point = chart.querySelector("circle");
    expect(point).not.toBeNull();
    expect(Number(point!.getAttribute("r"))).toBeGreaterThan(0);
    expect(Number(point!.getAttribute("cx"))).toBeGreaterThan(0);
    expect(Number(point!.getAttribute("cx"))).toBeLessThan(600);
    expect(Number(point!.getAttribute("cy"))).toBeGreaterThan(0);
    expect(Number(point!.getAttribute("cy"))).toBeLessThan(160);
    expect(point!.getAttribute("fill")).toBe("var(--amber)");
    expect(chart.querySelector("polyline")).toBeNull();
    expect(screen.getByText("最低 12.50 / 最高 12.50")).toBeTruthy();
});

it("keeps multiple bars connected and empty data explicit", () => {
    const view = render(<LineChart values={[12.5, 13]} label="日线" />);
    const chart = screen.getByRole("img", { name: "日线" });
    expect(chart.querySelector("polyline")?.getAttribute("points")).toBe("24,135 576,25");
    expect(chart.querySelector("circle")).toBeNull();
    view.rerender(<LineChart values={[]} label="日线" />);
    expect(screen.getByText("暂无曲线数据")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
});
