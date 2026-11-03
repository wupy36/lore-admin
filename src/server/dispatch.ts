// Validate input → call handler → validate output → audit. Pure (no HTTP).
import { contract, MUTATING, type ApiResponse, type Channel, type Input } from "@shared/api";
import { commandFor } from "@shared/commands";
import type { AuditLog } from "./audit";
import type { Handlers } from "./handlers";
import type { ServerStore } from "./servers";

/** Channels that touch a Lore server and so belong in the console/audit log. */
const LOGGED = (c: Channel) => c.startsWith("repos:") || c.startsWith("branches:") || c.startsWith("history:") || c.startsWith("locks:") || c === "servers:status";

function summarize(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} item(s)`;
  if (v && typeof v === "object" && "released" in v) {
    const r = v as { released: string[]; notFound: string[] };
    return `${r.released.length} released${r.notFound.length ? `, ${r.notFound.length} not found` : ""}`;
  }
  if (v && typeof v === "object" && "reachable" in v) return (v as { reachable: boolean }).reachable ? "reachable" : `unreachable: ${(v as { error?: string }).error ?? ""}`;
  return "ok";
}

export async function dispatch(handlers: Handlers, audit: AuditLog, servers: ServerStore, channel: string, raw: unknown, actor: string): Promise<ApiResponse<unknown>> {
  if (!Object.hasOwn(contract, channel)) return { ok: false, error: `Unknown channel: ${channel}`, status: 404 };
  const c = channel as Channel;
  const spec = contract[c];
  const parsed = spec.input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `Invalid input for ${c}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`, status: 400 };

  const input = parsed.data as Input<Channel>;
  const serverId = input && typeof input === "object" && "serverId" in input ? String(input.serverId) : null;
  let serverUrl: string | null = null;
  try {
    serverUrl = serverId ? servers.get(serverId).url : null;
  } catch {
    serverUrl = null;
  }
  const started = performance.now();
  const log = (ok: boolean, message: string) =>
    LOGGED(c) &&
    audit.record({ ts: Date.now(), actor, server: serverUrl, op: c, command: commandFor(c, input as never, serverUrl), mutating: MUTATING.has(c), ok, message, durationMs: Math.round(performance.now() - started) });

  try {
    const value = await (handlers[c] as (i: unknown, a: string) => Promise<unknown>)(input, actor);
    const out = spec.output.safeParse(value);
    if (!out.success) {
      log(false, `invalid output: ${out.error.message}`);
      return { ok: false, error: `Invalid output from ${c}: ${out.error.message}`, status: 500 };
    }
    log(true, summarize(out.data));
    return { ok: true, value: out.data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(false, message);
    return { ok: false, error: message, status: 422 };
  }
}
