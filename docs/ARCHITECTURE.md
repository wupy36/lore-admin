# lore-admin architecture

An admin console for Lore servers, built to the same rules as lore-desktop: essentials only, every Lore call goes through one adapter (`AdminBackend`), and the console shows the equivalent `lore` command for every call.

Sources checked: Lore `main` @ `b8fc623` (`lore-capi/lore.h`, `docs/reference/lore-cli-commands.md`, `docs/reference/lore-server-config.md`, `lore-server/src/http`), `@lore-vcs/sdk@0.12.0` typings. Behaviour below was verified against `loreserver` + `lore` 0.12.1-nightly built from that commit.

## 1. One server, two shells

```
 browser (remote)                     Electron window (desktop)
      │  HTTPS via proxy                    │  http://127.0.0.1:<random>
      ▼                                     ▼
┌─────────────────────── src/server (Node) ───────────────────────┐
│ http.ts   static SPA · /api/session|login|logout · /api/events  │
│           POST /api/call/<channel>  (X-Lore-Admin: 1 required)  │
│ dispatch  zod-validate input AND output → handler → audit       │
│ handlers  servers · repos · branches · history · locks · audit  │
│ lore/AdminBackend ◄── SdkBackend (default) · MockBackend        │
└──────────────────────────────────────────────────────────────────┘
```

- **Docker** (`src/server/main.ts`): binds `0.0.0.0:4800` and requires sign-in.
- **Desktop** (`src/desktop/main.ts`): runs the same `createApp()` on `127.0.0.1:0`. It mints one session and sets it as a cookie on the window's session only, so other local processes and browser tabs get `401` (checked by `scripts/smoke-desktop.cjs`). The window can't navigate away, and links open in the system browser.
- **Contract**: `src/shared/api.ts`. Each channel has zod `{ input, output }`. `handlers.test.ts` asserts that every channel has a handler.
- **Type isolation**: ESLint forbids `@lore-vcs/sdk*` outside `SdkBackend.ts` and `mappers.ts`, as in lore-desktop.

## 2. Lore facts the design depends on (verified)

- **Server-scoped calls need no local state.** `repository list <url>`, `repository info <url>` (name, description, default branch, creator, created), `repository create <url>` and `repository delete <url>` all take the server URL. `create` still writes a local instance, so it runs in a throwaway directory.
- **Repository-scoped calls need an instance.** `branch *`, `revision history/info` and `lock query/release` have no URL argument; they read the repository from `repository_path`. The console keeps one **bare clone** per repository (`lore clone --bare`: no files, only the latest tree) at `<data>/mirrors/<sha(server)>/<repositoryId>`. It is keyed by id, so a deleted-and-recreated name gets a fresh mirror. Calls on one mirror are serialized because Lore takes a repository lock per operation.
- **Freshness.** Revisions pushed after the mirror was made show up without a sync. `history` and `revision info` run with `remote: true`, and `branch list` reports the remote location, which wins over the mirror's local view. An integration test covers this (`sees revisions pushed after the mirror was made`).
- **Branch create** branches from the instance's current revision and switches to it, so the backend switches the mirror to the base branch, runs `branch create` and then `branch push`.
- **Archive refuses the current branch** with "branch not found: <id>". The backend first moves the mirror to the default branch, and the default branch itself can't be archived. Archive is server-side: a fresh clone no longer lists the branch, even with `--archived`. So only branches archived through this mirror show as "archived". The others disappear, which is how Lore itself lists them.
- **Protection is not reported** by `branch list` (the same gap lore-desktop found). Protect and Unprotect are explicit actions, and the UI says the state is unknown.
- **Locks.** `lock query` needs a branch, so "all locks" means one query per non-archived branch. Events carry the branch *id*, which is mapped to a name. `lock release` with `force` + `owner` releases another user's lock (`p4 unlock -f`). SDK 0.12 has no per-path "not found" event (newer lore-capi does), so it is derived. On an unauthenticated server the owner is `<unknown>` and release still works. Locks are advisory, and the UI says so.
- **Auth.** `auth user info` fails with code 9 on servers without an auth endpoint; that is reported as "No authentication on this server". The SDK throws its own error type (`returnCode`, `errorDetail`), which `run()` converts to `LoreError` with the code. A per-server token is passed as `identityToken`, and then `identity` must be empty. Neither path has been tried against an authenticating server yet.
- **Health**: `GET http://host:41339/health_check` returns 200, or 503 when `store_health_check` is set and the store is down.

