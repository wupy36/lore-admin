// Every Lore call made through the console: streamed live to connected UIs and,
// for calls that change a server, appended to <dataDir>/audit.jsonl (P4: the
// server log / journal, from the console's side).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { AuditEntry } from "@shared/types";

const RING = 2000;
type Listener = (e: AuditEntry) => void;

export class AuditLog {
  private ring: AuditEntry[] = [];
  private listeners = new Set<Listener>();
  private seq = 0;

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      // Persisted entries are mutating only; load the tail so the UI shows recent history after a restart.
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-RING);
      for (const l of lines) {
        const r = AuditEntry.safeParse(safeJson(l));
        if (r.success) this.ring.push(r.data);
      }
    }
  }

  record(e: Omit<AuditEntry, "id">): AuditEntry {
    const entry: AuditEntry = { ...e, id: `${e.ts.toString(36)}-${(++this.seq).toString(36)}` };
    this.ring.push(entry);
    if (this.ring.length > RING) this.ring.splice(0, this.ring.length - RING);
    if (entry.mutating && this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      } catch (err) {
        console.error(`audit log write failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const l of this.listeners) l(entry);
    return entry;
  }

  list(limit: number, mutatingOnly = false): AuditEntry[] {
    const src = mutatingOnly ? this.ring.filter((e) => e.mutating) : this.ring;
    return src.slice(-limit).reverse();
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
