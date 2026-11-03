import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setUnauthorizedHandler } from "./api/client";
import { useAudit, useEvents, useServers } from "./api/queries";
import { Console } from "./components/Console";
import { DetailPane } from "./components/DetailPane";
import { Dialogs } from "./components/Dialogs";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { Splitter } from "./components/Splitter";
import { Toolbar } from "./components/Toolbar";
import { AuditView, BranchesView, HistoryView, LocksView, OverviewView } from "./components/views";
import { useUi } from "./store/ui";

function useTheme() {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}

/** Drop a remembered server/repo that no longer exists; pick the first server on first run. */
function useValidSelection() {
  const servers = useServers().data;
  const serverId = useUi((s) => s.serverId);
  useEffect(() => {
    if (!servers) return;
    if (serverId && !servers.some((s) => s.id === serverId)) useUi.getState().selectServer(servers[0]?.id ?? null);
    else if (!serverId && servers[0]) useUi.getState().selectServer(servers[0].id);
  }, [servers, serverId]);
}

/** Seed the console with recent history (all users) once. */
function useConsoleBacklog() {
  const backlog = useAudit(false).data;
  useEffect(() => {
    if (backlog && useUi.getState().log.length === 0) for (const e of [...backlog].reverse().slice(-200)) useUi.getState().pushLog(e);
    useUi.getState().setError(null);
  }, [backlog]);
}

function Console_() {
  useValidSelection();
  useConsoleBacklog();
  useEvents(true);
  const { tab, repo, showConsole, detail, lastError, layout, serverId } = useUi();
  const servers = useServers().data;
  const server = servers?.find((s) => s.id === serverId);
  const qc = useQueryClient();
  const view = !repo && tab !== "audit" ? "overview" : tab;
  return (
    <div
      className={`app${showConsole ? "" : " no-bottom"}${detail ? "" : " no-detail"}`}
      style={{ "--sidebar-w": `${layout.sidebarW}px`, "--detail-w": `${layout.detailW}px`, "--bottom-h": `${layout.bottomH}px` } as React.CSSProperties}
    >
      <Toolbar onSignOut={() => void qc.invalidateQueries({ queryKey: ["session"] })} />
      <Sidebar />
      <Splitter k="sidebarW" axis="x" sign={1} className="splitter-v" />
      <main className="pane center" aria-label={view}>
        <div className="pane-header">
          <span>{server ? server.name : "No server"}</span>
          {repo && <span>/ {repo}</span>}
          <span className="tspacer" />
          <span>{{ overview: "Overview", branches: "Branches", history: "History", locks: "Locks", audit: "Audit log" }[view]}</span>
        </div>
        {view === "overview" && <OverviewView />}
        {view === "branches" && <BranchesView />}
        {view === "history" && <HistoryView />}
        {view === "locks" && <LocksView />}
        {view === "audit" && <AuditView />}
      </main>
      <Splitter k="detailW" axis="x" sign={-1} className="splitter-v right" />
      <DetailPane />
      <Splitter k="bottomH" axis="y" sign={-1} className="splitter-h" />
      {showConsole && <Console />}
      <footer className="statusbar">
        <span>{server?.url ?? "—"}</span>
        {repo && <span>{repo}</span>}
        {lastError && (
          <span className="err" title={lastError} onClick={() => useUi.getState().setError(null)}>
            ⚠ {lastError}
          </span>
        )}
      </footer>
      <Dialogs />
    </div>
  );
}

export function App() {
  useTheme();
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: api.session, retry: false, staleTime: Infinity });
  useEffect(() => setUnauthorizedHandler(() => void qc.invalidateQueries({ queryKey: ["session"] })), [qc]);

  if (session.isPending) return <div className="empty">Connecting…</div>;
  if (session.isError) return <div className="empty err-text">Cannot reach the console server: {session.error.message}</div>;
  if (!session.data.user)
    return (
      <Login onSignedIn={() => void qc.resetQueries()} />
    );
  return <Console_ />;
}