## 3. Security (server mode)

- Accounts come from `LORE_ADMIN_USERS` / `LORE_ADMIN_PASSWORD` (plain or `scrypt$salt$hash`), compared in constant time. Unknown users take as long as wrong passwords.
- Sessions are random 256-bit ids held in memory with a 12 h sliding expiry; a restart signs everyone out. The cookie is `HttpOnly; SameSite=Strict`, plus `Secure` when configured or when `X-Forwarded-Proto: https` comes from a trusted proxy.
- CSRF: every POST must carry `X-Lore-Admin: 1`. Cross-site pages can't set it without a CORS preflight, which the server never grants.
- Ten failed sign-ins per client per 15 min, then `429`.
- Headers: a strict CSP (`script-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `X-Frame-Options: DENY`, `no-referrer`. Static paths are confined to the web root.
- Tokens stay on the host: `servers.json` is written with mode 600, and profiles returned to the browser only say `hasToken`.
- The server refuses to start without accounts unless `--no-auth` / `LORE_ADMIN_NO_AUTH=1` is set, and then it logs a warning.
- The container runs as the non-root `node` user. All state is in `/data`.

## 4. Audit and console

`dispatch()` records every Lore-touching call with the actor, server, op, equivalent CLI line (`src/shared/commands.ts`), result and duration. It streams to all signed-in UIs over SSE. **Mutating** channels (`MUTATING` in `api.ts`) are also appended to `<data>/audit.jsonl`, which reloads on start (checked across a container restart). Repo-scoped commands are shown as `lore --repository "<mirror:Repo>" …`, because that is where they run.

## 5. Decisions

- **Plain `node:http`**, no framework: there are few routes, and the runtime dependency set stays at `@lore-vcs/sdk` (+ koffi). esbuild bundles the server and the Electron main to CJS, and Vite builds the UI.
- **Electron hosts the HTTP server** instead of using IPC, so the desktop app and the web image behave the same and are tested the same way.
- **Versions pinned** to match lore-desktop: React 18.3.1, TanStack Query 5.62 / Virtual 3.10, zod 3.23.8, Vite 5.4.11, Electron 33.2.1, TypeScript 5.7.2, SDK 0.12.0.
- **Docker base is Debian trixie.** `lorelib-amd64-unknown-linux.so` needs `GLIBC_2.39`, and bookworm (2.36) fails at load. This was found by running the image.

## 6. Verification (this commit)

| Check | Result |
| --- | --- |
| `pnpm typecheck`, `pnpm lint` | clean |
| `pnpm test` | 18 passed: auth, throttling, CSRF, path traversal, secrets not returned, managed servers read-only, typed delete confirmation, audit persistence, handlers on every channel, UI sign-in → overview → branches → lock release |
| `pnpm test:it` against real `loreserver` | 9 passed: repo list/info, no-auth note, branches via bare mirror, history authors/messages, freshness after a later push, branch create+push / protect / unprotect / archive, lock query + force release, repo create + delete, error surfacing |
| `scripts/smoke-web.cjs` | pass: mock, SDK backend on the host, and the Docker image (phone width included) |
| Docker image | builds; healthcheck `healthy`; runs as uid 1000; branch created through the API is visible from an independent CLI clone; audit survives `docker restart` |
| Desktop | `scripts/smoke-desktop.cjs`: pass in dev (`electron .`) and packaged (`dist:dir`, Linux) against real Lore; unauthenticated API calls get `401`; bound to 127.0.0.1 |

Not verified here: the Windows installer (CI job added, not yet run), an authenticating Lore server (OIDC/tokens), and the `ghcr.io/epicgames/lore/loreserver` image in `docker-compose.yml` (the registry was unreachable from this environment).
