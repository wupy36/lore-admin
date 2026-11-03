// In-memory Lore for demo mode (`--mock`) and tests. Deterministic data.
import type { Branch, BranchAction, Lock, Repo, Revision, RevisionDetail } from "@shared/types";
import { LoreError, type AdminBackend, type ServerConn } from "./AdminBackend";

interface MockRepo {
  repo: Repo;
  branches: (Branch & { protected: boolean })[];
  revisions: Map<string, Revision[]>;
  locks: Lock[];
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);
const AUTHORS = ["ana@studio", "ben@studio", "chen@studio", "dee@studio"];
const MESSAGES = ["Tune sprint FOV and head bob", "Add weapon sway curves", "Fix LOD popping on rocks", "Bake lighting for Level_02", "Refactor inventory component", "Update footstep audio cues", "Rebuild nav mesh", "Add ADS transition blend"];
const FILES = ["Source/Game/Player/FPCharacter.cpp", "Source/Game/Weapons/WeaponBase.h", "Content/Maps/Level_02.umap", "Content/Characters/Hero/Hero.uasset", "Config/DefaultGame.ini"];

let seq = 0;
const hex = (n: number, len = 64) => {
  let s = "";
  let x = n * 2654435761 + 12345;
  while (s.length < len) {
    x = (x * 1103515245 + 12345) >>> 0;
    s += x.toString(16).padStart(8, "0");
  }
  return s.slice(0, len);
};

function makeRepo(serverUrl: string, name: string, description: string, nRev: number): MockRepo {
  const id = hex(++seq, 32);
  const main: Revision[] = [];
  for (let n = nRev; n >= 1; n--) {
    main.push({ number: n, hash: hex(seq * 1000 + n), parents: n > 1 ? [hex(seq * 1000 + n - 1)] : [], branch: "main", author: AUTHORS[n % AUTHORS.length] ?? null, timestamp: T0 + n * DAY * 0.7, message: MESSAGES[n % MESSAGES.length] ?? "" });
  }
  const feature: Revision[] = [3, 2, 1].map((k) => ({ number: nRev + k, hash: hex(seq * 5000 + k), parents: [k > 1 ? hex(seq * 5000 + k - 1) : (main[0]?.hash ?? "")], branch: "feature/weapons", author: "ben@studio", timestamp: T0 + (nRev + k) * DAY * 0.7, message: `Weapons WIP ${k}` }));
  const branches = [
    { id: hex(seq * 7, 32), name: "main", latestHash: main[0]?.hash ?? null, creator: "ana@studio", created: T0, archived: false, isDefault: true, protected: true },
    { id: hex(seq * 7 + 1, 32), name: "feature/weapons", latestHash: feature[0]?.hash ?? null, creator: "ben@studio", created: T0 + 5 * DAY, archived: false, isDefault: false, protected: false },
    { id: hex(seq * 7 + 2, 32), name: "spike/old-renderer", latestHash: main[3]?.hash ?? null, creator: "chen@studio", created: T0 + 2 * DAY, archived: true, isDefault: false, protected: false },
  ];
  return {
    repo: { id, name, url: `${serverUrl.replace(/\/+$/, "")}/${name}`, description, creator: "ana@studio", created: T0, defaultBranch: "main" },
    branches,
    revisions: new Map([
      ["main", main],
      ["feature/weapons", [...feature, ...main]],
      ["spike/old-renderer", main.slice(3)],
    ]),
    locks: [
      { path: "Content/Maps/Level_02.umap", owner: "dee@studio", branch: "main", lockedAt: T0 + 20 * DAY },
      { path: "Content/Characters/Hero/Hero.uasset", owner: "ana@studio", branch: "main", lockedAt: T0 + 21 * DAY },
      { path: "Content/Weapons/Rifle.uasset", owner: "ben@studio", branch: "feature/weapons", lockedAt: T0 + 22 * DAY },
    ],
  };
}

export class MockBackend implements AdminBackend {
  readonly kind = "mock" as const;
  readonly sdkVersion = null;
  private servers = new Map<string, Map<string, MockRepo>>();

  constructor(private readonly latencyMs = 0) {}

