import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
    test: { include: ["lib/vela/**/*.test.ts", "app/api/vela/**/*.test.ts"] },
});
