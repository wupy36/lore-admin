// Desktop entry: runs the same server as the Docker image, bound to loopback on
// a random port, and opens it in a window. The API still requires a session:
// one is minted at start and set as a cookie on the window's session only, so
// other local processes (or browser tabs) cannot drive the console.
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu, shell, session } from "electron";
import { Auth, COOKIE } from "../server/auth";
import { createApp } from "../server/app";

const forceMock = process.argv.includes("--mock") || process.env.LORE_ADMIN_MOCK === "1";
let win: BrowserWindow | null = null;
let closeApp: (() => Promise<void>) | null = null;

async function start(): Promise<void> {
  const auth = new Auth(new Map(), true);
  const opts = { mode: "desktop" as const, dataDir: app.getPath("userData"), auth, webRoot: join(__dirname, "..", "web"), env: process.env };
  let server: Awaited<ReturnType<typeof createApp>>;
  try {
    server = await createApp({ ...opts, mock: forceMock });
  } catch (e) {
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: "Lore Admin",
      message: "The Lore library could not be loaded.",
      detail: `${e instanceof Error ? e.message : String(e)}\n\nSet LORE_LIB_PATH to the Lore library to override its location.`,
      buttons: ["Run in demo (mock) mode", "Quit"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 1) return app.exit(1);
    server = await createApp({ ...opts, mock: true });
  }
  closeApp = () => server.close();
  const port = await server.listen(0, "127.0.0.1");
  const origin = `http://127.0.0.1:${port}`;
  await session.defaultSession.cookies.set({ url: origin, name: COOKIE, value: auth.mint(process.env.USERNAME ?? process.env.USER ?? "local"), httpOnly: true, sameSite: "strict" });

  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: "#1b1d21",
    title: "Lore Admin",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // Links open in the system browser; the window never navigates away from the console.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(origin)) e.preventDefault();
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "&File", submenu: [{ role: "quit" }] },
      { label: "&Edit", submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "&View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
    ]),
  );
  await win.loadURL(origin);
}

app.whenReady().then(start, (e: unknown) => {
  dialog.showErrorBox("Lore Admin", e instanceof Error ? e.message : String(e));
  app.exit(1);
});
app.on("window-all-closed", () => {
  void (closeApp?.() ?? Promise.resolve()).finally(() => app.quit());
});
