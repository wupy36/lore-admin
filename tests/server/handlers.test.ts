import { describe, expect, it } from "vitest";
import { contract } from "../../src/shared/api";
import { commandFor } from "../../src/shared/commands";
import { AuditLog } from "../../src/server/audit";
import { dispatch } from "../../src/server/dispatch";
import { createHandlers } from "../../src/server/handlers";
import { MockBackend } from "../../src/server/lore/MockBackend";
import { ServerStore } from "../../src/server/servers";

function setup(fetchImpl?: typeof fetch) {
  const servers = new ServerStore(null);
  const audit = new AuditLog(null);
  const p = servers.add({ name: "S", url: "lore://s:41337", healthUrl: "http://s:41339/health_check", identity: "me" });
  const handlers = createHandlers({ backend: new MockBackend(), servers, audit, info: { mode: "server", backend: "mock", version: "t", sdkVersion: null, authRequired: true }, ...(fetchImpl ? { fetchImpl } : {}) });
  const d = (ch: string, input?: unknown) => dispatch(handlers, audit, servers, ch, input, "tester");
  return { servers, audit, handlers, d, id: p.id };
}

describe("handlers + dispatch", () => {
  it("covers every contract channel", () => {
    const { handlers } = setup();
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(contract).sort());
  });

  it("reports server status incl. health check", async () => {
    const ok = setup((async () => new Response("", { status: 200 })) as typeof fetch);
    const r = await ok.d("servers:status", { serverId: ok.id });
    expect(r.ok && r.value).toMatchObject({ reachable: true, repositoryCount: 3, health: "ok" });
    const down = setup((async () => new Response("", { status: 503 })) as typeof fetch);
    const r2 = await down.d("servers:status", { serverId: down.id });
    expect(r2.ok && r2.value).toMatchObject({ health: "unavailable", healthDetail: "HTTP 503 (store unavailable)" });
  });

  it("reports unreachable servers as data, not errors", async () => {
    const t = setup();
    const p = t.servers.add({ name: "X", url: "lore://unreachable:1" });
    const r = await t.d("servers:status", { serverId: p.id });
    expect(r.ok && r.value).toMatchObject({ reachable: false, error: expect.stringMatching(/connect/) });
  });

  it("branch lifecycle and locks", async () => {
    const { d, id } = setup();
    const base = { serverId: id, repo: "ShooterGame" };
    const b = await d("branches:create", { ...base, name: "feature/new", from: "main" });
    expect(b.ok).toBe(true);
    expect((await d("branches:create", { ...base, name: "has space" })).ok).toBe(false);
    expect((await d("branches:action", { ...base, name: "main", action: "archive" })).ok).toBe(false);
    expect((await d("branches:action", { ...base, name: "feature/new", action: "archive" })).ok).toBe(true);
    const locks = await d("locks:list", { ...base, owner: "dee@studio" });
    expect(locks.ok && locks.value).toHaveLength(1);
    const rel = await d("locks:release", { ...base, branch: "main", owner: "dee@studio", paths: ["Content/Maps/Level_02.umap", "nope"] });
    expect(rel.ok && rel.value).toEqual({ released: ["Content/Maps/Level_02.umap"], notFound: ["nope"] });
  });

  it("records every Lore call with actor and CLI equivalent; only mutations are persistent-only", async () => {
    const { d, audit, id } = setup();
    await d("repos:list", { serverId: id });
    await d("repos:create", { serverId: id, name: "NewRepo", description: "d" });
    const all = audit.list(10);
    expect(all.map((e) => e.op)).toEqual(["repos:create", "repos:list"]);
    expect(all[0]).toMatchObject({ actor: "tester", mutating: true, ok: true, command: 'lore repository create --description d lore://s:41337/NewRepo' });
    expect(audit.list(10, true).map((e) => e.op)).toEqual(["repos:create"]);
  });

  it("builds CLI commands for repo-scoped ops", () => {
    expect(commandFor("locks:release", { serverId: "x", repo: "Game", branch: "main", owner: "ana", paths: ["a b.uasset"] }, "lore://h:1")).toBe('lore --repository "<mirror:Game>" lock release --branch main --owner ana "a b.uasset"');
    expect(commandFor("servers:list", undefined, "lore://h:1")).toBeNull();
  });
});
