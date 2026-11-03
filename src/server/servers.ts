// Server profiles (P4: connections). Persisted to <dataDir>/servers.json with
// mode 0600 because it may hold tokens. Profiles from LORE_ADMIN_SERVERS are
// "managed": always present, read-only in the UI.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { ServerInput, ServerProfile } from "@shared/types";
import { LoreError, type ServerConn } from "./lore/AdminBackend";

const Stored = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  healthUrl: z.string().nullable().default(null),
  identity: z.string().nullable().default(null),
  token: z.string().nullable().default(null),
});
type Stored = z.infer<typeof Stored>;
const File = z.object({ version: z.literal(1), servers: z.array(Stored) });

/** `Name=lore://host:port[|http://host:41339/health_check]`, comma or newline separated. */
export function parseManaged(spec: string | undefined, token: string | undefined, identity: string | undefined): Stored[] {
  if (!spec?.trim()) return [];
  return spec
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const m = /^(?:([^=]+)=)?(lore:\/\/[^|\s]+)(?:\|(https?:\/\/\S+))?$/.exec(entry);
      if (!m) throw new Error(`LORE_ADMIN_SERVERS: cannot parse "${entry}" (expected Name=lore://host:port[|http://host:41339/health_check])`);
      const url = (m[2] as string).replace(/\/+$/, "");
      return { id: `env-${i}`, name: m[1]?.trim() || url.replace(/^lore:\/\//, ""), url, healthUrl: m[3] ?? null, identity: identity?.trim() || null, token: token?.trim() || null };
    });
}

export class ServerStore {
  private servers: Stored[] = [];

  constructor(
    private readonly file: string | null,
    private readonly managed: Stored[] = [],
  ) {
    if (file && existsSync(file)) {
      try {
        this.servers = File.parse(JSON.parse(readFileSync(file, "utf8"))).servers;
      } catch (e) {
        // Keep the broken file for inspection instead of silently dropping profiles.
        renameSync(file, `${file}.invalid-${Date.now()}`);
        console.error(`servers.json was invalid and has been moved aside: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, servers: this.servers }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  private all(): { s: Stored; managed: boolean }[] {
    return [...this.managed.map((s) => ({ s, managed: true })), ...this.servers.map((s) => ({ s, managed: false }))];
  }

  private static toProfile(s: Stored, managed: boolean): ServerProfile {
    return { id: s.id, name: s.name, url: s.url, healthUrl: s.healthUrl, identity: s.identity, hasToken: !!s.token, managed };
  }

  list(): ServerProfile[] {
    return this.all().map(({ s, managed }) => ServerStore.toProfile(s, managed));
  }

  get(id: string): ServerProfile {
    const hit = this.all().find((x) => x.s.id === id);
    if (!hit) throw new LoreError(`Unknown server: ${id}`);
    return ServerStore.toProfile(hit.s, hit.managed);
  }

  conn(id: string): ServerConn {
    const hit = this.all().find((x) => x.s.id === id);
    if (!hit) throw new LoreError(`Unknown server: ${id}`);
    return { id, url: hit.s.url, identity: hit.s.identity, token: hit.s.token };
  }

  add(i: ServerInput): ServerProfile {
    const url = i.url.replace(/\/+$/, "");
    if (this.all().some((x) => x.s.url === url)) throw new LoreError(`A server with URL ${url} already exists`);
    const s: Stored = { id: randomUUID(), name: i.name, url, healthUrl: i.healthUrl || null, identity: i.identity || null, token: i.token || null };
    this.servers.push(s);
    this.save();
    return ServerStore.toProfile(s, false);
  }

  update(id: string, i: ServerInput): ServerProfile {
    if (this.managed.some((s) => s.id === id)) throw new LoreError("This server is defined by LORE_ADMIN_SERVERS and cannot be edited here");
    const s = this.servers.find((x) => x.id === id);
    if (!s) throw new LoreError(`Unknown server: ${id}`);
    Object.assign(s, { name: i.name, url: i.url.replace(/\/+$/, ""), healthUrl: i.healthUrl || null, identity: i.identity || null, token: i.token === undefined ? s.token : i.token || null });
    this.save();
    return ServerStore.toProfile(s, false);
  }

  remove(id: string): void {
    if (this.managed.some((s) => s.id === id)) throw new LoreError("This server is defined by LORE_ADMIN_SERVERS and cannot be removed here");
    const before = this.servers.length;
    this.servers = this.servers.filter((s) => s.id !== id);
    if (this.servers.length === before) throw new LoreError(`Unknown server: ${id}`);
    this.save();
  }
}
