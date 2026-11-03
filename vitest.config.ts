import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/integration/**", "node_modules/**"],
    environmentMatchGlobs: [["tests/web/**", "jsdom"]],
    environment: "node",
  },
});
