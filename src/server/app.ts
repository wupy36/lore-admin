// Wires backend + stores + HTTP. Used by both entry points (server/main.ts and
// desktop/main.ts).
import { join } from "node:path";
import type { AppInfo } from "@shared/types";
import { AuditLog } from "./audit";
import { Auth } from "./auth";
import { createHandlers } from "./handlers";
import { createHttpServer } from "./http";
import type { AdminBackend } from "./lore/AdminBackend";
import { MockBackend } from "./lore/MockBackend";
import { ServerStore, parseManaged } from "./servers";

declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";

export interface AppOptions {
  mode: AppInfo["mode"];
  dataDir: string;
  mock: boolean;
  auth: Auth;
  webRoot: string | null;
  /** LORE_ADMIN_SERVERS etc. */
  env?: NodeJS.ProcessEnv;
  secureCookies?: boolean;
  trustProxy?: boolean;
  /** Inject a backend (tests). */
  backend?: AdminBackend;
}

export async function createApp(o: AppOptions) {
  const env = o.env ?? {};
  let backend = o.backend;
  if (!backend) {
    if (o.mock) backend = new MockBackend(150);
    else {
      const { SdkBackend } = await import("./lore/SdkBackend");
      backend = await SdkBackend.create(o.dataDir);
    }
  }
  const managed = parseManaged(env.LORE_ADMIN_SERVERS, env.LORE_ADMIN_SERVER_TOKEN, env.LORE_ADMIN_SERVER_IDENTITY);
  const servers = new ServerStore(join(o.dataDir, "servers.json"), managed);
  if (o.mock && !servers.list().length) servers.add({ name: "Demo studio", url: "lore://demo.example:41337", healthUrl: "", identity: "admin@studio" });
  const audit = new AuditLog(join(o.dataDir, "audit.jsonl"));
  const handlers = createHandlers({ backend, servers, audit, info: { mode: o.mode, backend: backend.kind, version: APP_VERSION, sdkVersion: backend.sdkVersion, authRequired: o.auth.required } });
  const http = createHttpServer({ handlers, audit, servers, auth: o.auth, webRoot: o.webRoot, secureCookies: !!o.secureCookies, trustProxy: !!o.trustProxy });
  return {
    http,
    backend,
    servers,
    audit,
    listen(port: number, host: string): Promise<number> {
      return new Promise((res, rej) => {
        http.once("error", rej);
        http.listen(port, host, () => {
          const a = http.address();
          res(typeof a === "object" && a ? a.port : port);
        });
      });
    },
    async close(): Promise<void> {
      await new Promise<void>((r) => http.close(() => r()));
      await backend.dispose();
    },
  };
}
