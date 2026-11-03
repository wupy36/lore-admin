// Headless server entry (Docker / `pnpm start`).
//
//   node out/server/main.cjs [--mock] [--no-auth] [--port 4800] [--host 0.0.0.0] [--data ./data]
//
// Environment (flags win):
//   LORE_ADMIN_PORT, LORE_ADMIN_HOST, LORE_ADMIN_DATA
//   LORE_ADMIN_USERS        "alice:password,bob:scrypt$…"  (or LORE_ADMIN_USERS_FILE)
//   LORE_ADMIN_PASSWORD     single "admin" account          (or LORE_ADMIN_PASSWORD_FILE)
//   LORE_ADMIN_SERVERS      "Studio=lore://lore:41337|http://lore:41339/health_check"
//   LORE_ADMIN_SERVER_TOKEN / LORE_ADMIN_SERVER_IDENTITY  for the servers above
//   LORE_ADMIN_SECURE_COOKIE=1, LORE_ADMIN_TRUST_PROXY=1
//   LORE_ADMIN_MOCK=1, LORE_ADMIN_NO_AUTH=1  (demo / trusted network only)
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Auth, parseUsers } from "./auth";
import { APP_VERSION, createApp } from "./app";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
};
const env = process.env;
const fromFile = (v: string | undefined, file: string | undefined) => (file ? readFileSync(file, "utf8").trim() : v);

async function main(): Promise<void> {
  const mock = flag("mock") || env.LORE_ADMIN_MOCK === "1";
  const noAuth = flag("no-auth") || env.LORE_ADMIN_NO_AUTH === "1";
  const port = Number(opt("port") ?? env.LORE_ADMIN_PORT ?? 4800);
  const host = opt("host") ?? env.LORE_ADMIN_HOST ?? "0.0.0.0";
  const dataDir = resolve(opt("data") ?? env.LORE_ADMIN_DATA ?? "data");

  const users = parseUsers(fromFile(env.LORE_ADMIN_USERS, env.LORE_ADMIN_USERS_FILE), fromFile(env.LORE_ADMIN_PASSWORD, env.LORE_ADMIN_PASSWORD_FILE));
  if (!users.size && !noAuth) {
    console.error("lore-admin: no admin accounts. Set LORE_ADMIN_PASSWORD (or LORE_ADMIN_USERS), or pass --no-auth on a trusted network.");
    process.exit(2);
  }
  if (noAuth) console.warn("lore-admin: WARNING sign-in disabled (--no-auth): anyone who can reach this port is an administrator.");

  const app = await createApp({
    mode: "server",
    dataDir,
    mock,
    auth: new Auth(users, !noAuth),
    webRoot: join(__dirname, "..", "web"),
    env,
    secureCookies: env.LORE_ADMIN_SECURE_COOKIE === "1",
    trustProxy: env.LORE_ADMIN_TRUST_PROXY === "1",
  });
  const bound = await app.listen(port, host);
  console.log(`lore-admin ${APP_VERSION} (${app.backend.kind}) listening on http://${host}:${bound}  data=${dataDir}  accounts=${users.size}`);

  const stop = () => {
    console.log("lore-admin: shutting down");
    void app.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((e: unknown) => {
  console.error(`lore-admin: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