  private async tick(): Promise<void> {
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  private store(s: ServerConn): Map<string, MockRepo> {
    if (/unreachable|invalid/.test(s.url)) throw new LoreError(`Could not connect to ${s.url}`, 3);
    let m = this.servers.get(s.url);
    if (!m) {
      m = new Map();
      for (const [n, d, r] of [
        ["ShooterGame", "First-person shooter: code + content", 24],
        ["EngineTools", "Build scripts and editor utilities", 9],
        ["SharedAssets", "Marketplace and shared megascans", 4],
      ] as const)
        m.set(n, makeRepo(s.url, n, d, r));
      this.servers.set(s.url, m);
    }
    return m;
  }

  private repo(s: ServerConn, name: string): MockRepo {
    const r = this.store(s).get(name);
    if (!r) throw new LoreError(`Repository not found: ${name}`, 4);
    return r;
  }

  async listRepositories(s: ServerConn): Promise<Repo[]> {
    await this.tick();
    return [...this.store(s).values()].map((r) => r.repo);
  }

  async createRepository(s: ServerConn, name: string, description = ""): Promise<Repo> {
    await this.tick();
    const st = this.store(s);
    if (st.has(name)) throw new LoreError(`Repository already exists: ${name}`, 5);
    const r = makeRepo(s.url, name, description, 1);
    r.repo.creator = s.identity;
    r.repo.created = Date.now();
    st.set(name, r);
    return r.repo;
  }

  async deleteRepository(s: ServerConn, repo: string): Promise<void> {
    await this.tick();
    this.repo(s, repo);
    this.store(s).delete(repo);
  }

  async whoami(s: ServerConn) {
    await this.tick();
    this.store(s);
    return s.token ? { user: { id: "admin-1", name: "Admin (token)" }, note: null } : { user: null, note: "This server has no authentication configured (demo data)." };
  }

  async listBranches(s: ServerConn, repo: string): Promise<Branch[]> {
    await this.tick();
    return this.repo(s, repo).branches.map(({ protected: _p, ...b }) => b);
  }

  async createBranch(s: ServerConn, repo: string, name: string, from?: string): Promise<Branch> {
    await this.tick();
    const r = this.repo(s, repo);
    if (r.branches.some((b) => b.name === name)) throw new LoreError(`Branch already exists: ${name}`);
    const base = r.branches.find((b) => b.name === (from ?? r.repo.defaultBranch));
    if (!base) throw new LoreError(`Branch not found: ${from}`);
    const b = { id: hex(++seq * 13, 32), name, latestHash: base.latestHash, creator: s.identity, created: Date.now(), archived: false, isDefault: false, protected: false };
    r.branches.push(b);
    r.revisions.set(name, r.revisions.get(base.name) ?? []);
    const { protected: _p, ...out } = b;
    return out;
  }

  async branchAction(s: ServerConn, repo: string, name: string, action: BranchAction): Promise<void> {
    await this.tick();
    const b = this.repo(s, repo).branches.find((x) => x.name === name);
    if (!b) throw new LoreError(`Branch not found: ${name}`);
    if (action === "archive") {
      if (b.isDefault) throw new LoreError("The default branch cannot be archived");
      b.archived = true;
    } else b.protected = action === "protect";
  }

  async history(s: ServerConn, repo: string, branch: string, length: number): Promise<Revision[]> {
    await this.tick();
    const revs = this.repo(s, repo).revisions.get(branch);
    if (!revs) throw new LoreError(`Branch not found: ${branch}`);
    return revs.slice(0, length);
  }

  async revisionDetail(s: ServerConn, repo: string, revision: string): Promise<RevisionDetail> {
    await this.tick();
    for (const revs of this.repo(s, repo).revisions.values()) {
      const r = revs.find((x) => x.hash === revision);
      if (r) {
        const files = FILES.filter((_, i) => (r.number + i) % 3 !== 0).map((path, i) => ({ path, action: i === 0 && r.number === 1 ? ("add" as const) : ("modify" as const), size: 1000 * (i + 1) * r.number, fromPath: null }));
        return { ...r, files, metadata: { message: r.message, "committed-by": r.author ?? "", timestamp: String(r.timestamp) } };
      }
    }
    throw new LoreError(`Revision not found: ${revision}`);
  }

  async listLocks(s: ServerConn, repo: string, f: { branch?: string; owner?: string; path?: string }): Promise<Lock[]> {
    await this.tick();
    return this.repo(s, repo).locks.filter((l) => (!f.branch || l.branch === f.branch) && (!f.owner || l.owner === f.owner) && (!f.path || l.path.startsWith(f.path)));
  }

  async releaseLocks(s: ServerConn, repo: string, branch: string, owner: string, paths: string[]) {
    await this.tick();
    const r = this.repo(s, repo);
    const released: string[] = [];
    const notFound: string[] = [];
    for (const p of paths) {
      const i = r.locks.findIndex((l) => l.path === p && l.branch === branch && l.owner === owner);
      if (i >= 0) {
        r.locks.splice(i, 1);
        released.push(p);
      } else notFound.push(p);
    }
    return { released, notFound };
  }

  async dispose(): Promise<void> {}
}
