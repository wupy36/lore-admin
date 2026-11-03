// Renders the real App against the real HTTP server + handlers (mock backend):
// sign-in, server overview, repository branches, lock release.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../../src/web/App";
import { Auth } from "../../src/server/auth";
import { createApp } from "../../src/server/app";
import { MockBackend } from "../../src/server/lore/MockBackend";

let app: Awaited<ReturnType<typeof createApp>>;
let base = "";
let cookie = "";
const dir = mkdtempSync(join(tmpdir(), "lore-admin-ui-"));
const realFetch = globalThis.fetch;

beforeAll(async () => {
  app = await createApp({ mode: "server", dataDir: dir, mock: true, backend: new MockBackend(), auth: new Auth(new Map([["admin", "pw"]]), true), webRoot: null });
  base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  // Relative URLs → test server, with a tiny cookie jar (jsdom fetch has none for us).
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const res = await realFetch(`${base}/${String(url).replace(/^\//, "")}`, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0] as string;
    return res;
  });
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage = null;
      close() {}
    },
  );
});
afterEach(cleanup);
afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const renderApp = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);

describe("App", () => {
  it("signs in, shows the server overview and repositories", async () => {
    renderApp();
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Reachable", {}, { timeout: 5000 })).toBeTruthy();
    const table = screen.getByRole("table", { name: "Repositories" });
    expect(within(table).getByText("ShooterGame")).toBeTruthy();
  });

  it("opens a repository's branches and force-releases a lock", async () => {
    renderApp();
    const repos = await screen.findByRole("listbox", { name: "Repositories" });
    fireEvent.click(await within(repos).findByText("ShooterGame"));
    const branches = await screen.findByRole("table", { name: "Branches" });
    expect(within(branches).getByText("feature/weapons")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Locks" }));
    await screen.findByRole("table", { name: "Locks" });
    fireEvent.click(await screen.findByLabelText("Select Content/Maps/Level_02.umap"));
    fireEvent.click(screen.getByRole("button", { name: /Release 1 lock/ }));
    const dialog = await screen.findByRole("dialog", { name: "Force release locks" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.queryByLabelText("Select Content/Maps/Level_02.umap")).toBeNull());
    expect(screen.getByLabelText("Select Content/Characters/Hero/Hero.uasset")).toBeTruthy();
  });
});
