// Equivalent `lore` CLI line for every console operation, shown in the console
// and the audit log so an admin can always reproduce an action from a shell.
// Verified against lore docs/reference/lore-cli-commands.md.
import type { Channel, Input } from "./api";

type Argv = string[];
const q = (s: string): string => (/^[\w@./:=-]+$/.test(s) ? s : JSON.stringify(s));
export const formatArgv = (argv: Argv): string => ["lore", ...argv].map(q).join(" ");

const repoUrl = (server: string, repo: string) => `${server.replace(/\/+$/, "")}/${repo}`;
/** Commands that need a repository context run in the console's bare mirror of it. */
const inMirror = (repo: string, argv: Argv): Argv => ["--repository", `<mirror:${repo}>`, ...argv];

type Builder<C extends Channel> = (i: Input<C>, serverUrl: string) => Argv;

const builders: { [C in Channel]?: Builder<C> } = {
  "servers:status": (_i, s) => ["repository", "list", s],
  "repos:list": (_i, s) => ["repository", "list", s],
  "repos:create": (i, s) => ["repository", "create", ...(i.description ? ["--description", i.description] : []), repoUrl(s, i.name)],
  "repos:delete": (i, s) => ["repository", "delete", repoUrl(s, i.repo)],
  "branches:list": (i) => inMirror(i.repo, ["branch", "list", "--archived"]),
  "branches:create": (i) => inMirror(i.repo, ["branch", "create", i.name]),
  "branches:action": (i) => inMirror(i.repo, ["branch", i.action, i.name]),
  "history:list": (i) => inMirror(i.repo, ["history", "--branch", i.branch, String(i.length)]),
  "history:detail": (i) => inMirror(i.repo, ["revision", "info", "--metadata", "--delta", i.revision]),
  "locks:list": (i) => inMirror(i.repo, ["lock", "query", ...(i.branch ? ["--branch", i.branch] : []), ...(i.owner ? ["--owner", i.owner] : []), ...(i.path ? ["--path", i.path] : [])]),
  "locks:release": (i) => inMirror(i.repo, ["lock", "release", "--branch", i.branch, "--owner", i.owner, ...i.paths]),
};

export function commandFor<C extends Channel>(channel: C, input: Input<C>, serverUrl: string | null): string | null {
  const b = builders[channel] as Builder<C> | undefined;
  if (!b || !serverUrl) return null;
  try {
    return formatArgv(b(input, serverUrl));
  } catch {
    return null;
  }
}
