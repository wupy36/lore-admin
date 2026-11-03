import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests against a real Lore server: LORE_IT_REMOTE=lore://127.0.0.1:41337 pnpm test:it
export default defineConfig({
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  test: { include: ["tests/integration/**/*.it.test.ts"], environment: "node", testTimeout: 60_000, hookTimeout: 120_000, fileParallelism: false },
});
