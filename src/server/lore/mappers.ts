// SDK event payload -> DTO. Must be called INSIDE the SDK callback: event data
// is native memory freed when the callback returns, so every field is copied.
// Shared with lore-desktop (src/main/lore/mappers.ts).
import { LoreFileAction } from "@lore-vcs/sdk/types/enums";
import type { FileAction, Revision } from "@shared/types";

export function mapAction(a: LoreFileAction): FileAction {
  switch (a) {
    case LoreFileAction.ADD:
      return "add";
    case LoreFileAction.DELETE:
      return "delete";
    case LoreFileAction.MOVE:
      return "move";
    case LoreFileAction.COPY:
      return "copy";
    default:
      return "modify";
  }
}

export const isZeroHash = (h: string): boolean => /^0*$/.test(h);

/** METADATA values are tagged unions ({ tag, tagName, data }); render any of them as text. */
export function metaValue(v: unknown): string {
  const d = (v as { data?: unknown } | null)?.data ?? v;
  if (d === null || d === undefined) return "";
  if (typeof d === "object" && typeof (d as { toString?: unknown }).toString === "function") {
    const s = String(d);
    if (s !== "[object Object]") return s;
    return JSON.stringify(d);
  }
  return String(d);
}

/** Lore reports `<unknown>` for unset users. */
export const userOrNull = (s: unknown): string | null => {
  const v = String(s ?? "").trim();
  return v && v !== "<unknown>" ? v : null;
};

/** Lore timestamps are ms since epoch; 0 = unset. */
export const tsOrNull = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** Revision from a history/info header + its METADATA (`message`, `timestamp`, `branch`, `committed-by`, `created-by`). */
export function revisionFromMeta(head: { number: number; hash: string; parents: string[] }, meta: Record<string, string>, branchNames: ReadonlyMap<string, string>): Revision {
  const ts = Number(meta.timestamp);
  return {
    number: head.number,
    hash: head.hash,
    parents: head.parents,
    branch: (meta.branch && branchNames.get(meta.branch)) || meta.branch || "",
    author: meta["committed-by"] || meta["created-by"] || null,
    timestamp: Number.isFinite(ts) ? ts : 0,
    message: meta.message ?? "",
  };
}
