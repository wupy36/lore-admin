// The only interface the rest of the server uses to talk to Lore. Lore is
// pre-1.0: SDK shapes stay inside SdkAdminBackend.ts / mappers.ts.
import type { Branch, BranchAction, Lock, Repo, Revision, RevisionDetail } from "@shared/types";

/** A server connection with its secrets (server-side only). */
export interface ServerConn {
  id: string;
  url: string;
  identity: string | null;
  token: string | null;
}

export class LoreError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "LoreError";
  }
}

export interface AdminBackend {
  readonly kind: "sdk" | "mock";
  readonly sdkVersion: string | null;

  listRepositories(s: ServerConn): Promise<Repo[]>;
  createRepository(s: ServerConn, name: string, description?: string): Promise<Repo>;
  deleteRepository(s: ServerConn, repo: string): Promise<void>;
  /** Who the console is on this server; null user + note when the server has no auth. */
  whoami(s: ServerConn): Promise<{ user: { id: string; name: string } | null; note: string | null }>;

  listBranches(s: ServerConn, repo: string): Promise<Branch[]>;
  createBranch(s: ServerConn, repo: string, name: string, from?: string): Promise<Branch>;
  branchAction(s: ServerConn, repo: string, name: string, action: BranchAction): Promise<void>;

  history(s: ServerConn, repo: string, branch: string, length: number): Promise<Revision[]>;
  revisionDetail(s: ServerConn, repo: string, revision: string): Promise<RevisionDetail>;

  listLocks(s: ServerConn, repo: string, f: { branch?: string; owner?: string; path?: string }): Promise<Lock[]>;
  releaseLocks(s: ServerConn, repo: string, branch: string, owner: string, paths: string[]): Promise<{ released: string[]; notFound: string[] }>;

  dispose(): Promise<void>;
}
