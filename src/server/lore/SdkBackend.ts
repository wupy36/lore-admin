// AdminBackend over the official JS SDK (@lore-vcs/sdk, koffi FFI over lore-capi).
//
// Server-scoped calls (repository list/info/create/delete, auth) need no local
// state. Repository-scoped calls (branches, history, locks) need a repository
// instance, so the console keeps one *bare* clone per repository under
// `<dataDir>/mirrors/<server>/<repositoryId>` (`lore clone --bare`: no files, only
// the latest revision tree). Calls on one mirror are serialized: Lore takes a
// repository lock per operation.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type * as Sdk from "@lore-vcs/sdk";
import type * as SdkEnums from "@lore-vcs/sdk/types/enums";
import type { LoreGlobalArgs } from "@lore-vcs/sdk/types/args";
import type { LoreEventFFI } from "@lore-vcs/sdk/types/events";
import type { Branch, BranchAction, Lock, Repo, Revision, RevisionDetail } from "@shared/types";
import { LoreError, type AdminBackend, type ServerConn } from "./AdminBackend";
import { isZeroHash, mapAction, metaValue, revisionFromMeta, tsOrNull, userOrNull } from "./mappers";

type Fluent = { callback(fn: (e: LoreEventFFI) => void): { waitAsync(): Promise<number> } };
type Head = { number: number; hash: string; parents: string[] };

/** Lore error 9 = "authentication requires a configured auth endpoint". */
const NO_AUTH = 9;
const LIST_TTL_MS = 15_000;

class KeyedQueue {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => this.tails.get(key) === tail && this.tails.delete(key));
    return next;
  }
}

export class SdkBackend implements AdminBackend {
  readonly kind = "sdk" as const;
  private queue = new KeyedQueue();
  private lists = new Map<string, { at: number; repos: { id: string; name: string }[] }>();
  private branchNames = new Map<string, Map<string, string>>();

  private constructor(
    private readonly sdk: typeof Sdk,
    private readonly enums: typeof SdkEnums,
    private readonly dataDir: string,
    readonly sdkVersion: string | null,
  ) {}

