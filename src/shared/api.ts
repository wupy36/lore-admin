// HTTP API contract. Every channel is `POST /api/call/<channel>` with a JSON
// body; the server validates input AND output against these schemas.
import { z } from "zod";
import { AppInfo, AuditEntry, Branch, BranchAction, Lock, Repo, Revision, RevisionDetail, ServerInput, ServerProfile, ServerStatus } from "./types";

const Ok = z.object({ ok: z.literal(true) });
const OnServer = z.object({ serverId: z.string().min(1) });
const OnRepo = OnServer.extend({ repo: z.string().min(1) });
/** Repository names: one URL path segment (no spaces, slashes, @ or ~). */
const RepoName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\s/\\@~]+$/, "No spaces, slashes, @ or ~");
/** Branch names may be hierarchical (`feature/weapons`); `@`/`~` would clash with revision identifiers. */
const BranchName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\s\\@~/]+(\/[^\s\\@~/]+)*$/, "No spaces, @ or ~; slashes only between name parts");

/** Channels that change a server. Logged to the persistent audit log. */
export const MUTATING = new Set<Channel>(["repos:create", "repos:delete", "branches:create", "branches:action", "locks:release"]);

export const contract = {
  "app:info": { input: z.void(), output: AppInfo },

  "servers:list": { input: z.void(), output: z.array(ServerProfile) },
  "servers:add": { input: ServerInput, output: ServerProfile },
  "servers:update": { input: ServerInput.extend({ id: z.string() }), output: ServerProfile },
  "servers:remove": { input: z.object({ id: z.string() }), output: Ok },
  "servers:status": { input: OnServer, output: ServerStatus },

  "repos:list": { input: OnServer, output: z.array(Repo) },
  "repos:create": { input: OnServer.extend({ name: RepoName, description: z.string().max(2000).optional() }), output: Repo },
  /** `confirm` must repeat the repository name (typed confirmation in the UI). */
  "repos:delete": { input: OnRepo.extend({ confirm: z.string() }), output: Ok },

  "branches:list": { input: OnRepo, output: z.array(Branch) },
  "branches:create": { input: OnRepo.extend({ name: BranchName, from: z.string().optional() }), output: Branch },
  "branches:action": { input: OnRepo.extend({ name: z.string().min(1), action: BranchAction }), output: Ok },

  "history:list": { input: OnRepo.extend({ branch: z.string().min(1), length: z.number().int().positive().max(2000) }), output: z.array(Revision) },
  "history:detail": { input: OnRepo.extend({ revision: z.string().min(1) }), output: RevisionDetail },

  /** All locks on one branch, or on every branch when `branch` is omitted. */
  "locks:list": { input: OnRepo.extend({ branch: z.string().optional(), owner: z.string().optional(), path: z.string().optional() }), output: z.array(Lock) },
  "locks:release": { input: OnRepo.extend({ branch: z.string().min(1), owner: z.string().min(1), paths: z.array(z.string().min(1)).min(1) }), output: z.object({ released: z.array(z.string()), notFound: z.array(z.string()) }) },

  "audit:list": { input: z.object({ limit: z.number().int().positive().max(5000).default(500), mutatingOnly: z.boolean().optional() }), output: z.array(AuditEntry) },
} as const;

export type Contract = typeof contract;
export type Channel = keyof Contract;
export type Input<C extends Channel> = z.input<Contract[C]["input"]>;
/** Input after zod parsing (defaults applied): what handlers receive. */
export type ParsedInput<C extends Channel> = z.output<Contract[C]["input"]>;
export type Output<C extends Channel> = z.output<Contract[C]["output"]>;
export type ApiResponse<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

/** Server-sent events on `GET /api/events`. */
export type ServerEvent = { type: "log"; entry: AuditEntry } | { type: "servers:changed" };
