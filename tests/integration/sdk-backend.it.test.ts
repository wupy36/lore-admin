// SdkBackend against a real Lore server (e.g. `loreserver` with no config).
//   LORE_IT_REMOTE=lore://127.0.0.1:41337 LORE_IT_CLI=/path/to/lore pnpm test:it
// The CLI seeds a repository (commits by two identities, a branch, locks);
// everything is then read and changed through the SDK backend only.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerConn } from "../../src/server/lore/AdminBackend";
import { SdkBackend } from "../../src/server/lore/SdkBackend";

const REMOTE = process.env.LORE_IT_REMOTE;
const CLI = process.env.LORE_IT_CLI ?? "lore";
const run = REMOTE ? describe : describe.skip;

run("SdkBackend (real Lore)", () => {
  const tag = Date.now().toString(36);
  const repo = `it-${tag}`;
  const work = mkdtempSync(join(tmpdir(), "lore-admin-it-"));
  const data = mkdtempSync(join(tmpdir(), "lore-admin-data-"));
  const s: ServerConn = { id: "it", url: REMOTE as string, identity: "admin@it", token: null };
  let b: SdkBackend;

  const lore = (...args: string[]) => execFileSync(CLI, ["--non-interactive", ...args], { cwd: work, encoding: "utf8", env: { ...process.env, LORE_USE_SERVICE: "0" } });

  beforeAll(async () => {
    lore("--identity", "ana@it", "repository", "create", "--description", "integration", `${REMOTE}/${repo}`);
    mkdirSync(join(work, "Content"));
    writeFileSync(join(work, "main.cpp"), "int main(){}\n");
    writeFileSync(join(work, "Content", "Hero.uasset"), Buffer.alloc(2048, 7));
    lore("stage", "--scan", ".");
    lore("--identity", "ana@it", "commit", "Initial import");
    lore("push");
    writeFileSync(join(work, "main.cpp"), "int main(){ return 0; }\n");
    lore("stage", "main.cpp");
    lore("--identity", "ben@it", "commit", "Return zero");
    lore("push");
    lore("--identity", "ben@it", "lock", "acquire", "Content/Hero.uasset");
    b = await SdkBackend.create(data);
  });

  afterAll(async () => {
    await b?.dispose();
    rmSync(work, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  });

  it("lists repositories with info from `repository info`", async () => {
    const list = await b.listRepositories(s);
    const r = list.find((x) => x.name === repo);
    expect(r).toBeDefined();
    expect(r!.description).toBe("integration");
    expect(r!.defaultBranch).toBe("main");
    expect(r!.url).toBe(`${REMOTE}/${repo}`);
    expect(r!.created).toBeGreaterThan(0);
  });

  it("reports the server has no auth", async () => {
    const who = await b.whoami(s);
    expect(who.user).toBeNull();
    expect(who.note).toMatch(/No authentication/);
  });

  it("lists branches through a bare mirror", async () => {
    const list = await b.listBranches(s, repo);
    const main = list.find((x) => x.name === "main");
    expect(main?.isDefault).toBe(true);
    expect(main?.latestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads history with authors and messages", async () => {
    const h = await b.history(s, repo, "main", 50);
    expect(h.map((r) => r.message)).toEqual(["Return zero", "Initial import"]);
    expect(h.map((r) => r.author)).toEqual(["ben@it", "ana@it"]);
    expect(h[0]!.number).toBe(2);
    const d = await b.revisionDetail(s, repo, h[1]!.hash);
    expect(d.files.map((f) => f.path).sort()).toEqual(["Content/Hero.uasset", "main.cpp"]);
    expect(d.files.every((f) => f.action === "add")).toBe(true);
  });

  it("sees revisions pushed after the mirror was made", async () => {
    writeFileSync(join(work, "new.txt"), "x\n");
    lore("stage", "new.txt");
    lore("--identity", "ana@it", "commit", "Later change");
    lore("push");
    const h = await b.history(s, repo, "main", 50);
    expect(h[0]?.message).toBe("Later change");
    const main = (await b.listBranches(s, repo)).find((x) => x.name === "main");
    expect(main?.latestHash).toBe(h[0]?.hash);
  });

  it("creates and pushes a branch, then archives it", async () => {
    const br = await b.createBranch(s, repo, `feature/${tag}`, "main");
    expect(br.name).toBe(`feature/${tag}`);
    const remote = lore("branch", "list");
    expect(remote).toContain(`feature/${tag}`);
    await b.branchAction(s, repo, `feature/${tag}`, "protect");
    await b.branchAction(s, repo, `feature/${tag}`, "unprotect");
    await b.branchAction(s, repo, `feature/${tag}`, "archive");
    const after = (await b.listBranches(s, repo)).find((x) => x.name === `feature/${tag}`);
    expect(after?.archived).toBe(true);
  });

  it("queries and force-releases locks", async () => {
    const locks = await b.listLocks(s, repo, {});
    const l = locks.find((x) => x.path === "Content/Hero.uasset");
    expect(l).toBeDefined();
    expect(l!.branch).toBe("main");
    const r = await b.releaseLocks(s, repo, l!.branch, l!.owner, [l!.path]);
    expect(r.released).toEqual(["Content/Hero.uasset"]);
    expect((await b.listLocks(s, repo, {})).find((x) => x.path === "Content/Hero.uasset")).toBeUndefined();
  });

  it("creates and deletes a repository", async () => {
    const name = `it-new-${tag}`;
    const r = await b.createRepository(s, name, "made by the console");
    expect(r.name).toBe(name);
    expect(r.description).toBe("made by the console");
    await b.deleteRepository(s, name);
    expect((await b.listRepositories(s)).some((x) => x.name === name)).toBe(false);
  });

  it("surfaces Lore errors", async () => {
    await expect(b.listBranches(s, "does-not-exist")).rejects.toThrow(/not found/i);
    await expect(b.listRepositories({ ...s, url: "lore://127.0.0.1:1" })).rejects.toThrow();
  });
});
