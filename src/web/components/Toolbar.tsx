import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useInfo, useServers } from "../api/queries";
import { useUi, type Tab, type Theme } from "../store/ui";

const TABS: { id: Tab; label: string; needsRepo: boolean; title: string }[] = [
  { id: "overview", label: "Overview", needsRepo: false, title: "Server status and repositories (p4 info / p4 depots)" },
  { id: "branches", label: "Branches", needsRepo: true, title: "Branches of the repository (p4 streams)" },
  { id: "history", label: "History", needsRepo: true, title: "Revisions on a branch (p4 changes / describe)" },
  { id: "locks", label: "Locks", needsRepo: true, title: "File locks held on the repository (p4 opened -a / unlock -f)" },
  { id: "audit", label: "Audit log", needsRepo: false, title: "Changes made through this console" },
];

export function Toolbar({ onSignOut }: { onSignOut: () => void }) {
  const qc = useQueryClient();
  const info = useInfo().data;
  const servers = useServers().data ?? [];
  const { serverId, repo, tab, theme, showConsole } = useUi();
  const ui = useUi.getState();

  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar">
      <span className="brand">
        Lore <span>Admin</span>
      </span>
      <select className="input" aria-label="Server" value={serverId ?? ""} onChange={(e) => ui.selectServer(e.target.value || null)}>
        {!serverId && <option value="">Select a server…</option>}
        {servers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <span className="tsep" />
      <div className="tabs" role="tablist" aria-label="Views" style={{ border: "none", background: "transparent", height: 30 }}>
        {TABS.map((t) => (
          <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} title={t.needsRepo && !repo ? "Select a repository first" : t.title} disabled={t.needsRepo && !repo} onClick={() => ui.setTab(t.id)} style={t.needsRepo && !repo ? { opacity: 0.45, cursor: "default" } : undefined}>
            {t.label}
          </button>
        ))}
      </div>
      <span className="tspacer" />
      <button className="tbtn" title="Reload everything from the servers" onClick={() => void qc.invalidateQueries()}>
        ⟳ Refresh
      </button>
      <button className="tbtn" aria-pressed={showConsole} title="Show or hide the console" onClick={ui.toggleConsole}>
        ▤ Console
      </button>
      <select className="input" aria-label="Theme" value={theme} onChange={(e) => ui.setTheme(e.target.value as Theme)}>
        <option value="system">System theme</option>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
      {info && <span className={`badge${info.backend === "mock" ? " mock" : ""}`} title={`${info.mode} · ${info.backend}${info.sdkVersion ? ` · SDK ${info.sdkVersion}` : ""} · v${info.version}`}>{info.backend === "mock" ? "demo data" : info.mode}</span>}
      {info?.user && <span className="badge" title="Signed in as">👤 {info.user}</span>}
      {info?.authRequired && info.mode === "server" && (
        <button className="tbtn" onClick={() => void api.logout().finally(onSignOut)}>
          Sign out
        </button>
      )}
    </div>
  );
}
