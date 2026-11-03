// Launches the Electron app (no sign-in: the window gets a minted session) and
// checks the console loads data.
//   node scripts/smoke-desktop.cjs out.png [--exe=<packaged exe>] [--mock]
// Needs a display: xvfb-run -a node scripts/smoke-desktop.cjs …
const { _electron: electron } = require("playwright");

(async () => {
  const [out, ...rest] = process.argv.slice(2);
  const exe = rest.find((a) => a.startsWith("--exe="))?.slice(6);
  const flags = rest.filter((a) => !a.startsWith("--exe="));
  const app = await electron.launch(exe ? { executablePath: exe, args: flags } : { executablePath: require("electron"), args: [".", ...flags], env: { ...process.env } });
  const win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", (e) => errors.push(e.message));
  await win.getByText("Reachable").first().waitFor({ timeout: 30000 });
  if (await win.getByLabel("Password").count()) throw new Error("desktop window asked for a password");
  await win.screenshot({ path: out });
  // The API must refuse callers without the window's session cookie.
  const url = new URL(win.url());
  const res = await fetch(`${url.origin}/api/call/servers:list`, { method: "POST", headers: { "x-lore-admin": "1" } });
  if (res.status !== 401) throw new Error(`unauthenticated API call returned ${res.status}`);
  if (!/^127\.0\.0\.1$/.test(url.hostname)) throw new Error(`desktop server not on loopback: ${url.host}`);
  await app.close();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("DESKTOP SMOKE PASS", url.origin);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
