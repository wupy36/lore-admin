// Lore-free DTOs shared by the server and the web UI. Validated with zod at the
// HTTP boundary in both directions (src/server/dispatch.ts).
import { z } from "zod";

/** A Lore server the console manages (P4: a P4PORT connection). Secrets never leave the server. */
export const ServerProfile = z.object({
  id: z.string(),
  name: z.string(),
  /** `lore://host:port` (QUIC/gRPC endpoint). */
  url: z.string(),
  /** HTTP health endpoint, e.g. `http://host:41339/health_check`. Optional. */
  healthUrl: z.string().nullable(),
  /** Identity recorded on changes made through the console (unauthenticated servers). */
  identity: z.string().nullable(),
  /** An identity/access token is stored for this server (never returned). */
  hasToken: z.boolean(),
  /** Defined by environment (LORE_ADMIN_SERVERS); cannot be edited or removed in the UI. */
  managed: z.boolean(),
});
export type ServerProfile = z.infer<typeof ServerProfile>;

const loreUrl = z
  .string()
  .trim()
  .regex(/^lore:\/\/[^\s/]+(:\d+)?\/?$/, "Expected lore://host:port");
const httpUrl = z
  .string()
  .trim()
  .regex(/^https?:\/\/\S+$/, "Expected http(s)://…");

export const ServerInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: loreUrl,
  healthUrl: z.union([httpUrl, z.literal("")]).optional(),
  identity: z.string().trim().max(200).optional(),
  /** Empty string clears a stored token; undefined keeps it. */
  token: z.string().max(8192).optional(),
});
export type ServerInput = z.infer<typeof ServerInput>;

export const ServerStatus = z.object({
  serverId: z.string(),
  checkedAt: z.number(),
  reachable: z.boolean(),
  /** Round trip of `repository list`, ms. */
  latencyMs: z.number().nullable(),
  repositoryCount: z.number().nullable(),
  health: z.enum(["ok", "unavailable", "unknown"]),
  healthDetail: z.string().nullable(),
  /** Who the console acts as on this server. */
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
  authNote: z.string().nullable(),
  error: z.string().nullable(),
});
export type ServerStatus = z.infer<typeof ServerStatus>;

/** P4: depot. */
export const Repo = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  description: z.string(),
  creator: z.string().nullable(),
  created: z.number().nullable(),
  defaultBranch: z.string().nullable(),
});
export type Repo = z.infer<typeof Repo>;

/** P4: stream. Lore branches are flat named pointers. */
export const Branch = z.object({
  id: z.string(),
  name: z.string(),
  latestHash: z.string().nullable(),
  creator: z.string().nullable(),
  created: z.number().nullable(),
  archived: z.boolean(),
  isDefault: z.boolean(),
});
export type Branch = z.infer<typeof Branch>;

export const BranchAction = z.enum(["protect", "unprotect", "archive"]);
export type BranchAction = z.infer<typeof BranchAction>;

/** P4: submitted changelist. */
export const Revision = z.object({
  number: z.number(),
  hash: z.string(),
  parents: z.array(z.string()),
  branch: z.string(),
  author: z.string().nullable(),
  timestamp: z.number(),
  message: z.string(),
});
export type Revision = z.infer<typeof Revision>;

export const FileAction = z.enum(["add", "modify", "delete", "move", "copy", "none"]);
export type FileAction = z.infer<typeof FileAction>;

/** P4: `p4 describe`. */
export const RevisionDetail = Revision.extend({
  files: z.array(z.object({ path: z.string(), action: FileAction, size: z.number(), fromPath: z.string().nullable() })),
  metadata: z.record(z.string()),
});
export type RevisionDetail = z.infer<typeof RevisionDetail>;

/** P4: `p4 opened -a` / exclusive locks. Lore locks are advisory. */
export const Lock = z.object({
  path: z.string(),
  owner: z.string(),
  branch: z.string(),
  lockedAt: z.number().nullable(),
});
export type Lock = z.infer<typeof Lock>;

/** One Lore call made by the console: live console and persistent audit log. */
export const AuditEntry = z.object({
  id: z.string(),
  ts: z.number(),
  /** Console user who triggered it. */
  actor: z.string(),
  server: z.string().nullable(),
  op: z.string(),
  /** Equivalent `lore …` command line, when one exists. */
  command: z.string().nullable(),
  /** Changed something on a server (create/delete/protect/release…). */
  mutating: z.boolean(),
  ok: z.boolean(),
  message: z.string(),
  durationMs: z.number(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AppInfo = z.object({
  mode: z.enum(["desktop", "server"]),
  backend: z.enum(["sdk", "mock"]),
  version: z.string(),
  sdkVersion: z.string().nullable(),
  authRequired: z.boolean(),
  user: z.string().nullable(),
});
export type AppInfo = z.infer<typeof AppInfo>;

export const shortHash = (h: string | null | undefined): string => (h ? h.slice(0, 10) : "");
