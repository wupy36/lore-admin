# lore-admin

An essentials-only admin console for [Lore](https://github.com/EpicGames/lore) servers: the jobs you'd use P4Admin / `p4` admin commands for, in a friendlier UI. One codebase, two ways to run it:

- **Web (Docker)**: a container you host next to your Lore server and open from anywhere, with a sign-in page.
- **Desktop**: an Electron app for your own machine. It runs the same server on loopback, with no sign-in.

It uses the same design as [lore-desktop](https://github.com/wupy36/lore-desktop): the same dark-first tokens, dense tables, console log with CLI equivalents, and the same SDK patterns.

## What it does

| P4 (p4d / P4Admin) | Lore Admin | Lore call |
| --- | --- | --- |
| Connections (`P4PORT`) | **Servers**: add / edit / remove; tokens kept server-side | — |
| `p4 info`, monitor | **Overview**: reachability, latency, HTTP health check, repo count, who you act as | `repository list`, `GET /health_check`, `auth info` |
| `p4 depots`, `p4 depot` | **Repositories**: list with description, default branch, creator; create; delete (typed confirmation) | `repository list/info/create/delete` |
| `p4 streams`, `p4 stream` | **Branches**: list (incl. archived), create from a branch and push, protect / unprotect, archive | `branch list/create/push/protect/unprotect/archive` |
| `p4 changes`, `p4 describe` | **History**: revisions per branch with author, time, message, filter; detail with changed files | `revision history`, `revision info --delta` |
| `p4 opened -a`, `p4 unlock -f` | **Locks**: every lock across branches, filter by owner/path, bulk force-release | `lock query`, `lock release` |
| Server log / journal | **Audit log**: every change made through the console (who, when, the exact `lore` command), persisted | — |

Known Lore limitation: a released `loreserver` 0.12.0 **without authentication** refuses to delete any repository that was created with an identity, whoever asks (error 17 "Not authorized"). The console says so when it happens. You can fix it by upgrading the server to a build after rev 1985, configuring auth and using an owner/admin token, or leaving the server's identity empty in the console for repositories you'll want to delete.

Not included (Lore has no API for it, or it's out of scope): user/group/permission management (Lore delegates identity to your OIDC provider), server config editing, obliterate, and merges.

## Run with Docker

```bash
docker build -t lore-admin .
```

```bash
docker run -d --name lore-admin -p 4800:4800 -v lore-admin-data:/data \
  -e LORE_ADMIN_PASSWORD=change-me \
  -e LORE_ADMIN_SERVERS="Studio=lore://lore.studio.lan:41337|http://lore.studio.lan:41339/health_check" \
  lore-admin
```

Then open `http://<host>:4800` and sign in as `admin`. `docker-compose.yml` runs it next to a `loreserver` container.

| Variable | Meaning |
| --- | --- |
| `LORE_ADMIN_PASSWORD` (`_FILE`) | Password for the `admin` account |
| `LORE_ADMIN_USERS` (`_FILE`) | Several accounts: `alice:pw,bob:scrypt$…`. Hash with `node scripts/hash-password.mjs <pw>` (write `$$` in compose files) |
| `LORE_ADMIN_SERVERS` | Pre-configured servers, `Name=lore://host:port[\|http://host:41339/health_check]`, comma separated. Read-only in the UI |
| `LORE_ADMIN_SERVER_IDENTITY` | Identity recorded on changes, for unauthenticated servers |
| `LORE_ADMIN_SERVER_TOKEN` | Identity token for authenticated servers |
| `LORE_ADMIN_SECURE_COOKIE=1` | Mark the session cookie `Secure` (serve over HTTPS) |
| `LORE_ADMIN_TRUST_PROXY=1` | Behind a reverse proxy: honour `X-Forwarded-For/-Proto` |
| `LORE_ADMIN_NO_AUTH=1` | No sign-in. Use only on a trusted network |
| `LORE_ADMIN_MOCK=1` | Demo data, no Lore needed |

`/data` holds `servers.json` (mode 600, may contain tokens), `audit.jsonl`, and `mirrors/` (see below). Before you expose the port beyond your LAN, put it behind a TLS reverse proxy.

Build notes: the image must use glibc 2.39 or newer (the Lore library requires it), so it's based on Debian trixie. If Docker Hub rate-limits you, add `--build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-trixie-slim`. Behind a TLS-inspecting proxy, add `--secret id=ca,src=proxy-ca.pem`.

## Run as a desktop app

```bash
pnpm install
pnpm build
pnpm desktop            # or: pnpm desktop:mock
```

Packages: `pnpm dist:win:native` (on Windows: NSIS installer + portable exe), `pnpm dist:dir` (unpacked app for the current OS). CI builds the Windows installer as an artifact.

## Develop

```bash
pnpm dev:server         # API on :4800, mock data, no sign-in
pnpm dev:web            # Vite with hot reload, proxies /api to :4800
pnpm start:mock         # built app, mock data
```

## Check

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Integration tests against a real Lore server (`loreserver` with no config is enough):

```bash
LORE_IT_REMOTE=lore://127.0.0.1:41337 LORE_IT_CLI=lore pnpm test:it
```

Smoke tests (need a display for the desktop one; use `xvfb-run -a` on headless Linux):

```bash
node scripts/smoke-web.cjs http://127.0.0.1:4800 <password> <out-dir> [repo]
node scripts/smoke-desktop.cjs out.png [--exe=dist/linux-unpacked/lore-admin]
```

## Layout

```
src/shared/    Lore-free DTOs (zod), HTTP API contract, CLI-equivalent builders
src/server/    HTTP server, auth, audit log, server profiles, handlers
  lore/        AdminBackend interface + SdkBackend / MockBackend (the only place Lore is touched)
src/desktop/   Electron shell (runs src/server on loopback)
src/web/       React UI
docs/          ARCHITECTURE.md
```

## License

MIT
