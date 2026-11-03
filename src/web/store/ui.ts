// UI-only state (selection, tabs, layout). Server state lives in TanStack Query.
import { create } from "zustand";
import type { AuditEntry } from "@shared/types";

export type Tab = "overview" | "branches" | "history" | "locks" | "audit";
export type Theme = "dark" | "light" | "system";
export type Modal =
  | { kind: "server"; id?: string }
  | { kind: "createRepo" }
  | { kind: "deleteRepo"; repo: string }
  | { kind: "createBranch"; from?: string }
  | { kind: "releaseLocks"; locks: { path: string; owner: string; branch: string }[] }
  | { kind: "confirm"; title: string; body: string; confirmLabel: string; danger?: boolean; run: () => Promise<unknown> }
  | null;

/** What the detail pane shows. */
export type Detail = { kind: "branch"; name: string } | { kind: "revision"; hash: string } | { kind: "lock"; key: string } | { kind: "audit"; id: string } | null;

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`lore-admin:${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v === null) localStorage.removeItem(`lore-admin:${k}`);
      else localStorage.setItem(`lore-admin:${k}`, v);
    } catch {
      /* private mode etc. */
    }
  },
};

export interface UiState {
  serverId: string | null;
  repo: string | null;
  tab: Tab;
  branch: string | null;
  detail: Detail;
  modal: Modal;
  theme: Theme;
  showConsole: boolean;
  /** Live console (this session + backlog), newest last. */
  log: AuditEntry[];
  lastError: string | null;
  layout: { sidebarW: number; detailW: number; bottomH: number };

  selectServer(id: string | null): void;
  selectRepo(name: string | null): void;
  setTab(t: Tab): void;
  setBranch(b: string | null): void;
  setDetail(d: Detail): void;
  setModal(m: Modal): void;
  setTheme(t: Theme): void;
  toggleConsole(): void;
  pushLog(e: AuditEntry): void;
  setError(e: string | null): void;
  setLayout(p: Partial<UiState["layout"]>): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const useUi = create<UiState>((set) => ({
  serverId: store.get("server"),
  repo: store.get("repo"),
  tab: (store.get("tab") as Tab | null) ?? "overview",
  branch: null,
  detail: null,
  modal: null,
  theme: (store.get("theme") as Theme | null) ?? "system",
  showConsole: store.get("console") !== "0",
  log: [],
  lastError: null,
  layout: { sidebarW: 280, detailW: 380, bottomH: 170 },

  selectServer: (id) => {
    store.set("server", id);
    store.set("repo", null);
    set({ serverId: id, repo: null, branch: null, detail: null, tab: "overview" });
  },
  selectRepo: (name) => {
    store.set("repo", name);
    set((s) => ({ repo: name, branch: null, detail: null, tab: name ? (s.tab === "overview" || s.tab === "audit" ? "branches" : s.tab) : "overview" }));
  },
  setTab: (tab) => {
    store.set("tab", tab);
    set({ tab, detail: null });
  },
  setBranch: (branch) => set({ branch }),
  setDetail: (detail) => set({ detail }),
  setModal: (modal) => set({ modal }),
  setTheme: (theme) => {
    store.set("theme", theme);
    set({ theme });
  },
  toggleConsole: () =>
    set((s) => {
      store.set("console", s.showConsole ? "0" : "1");
      return { showConsole: !s.showConsole };
    }),
  pushLog: (e) => set((s) => ({ log: s.log.length >= 1000 ? [...s.log.slice(-999), e] : [...s.log, e], lastError: e.ok ? s.lastError : `${e.op}: ${e.message}` })),
  setError: (lastError) => set({ lastError }),
  setLayout: (p) =>
    set((s) => ({
      layout: {
        sidebarW: clamp(p.sidebarW ?? s.layout.sidebarW, 200, 600),
        detailW: clamp(p.detailW ?? s.layout.detailW, 260, 800),
        bottomH: clamp(p.bottomH ?? s.layout.bottomH, 80, 600),
      },
    })),
}));

export const lockKey = (l: { path: string; branch: string; owner: string }) => `${l.branch}\u0000${l.owner}\u0000${l.path}`;
