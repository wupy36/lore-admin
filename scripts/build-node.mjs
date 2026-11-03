// Bundles the Node entry points (server + Electron main) to CommonJS with
// esbuild. The Lore SDK (native, koffi) and electron stay external.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: ["@lore-vcs/sdk", "@lore-vcs/sdk/*", "electron"],
  alias: { "@shared": "./src/shared" },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/server/main.ts"], outfile: "out/server/main.cjs" });
await build({ ...common, entryPoints: ["src/desktop/main.ts"], outfile: "out/desktop/main.cjs" });
