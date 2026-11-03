// Channel implementations. Pure (no HTTP): unit-tested with MockBackend.
import type { Channel, Output, ParsedInput } from "@shared/api";
import type { AppInfo, ServerStatus } from "@shared/types";
import type { AuditLog } from "./audit";
import { LoreError, type AdminBackend } from "./lore/AdminBackend";
import type { ServerStore } from "./servers";

export type Handlers = { [C in Channel]: (input: ParsedInput<C>, actor: string) => Promise<Output<C>> };

export interface HandlerDeps {
  backend: AdminBackend;
  servers: ServerStore;
  audit: AuditLog;
  info: Omit<AppInfo, "user">;
  /** Fetch for health checks (injectable for tests). */
  fetchImpl?: typeof fetch;
  onServersChanged?: () => void;
}

async function checkHealth(url: string | null, f: typeof fetch): Promise<Pick<ServerStatus, "health" | "healthDetail">> {
  if (!url) return { health: "unknown", healthDetail: "No health URL configured" };
  try {
    const res = await f(url, { signal: AbortSignal.timeout(4000) });
    return res.ok ? { health: "ok", healthDetail: `HTTP ${res.status}` } : { health: "unavailable", healthDetail: `HTTP ${res.status}${res.status === 503 ? " (store unavailable)" : ""}` };
  } catch (e) {
    return { health: "unavailable", healthDetail: e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e) };
  }
}

export function createHandlers(d: HandlerDeps): Handlers {
  const { backend: b, servers } = d;
  const f = d.fetchImpl ?? fetch;
  const changed = () => d.onServersChanged?.();

  return {
    "app:info": async (_i, actor) => ({ ...d.info, user: actor }),

    "servers:list": async () => servers.list(),
    "servers:add": async (i) => {
      const p = servers.add(i);
      changed();
      return p;
    },
    "servers:update": async ({ id, ...i }) => {
      const p = servers.update(id, i);
      changed();
      return p;
    },
    "servers:remove": async ({ id }) => {
      servers.remove(id);
      changed();
      return { ok: true };
    },
    "servers:status": async ({ serverId }) => {
      const profile = servers.get(serverId);
      const conn = servers.conn(serverId);
      const started = performance.now();
      const health = checkHealth(profile.healthUrl, f);
      try {
        const repos = await b.listRepositories(conn);
        const latencyMs = Math.round(performance.now() - started);
        const who = await b.whoami(conn).catch((e: unknown) => ({ user: null, note: e instanceof Error ? e.message : String(e) }));
        return { serverId, checkedAt: Date.now(), reachable: true, latencyMs, repositoryCount: repos.length, ...(await health), user: who.user, authNote: who.note, error: null };
      } catch (e) {
        return { serverId, checkedAt: Date.now(), reachable: false, latencyMs: null, repositoryCount: null, ...(await health), user: null, authNote: null, error: e instanceof Error ? e.message : String(e) };
      }
    },

    "repos:list": async ({ serverId }) => b.listRepositories(servers.conn(serverId)),
    "repos:create": async ({ serverId, name, description }) => b.createRepository(servers.conn(serverId), name, description),
    "repos:delete": async ({ serverId, repo, confirm }) => {
      if (confirm !== repo) throw new LoreError("Type the repository name to confirm deletion");
      await b.deleteRepository(servers.conn(serverId), repo);
      return { ok: true };
    },

    "branches:list": async ({ serverId, repo }) => b.listBranches(servers.conn(serverId), repo),
    "branches:create": async ({ serverId, repo, name, from }) => b.createBranch(servers.conn(serverId), repo, name, from),
    "branches:action": async ({ serverId, repo, name, action }) => {
      await b.branchAction(servers.conn(serverId), repo, name, action);
      return { ok: true };
    },

    "history:list": async ({ serverId, repo, branch, length }) => b.history(servers.conn(serverId), repo, branch, length),
    "history:detail": async ({ serverId, repo, revision }) => b.revisionDetail(servers.conn(serverId), repo, revision),

    "locks:list": async ({ serverId, repo, ...filter }) => b.listLocks(servers.conn(serverId), repo, filter),
    "locks:release": async ({ serverId, repo, branch, owner, paths }) => b.releaseLocks(servers.conn(serverId), repo, branch, owner, paths),

    "audit:list": async ({ limit, mutatingOnly }) => d.audit.list(limit ?? 500, mutatingOnly),
  };
}
