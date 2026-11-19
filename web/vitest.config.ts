import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    oxc: { jsx: { runtime: "automatic" } },
    resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
    test: {
        projects: [
            { extends: true, test: { name: "contracts", environment: "node", include: ["lib/**/*.test.ts", "app/api/**/*.test.ts"] } },
            { extends: true, test: { name: "ui", environment: "jsdom", include: ["components/**/*.test.tsx"], setupFiles: ["./components/quant/test-setup.ts"] } },
        ],
    },
});