  /** Loads the native library lazily so `--mock` never touches it. */
  static async create(dataDir: string): Promise<SdkBackend> {
    const [sdk, enums] = await Promise.all([import("@lore-vcs/sdk"), import("@lore-vcs/sdk/types/enums")]);
    let version: string | null = null;
    try {
      const req = typeof require === "function" ? require : createRequire(import.meta.url);
      const pkgPath = join(dirname(req.resolve("@lore-vcs/sdk")), "..", "package.json");
      version = (JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string }).version ?? null;
    } catch {
      version = null;
    }
    return new SdkBackend(sdk, enums, dataDir, version);
  }

  // ---- plumbing ----

  private globals(s: ServerConn, repositoryPath?: string): LoreGlobalArgs {
    return {
      ...(repositoryPath ? { repositoryPath, workingDirectory: repositoryPath } : {}),
      // A token puts the call in external-credential mode, where `identity` must be empty.
      ...(s.token ? { identityToken: s.token } : s.identity ? { identity: s.identity } : {}),
    };
  }

  /** Run a fluent call. `onEvent` runs INSIDE the native callback: copy what you need. */
  private async run(call: Fluent, onEvent: (e: LoreEventFFI) => void = () => {}): Promise<void> {
    const { LoreEventTag } = this.enums;
    let failure: { code: number; message: string } | null = null;
    let rc: number;
    try {
      rc = await call
        .callback((e) => {
          if (e.tag === LoreEventTag.COMPLETE) {
            if (e.data.status !== 0) failure = { code: e.data.status, message: String(e.data.error?.message ?? "") };
            return;
          }
          onEvent(e);
        })
        .waitAsync();
    } catch (e) {
      // The SDK throws its own error ({ returnCode, errorDetail }) on a failed COMPLETE.
      const code = (e as { returnCode?: number }).returnCode ?? (failure as { code: number } | null)?.code;
      const msg = (failure as { message: string } | null)?.message || (e instanceof Error ? e.message.split("\n")[0] : String(e));
      throw new LoreError(msg ?? "Lore error", code);
    }
    const f = failure as { code: number; message: string } | null;
    if (f) throw new LoreError(f.message || `Lore error ${f.code}`, f.code);
    if (rc !== 0) throw new LoreError(`Lore call failed to start (code ${rc})`, rc);
  }

  private root = (s: ServerConn) => s.url.replace(/\/+$/, "");
  private serverKey = (s: ServerConn) => createHash("sha256").update(this.root(s)).digest("hex").slice(0, 12);

  private async listRaw(s: ServerConn, fresh = false): Promise<{ id: string; name: string }[]> {
    const key = this.root(s);
    const hit = this.lists.get(key);
    if (!fresh && hit && Date.now() - hit.at < LIST_TTL_MS) return hit.repos;
    const { LoreEventTag } = this.enums;
    const repos: { id: string; name: string }[] = [];
    await this.run(this.sdk.lore.repositoryList(this.globals(s), { url: key }), (e) => {
      if (e.tag === LoreEventTag.REPOSITORY_LIST_ENTRY) repos.push({ id: e.data.id.toString(), name: String(e.data.name) });
    });
    this.lists.set(key, { at: Date.now(), repos });
    return repos;
  }

  private async info(s: ServerConn, name: string, id?: string): Promise<Repo> {
    const { LoreEventTag } = this.enums;
    const url = `${this.root(s)}/${name}`;
    let repo: Repo | null = null;
    await this.run(this.sdk.lore.repositoryInfo(this.globals(s), { repositoryUrl: url }), (e) => {
      if (e.tag !== LoreEventTag.REPOSITORY_DATA) return;
      const d = e.data;
      repo = {
        id: d.id.toString(),
        name: String(d.name) || name,
        url,
        description: String(d.description ?? ""),
        creator: userOrNull(d.creator),
        created: tsOrNull(d.created),
        defaultBranch: String(d.defaultBranchName ?? "") || null,
      };
    });
    return (repo as Repo | null) ?? { id: id ?? "", name, url, description: "", creator: null, created: null, defaultBranch: null };
  }

  /** Bare clone of the repository, created on first use. */
  private async mirror(s: ServerConn, repo: string): Promise<string> {
    let entry = (await this.listRaw(s)).find((r) => r.name === repo);
    if (!entry) entry = (await this.listRaw(s, true)).find((r) => r.name === repo);
    if (!entry) throw new LoreError(`Repository not found on ${this.root(s)}: ${repo}`, 4);
    const path = join(this.dataDir, "mirrors", this.serverKey(s), entry.id);
    if (!existsSync(join(path, ".lore"))) {
      await rm(path, { recursive: true, force: true });
      await mkdir(path, { recursive: true });
      await this.run(this.sdk.lore.repositoryClone(this.globals(s, path), { repositoryUrl: `${this.root(s)}/${repo}`, bare: true }));
    }
    return path;
  }

  /** Serialized call on a repository's mirror. */
  private onRepo<T>(s: ServerConn, repo: string, fn: (path: string) => Promise<T>): Promise<T> {
    return this.queue.run(`${this.root(s)}/${repo}`, async () => fn(await this.mirror(s, repo)));
  }

  // ---- server ----

  async listRepositories(s: ServerConn): Promise<Repo[]> {
    const list = await this.listRaw(s, true);
    const out: Repo[] = [];
    for (let i = 0; i < list.length; i += 6) {
      const chunk = list.slice(i, i + 6);
      out.push(...(await Promise.all(chunk.map((r) => this.info(s, r.name, r.id).catch(() => ({ id: r.id, name: r.name, url: `${this.root(s)}/${r.name}`, description: "", creator: null, created: null, defaultBranch: null }))))));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async createRepository(s: ServerConn, name: string, description?: string): Promise<Repo> {
    // `repository create <url>` also creates a local instance; do it inside a throwaway dir.
    const tmp = join(this.dataDir, "tmp", `create-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmp, { recursive: true });
    try {
      await this.run(this.sdk.lore.repositoryCreate(this.globals(s, tmp), { repositoryUrl: `${this.root(s)}/${name}`, ...(description ? { description } : {}) }));
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
    this.lists.delete(this.root(s));
    return this.info(s, name);
  }

  async deleteRepository(s: ServerConn, repo: string): Promise<void> {
    const entry = (await this.listRaw(s, true)).find((r) => r.name === repo);
    await this.queue.run(`${this.root(s)}/${repo}`, () => this.run(this.sdk.lore.repositoryDelete(this.globals(s), { repositoryUrl: `${this.root(s)}/${repo}` })));
    this.lists.delete(this.root(s));
    if (entry) await rm(join(this.dataDir, "mirrors", this.serverKey(s), entry.id), { recursive: true, force: true }).catch(() => undefined);
  }

  async whoami(s: ServerConn): Promise<{ user: { id: string; name: string } | null; note: string | null }> {
    const { LoreEventTag } = this.enums;
    // `auth user info` resolves the server from a repository; any mirror will do, but a
    // server with no repositories has none, so answer from the token/identity alone then.
    const first = (await this.listRaw(s))[0];
    if (!first) return { user: null, note: s.token ? "Token configured (no repository yet to verify it against)." : null };
    try {
      let user: { id: string; name: string } | null = null;
      await this.onRepo(s, first.name, (path) =>
        this.run(this.sdk.lore.authUserInfo(this.globals(s, path), {}), (e) => {
          if (e.tag === LoreEventTag.AUTH_USER_INFO) user = { id: String(e.data.id), name: String(e.data.name) };
        }),
      );
      return { user, note: null };
    } catch (e) {
      if (e instanceof LoreError && e.code === NO_AUTH) return { user: null, note: `No authentication on this server: anyone who can reach it is an admin.${s.identity ? ` Changes are recorded as "${s.identity}".` : ""}` };
      return { user: null, note: `Not signed in: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` };
    }
  }

  // ---- branches ----

  private async branchesRaw(s: ServerConn, path: string): Promise<Branch[]> {
    const { LoreEventTag } = this.enums;
    const byId = new Map<string, Branch & { remote: boolean }>();
    await this.run(this.sdk.lore.branchList(this.globals(s, path), { archived: true }), (e) => {
      if (e.tag !== LoreEventTag.BRANCH_LIST_ENTRY) return;
      const d = e.data;
      const id = d.id.toString();
      const remote = Number(d.location) === 1;
      const latest = d.latest.toString();
      const prev = byId.get(id);
      // The remote's view wins: that is the server's state; the mirror may lag.
      if (prev && prev.remote && !remote) return;
      byId.set(id, {
        id,
        name: String(d.name),
        latestHash: isZeroHash(latest) ? null : latest,
        creator: userOrNull(d.creator) ?? prev?.creator ?? null,
        created: tsOrNull(d.created) ?? prev?.created ?? null,
        archived: !!d.archived || !!prev?.archived,
        isDefault: false,
        remote,
      });
    });
    this.branchNames.set(path, new Map([...byId.values()].map((b) => [b.id, b.name])));
    return [...byId.values()].map(({ remote: _r, ...b }) => b);
  }

  listBranches(s: ServerConn, repo: string): Promise<Branch[]> {
    return this.onRepo(s, repo, async (path) => {
      const [branches, info] = await Promise.all([this.branchesRaw(s, path), this.info(s, repo).catch(() => null)]);
      return branches.map((b) => ({ ...b, isDefault: !!info?.defaultBranch && b.name === info.defaultBranch })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
    });
  }

  createBranch(s: ServerConn, repo: string, name: string, from?: string): Promise<Branch> {
    return this.onRepo(s, repo, async (path) => {
      const l = this.sdk.lore;
      const g = this.globals(s, path);
      // `branch create` branches from the mirror's current revision and switches to it.
      const base = from ?? (await this.info(s, repo)).defaultBranch;
      if (base) await this.run(l.branchSwitch(g, { branch: base }));
      await this.run(l.branchCreate(g, { branch: name }));
      await this.run(l.branchPush(g, { branch: name }));
      const b = (await this.branchesRaw(s, path)).find((x) => x.name === name);
      if (!b) throw new LoreError(`Branch ${name} was created but is not listed`);
      return b;
    });
  }

  branchAction(s: ServerConn, repo: string, name: string, action: BranchAction): Promise<void> {
    return this.onRepo(s, repo, async (path) => {
      const l = this.sdk.lore;
      const g = this.globals(s, path);
      if (action === "protect") return this.run(l.branchProtect(g, { branch: name }));
      if (action === "unprotect") return this.run(l.branchUnprotect(g, { branch: name }));
      // Lore refuses to archive the branch an instance is on ("branch not found"), so move the mirror off it.
      const def = (await this.info(s, repo)).defaultBranch;
      if (!def || def === name) throw new LoreError("The default branch cannot be archived");
      await this.run(l.branchSwitch(g, { branch: def }));
      await this.run(l.branchArchive(g, { branch: name }));
    });
  }

  // ---- history ----

  private async names(s: ServerConn, path: string): Promise<Map<string, string>> {
    return this.branchNames.get(path) ?? (await this.branchesRaw(s, path).then(() => this.branchNames.get(path) ?? new Map<string, string>()));
  }

  history(s: ServerConn, repo: string, branch: string, length: number): Promise<Revision[]> {
    return this.onRepo(s, repo, async (path) => {
      const { LoreEventTag } = this.enums;
      const names = await this.names(s, path);
      const out: { head: Head; meta: Record<string, string> }[] = [];
      await this.run(this.sdk.lore.revisionHistory({ ...this.globals(s, path), remote: true }, { branch, length }), (e) => {
        if (e.tag === LoreEventTag.REVISION_HISTORY_ENTRY) {
          out.push({ head: { number: Number(e.data.revisionNumber), hash: e.data.revision.toString(), parents: e.data.parent.map((p) => p.toString()).filter((p) => !isZeroHash(p)) }, meta: {} });
        } else if (e.tag === LoreEventTag.METADATA && out.length) {
          (out[out.length - 1] as (typeof out)[number]).meta[String(e.data.key)] = metaValue(e.data.value);
        }
      });
      return out.map(({ head, meta }) => revisionFromMeta(head, meta, names));
    });
  }

  revisionDetail(s: ServerConn, repo: string, revision: string): Promise<RevisionDetail> {
    return this.onRepo(s, repo, async (path) => {
      const { LoreEventTag } = this.enums;
      const names = await this.names(s, path);
      let head: Head | null = null;
      const meta: Record<string, string> = {};
      const files: RevisionDetail["files"] = [];
      await this.run(this.sdk.lore.revisionInfo({ ...this.globals(s, path), remote: true }, { revision, metadata: true, delta: true }), (e) => {
        if (e.tag === LoreEventTag.REVISION_INFO) head = { number: Number(e.data.revisionNumber), hash: e.data.revision.toString(), parents: e.data.parent.map((p) => p.toString()).filter((p) => !isZeroHash(p)) };
        else if (e.tag === LoreEventTag.METADATA) meta[String(e.data.key)] = metaValue(e.data.value);
        else if (e.tag === LoreEventTag.REVISION_INFO_DELTA && e.data.flagFile) {
          const from = String(e.data.fromPath ?? "");
          files.push({ path: String(e.data.path), action: mapAction(e.data.action), size: Number(e.data.size), fromPath: from || null });
        }
      });
      const h = head as Head | null;
      if (!h) throw new LoreError(`Revision not found: ${revision}`);
      return { ...revisionFromMeta(h, meta, names), files, metadata: meta };
    });
  }

  // ---- locks ----

  listLocks(s: ServerConn, repo: string, f: { branch?: string; owner?: string; path?: string }): Promise<Lock[]> {
    return this.onRepo(s, repo, async (path) => {
      const { LoreEventTag } = this.enums;
      const branches = (await this.branchesRaw(s, path)).filter((b) => !b.archived);
      const names = this.branchNames.get(path) ?? new Map<string, string>();
      const targets = f.branch ? [f.branch] : branches.map((b) => b.name);
      const out: Lock[] = [];
      for (const branch of targets) {
        await this.run(this.sdk.lore.lockFileQuery(this.globals(s, path), { branch, ...(f.owner ? { owner: f.owner } : {}), ...(f.path ? { path: f.path } : {}) }), (e) => {
          if (e.tag !== LoreEventTag.LOCK_FILE_QUERY) return;
          const d = e.data;
          out.push({ path: String(d.path), owner: String(d.owner), branch: names.get(d.branch.toString()) ?? branch, lockedAt: tsOrNull(d.lockedAt) });
        });
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    });
  }

  releaseLocks(s: ServerConn, repo: string, branch: string, owner: string, paths: string[]): Promise<{ released: string[]; notFound: string[] }> {
    return this.onRepo(s, repo, async (path) => {
      const { LoreEventTag } = this.enums;
      const released: string[] = [];
      // `force`: release on behalf of another owner (P4: `p4 unlock -f`).
      await this.run(this.sdk.lore.lockFileRelease({ ...this.globals(s, path), force: true }, { paths, branch, owner, ownerId: owner }), (e) => {
        if (e.tag === LoreEventTag.LOCK_FILE_RELEASE) released.push(String(e.data.path));
      });
      // SDK 0.12 has no per-path "not found" event (newer lore-capi does): derive it.
      return { released, notFound: paths.filter((p) => !released.includes(p)) };
    });
  }

  async dispose(): Promise<void> {
    this.sdk.lore.shutdown();
  }
}
