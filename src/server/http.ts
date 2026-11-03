// HTTP front end, shared by the Docker server and the desktop app:
//   GET  /healthz                 liveness (no auth)
//   GET  /api/session             { user, authRequired }
//   POST /api/login, /api/logout
//   POST /api/call/<channel>      JSON in/out (src/shared/api.ts)
//   GET  /api/events              server-sent events (console log)
//   GET  /*                       the web UI (SPA fallback to index.html)
// POSTs must carry `X-Lore-Admin: 1`: a custom header cannot be sent cross-site
// without a CORS preflight (never granted), which together with the
// SameSite=Strict cookie blocks CSRF.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { ServerEvent } from "@shared/api";
import { Auth, COOKIE, parseCookies, sessionCookie } from "./auth";
import type { AuditLog } from "./audit";
import { dispatch } from "./dispatch";
import type { Handlers } from "./handlers";
import type { ServerStore } from "./servers";

const MAX_BODY = 256 * 1024;
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export interface HttpOptions {
  handlers: Handlers;
  audit: AuditLog;
  servers: ServerStore;
  auth: Auth;
  /** Built web UI (out/web). Null serves the API only (tests, `vite` dev). */
  webRoot: string | null;
  /** Add `Secure` to cookies. Auto-on when the request arrived over TLS via a proxy (X-Forwarded-Proto). */
  secureCookies?: boolean;
  /** Trust X-Forwarded-For / -Proto (behind a reverse proxy). */
  trustProxy?: boolean;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  if (!size) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

export function createHttpServer(o: HttpOptions): Server {
  const clients = new Set<ServerResponse>();
  const broadcast = (ev: ServerEvent) => {
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const c of clients) c.write(line);
  };
  o.audit.subscribe((entry) => broadcast({ type: "log", entry }));

  const ipOf = (req: IncomingMessage) => (o.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() : "") || req.socket.remoteAddress || "?";
  const isSecure = (req: IncomingMessage) => !!o.secureCookies || (!!o.trustProxy && req.headers["x-forwarded-proto"] === "https");
  const webRoot = o.webRoot ? resolve(o.webRoot) : null;

  const server = createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      const status = (e as { status?: number }).status ?? 500;
      if (!res.headersSent) send(res, status, { ok: false, error: e instanceof Error ? e.message : String(e) });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const session = parseCookies(req.headers.cookie)[COOKIE];

    if (path === "/healthz") return send(res, 200, { ok: true });

    if (path.startsWith("/api/")) {
      if (req.method === "POST" && req.headers["x-lore-admin"] !== "1") return send(res, 403, { ok: false, error: "Missing X-Lore-Admin header" });

      if (path === "/api/session" && req.method === "GET") return send(res, 200, { user: o.auth.user(session), authRequired: o.auth.required });
      if (path === "/api/login" && req.method === "POST") {
        const body = (await readJson(req)) as { user?: unknown; password?: unknown } | undefined;
        const r = o.auth.login(String(body?.user ?? ""), String(body?.password ?? ""), ipOf(req));
        if (!r.ok) return send(res, r.status, { ok: false, error: r.error });
        return send(res, 200, { ok: true }, { "set-cookie": sessionCookie(r.session, isSecure(req)) });
      }
      if (path === "/api/logout" && req.method === "POST") {
        o.auth.logout(session);
        return send(res, 200, { ok: true }, { "set-cookie": sessionCookie("", isSecure(req), 0) });
      }

      const user = o.auth.user(session);
      if (!user) return send(res, 401, { ok: false, error: "Sign in required" });

      if (path === "/api/events" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
        res.write(": connected\n\n");
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      const m = /^\/api\/call\/([\w:-]+)$/.exec(path);
      if (m && req.method === "POST") {
        const r = await dispatch(o.handlers, o.audit, o.servers, m[1] as string, await readJson(req), user);
        if (r.ok && (m[1] === "servers:add" || m[1] === "servers:update" || m[1] === "servers:remove")) broadcast({ type: "servers:changed" });
        return send(res, r.ok ? 200 : (r.status ?? 422), r.ok ? r : { ok: false, error: r.error });
      }
      return send(res, 404, { ok: false, error: "Not found" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { ok: false, error: "Method not allowed" });
    if (!webRoot) return send(res, 404, { ok: false, error: "Web UI not built (run pnpm build)" });
    let file = normalize(join(webRoot, decodeURIComponent(path)));
    if (file !== webRoot && !file.startsWith(webRoot + sep)) return send(res, 400, { ok: false, error: "Bad path" });
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(webRoot, "index.html");
    const ext = extname(file);
    res.writeHead(200, {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      // Vite emits content-hashed assets; index.html must always be revalidated.
      "cache-control": file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
      ...(ext === ".html" ? { "content-security-policy": CSP } : {}),
    });
    if (req.method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  }

  server.on("close", () => {
    for (const c of clients) c.end();
  });
  return server;
}
