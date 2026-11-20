export class QuantRequestError extends Error {
    constructor(public readonly status: number, public readonly detail: string) {
        const prefix = status === 401 || status === 403 ? "鉴权失败" : "请求失败";
        super(`${prefix}（HTTP ${status}）：${detail}`);
    }
}

export async function quantRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`/api/quant${path}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const detail = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
        throw new QuantRequestError(response.status, detail);
    }
    if (response.status === 204) return undefined as T;
    return response.json();
}

export function parseCodes(input: string): string[] {
    const codes = [...new Set(input.trim().split(/[\s,，;；]+/).filter(Boolean))];
    if (codes.length < 1 || codes.length > 100) throw new Error("请输入 1–100 个代码");
    if (codes.some((code) => !/^(?:[03468][0-9]{5}|92[0-9]{4})$/.test(code))) {
        throw new Error("请输入六位 A 股代码，保留前导零");
    }
    return codes;
}
