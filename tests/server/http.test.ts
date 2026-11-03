import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth, checkPassword, hashPassword, parseUsers } from "../../src/server/auth";
import { createApp } from "../../src/server/app";
import { MockBackend } from "../../src/server/lore/MockBackend";
import { parseManaged } from "../../src/server/servers";

const H = { "content-type": "application/json", "x-lore-admin": "1" };

describe("auth helpers", () => {
  it("checks plain and scrypt passwords", () => {
    expect(checkPassword("pw", "pw")).toBe(true);
    expect(checkPassword("pw", "pW")).toBe(false);
    const h = hashPassword("s3cret");
    expect(checkPassword(h, "s3cret")).toBe(true);
    expect(checkPassword(h, "nope")).toBe(false);
  });
  it("parses LORE_ADMIN_USERS and LORE_ADMIN_PASSWORD", () => {
    const u = parseUsers("alice:a1, bob:scrypt$00$11", "root");
    expect([...u.keys()]).toEqual(["alice", "bob", "admin"]);
    expect(() => parseUsers("broken", undefined)).toThrow(/user:password/);
  });
  it("throttles repeated failures per client", () => {
    const a = new Auth(new Map([["admin", "pw"]]), true);
    for (let i = 0; i < 10; i++) expect(a.login("admin", "x", "1.2.3.4").ok).toBe(false);
    const r = a.login("admin", "pw", "1.2.3.4");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(429);
    expect(a.login("admin", "pw", "5.6.7.8").ok).toBe(true);
  });
  it("parses managed servers", () => {
    const s = parseManaged("Studio=lore://lore:41337|http://lore:41339/health_check, lore://other:1", "tok", "me");
    expect(s.map((x) => [x.name, x.url, x.healthUrl, x.token])).toEqual([
      ["Studio", "lore://lore:41337", "http://lore:41339/health_check", "tok"],
      ["other:1", "lore://other:1", null, "tok"],
    ]);
    expect(() => parseManaged("http://wrong", undefined, undefined)).toThrow(/cannot parse/);
  });
});

describe("HTTP server (mock backend)", () => {
  const dir = mkdtempSync(join(tmpdir(), "lore-admin-http-"));
  const web = join(dir, "web");
  let base = "";
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    mkdirSync(join(web, "assets"), { recursive: true });
    writeFileSync(join(web, "index.html"), "<!doctype html><title>t</title>");
    writeFileSync(join(dir, "secret.txt"), "top secret");
    app = await createApp({ mode: "server", dataDir: join(dir, "data"), mock: true, backend: new MockBackend(), auth: new Auth(new Map([["admin", "pw"]]), true), webRoot: web, env: { LORE_ADMIN_SERVERS: "Env=lore://env-server:41337" } });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function login(): Promise<string> {
    const r = await fetch(`${base}/api/login`, { method: "POST", headers: H, body: JSON.stringify({ user: "admin", password: "pw" }) });
    expect(r.status).toBe(200);
    const c = r.headers.get("set-cookie") ?? "";
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    return c.split(";")[0] as string;
  }
  const call = (cookie: string, ch: string, body?: unknown) => fetch(`${base}/api/call/${ch}`, { method: "POST", headers: { ...H, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("serves health and the SPA without auth, with security headers", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    const r = await fetch(`${base}/some/deep/link`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
    expect(await r.text()).toContain("<title>t</title>");
  });

  it("does not serve files outside the web root", async () => {
    const r = await fetch(`${base}/..%2fsecret.txt`);
    expect(await r.text()).not.toContain("top secret");
  });

  it("requires sign-in and the CSRF header", async () => {
    expect((await call("", "servers:list")).status).toBe(401);
    const cookie = await login();
    const noHeader = await fetch(`${base}/api/call/servers:list`, { method: "POST", headers: { cookie } });
    expect(noHeader.status).toBe(403);
    expect((await call(cookie, "servers:list")).status).toBe(200);
    const bad = await fetch(`${base}/api/login`, { method: "POST", headers: H, body: JSON.stringify({ user: "admin", password: "wrong" }) });
    expect(bad.status).toBe(401);
  });

  it("validates input and runs channels; secrets never leave the server", async () => {
    const cookie = await login();
    const bad = await call(cookie, "servers:add", { name: "", url: "http://x" });
    expect(bad.status).toBe(400);
    const add = await call(cookie, "servers:add", { name: "Studio", url: "lore://studio:41337", token: "very-secret-token" });
    const p = ((await add.json()) as { value: { id: string; hasToken: boolean } }).value;
    expect(p.hasToken).toBe(true);
    const list = await (await call(cookie, "servers:list")).text();
    expect(list).not.toContain("very-secret-token");
    expect(list).toContain("Env");
    const file = join(dir, "data", "servers.json");
    expect(readFileSync(file, "utf8")).toContain("very-secret-token");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);
    // Managed (env) servers are read-only.
    expect((await call(cookie, "servers:remove", { id: "env-0" })).status).toBe(422);

    const repos = (await (await call(cookie, "repos:list", { serverId: p.id })).json()) as { value: { name: string }[] };
    expect(repos.value.map((r) => r.name)).toContain("ShooterGame");
  });

  it("refuses repository delete without the typed confirmation, and audits mutations", async () => {
    const cookie = await login();
    const id = "env-0";
    const no = await call(cookie, "repos:delete", { serverId: id, repo: "EngineTools", confirm: "enginetools" });
    expect(no.status).toBe(422);
    expect((await call(cookie, "repos:delete", { serverId: id, repo: "EngineTools", confirm: "EngineTools" })).status).toBe(200);
    const audit = (await (await call(cookie, "audit:list", { limit: 50, mutatingOnly: true })).json()) as { value: { op: string; ok: boolean; actor: string; command: string }[] };
    expect(audit.value.slice(0, 2).map((e) => [e.op, e.ok, e.actor])).toEqual([
      ["repos:delete", true, "admin"],
      ["repos:delete", false, "admin"],
    ]);
    expect(audit.value[0]!.command).toBe("lore repository delete lore://env-server:41337/EngineTools");
    expect(readFileSync(join(dir, "data", "audit.jsonl"), "utf8").trim().split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("logs out", async () => {
    const cookie = await login();
    await fetch(`${base}/api/logout`, { method: "POST", headers: { ...H, cookie } });
    expect((await call(cookie, "servers:list")).status).toBe(401);
  });
});
