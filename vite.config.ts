import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as { version: string };

// Web UI. `pnpm dev:web` proxies the API to `pnpm dev:server` (port 4800).
export default defineConfig({
  root: resolve(__dirname, "src/web"),
  base: "./",
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  build: { outDir: resolve(__dirname, "out/web"), emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:4800" } },
});
