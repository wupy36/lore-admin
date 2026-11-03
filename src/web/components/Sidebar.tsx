import { useMemo, useState } from "react";
import { useRepos, useServerStatus, useServers } from "../api/queries";
import { useUi } from "../store/ui";

function ServerDot({ id }: { id: string }) {
  const st = useServerStatus(id);
  const s = st.data;
  const cls = st.isPending ? "" : !s?.reachable ? "bad" : s.health === "unavailable" ? "warn" : "ok";
  const title = st.isPending ? "Checking…" : !s?.reachable ? `Unreachable: ${s?.error ?? ""}` : `Reachable · ${s.latencyMs} ms · health ${s.health}`;
  return <span className={`dot ${cls}`} title={title} aria-label={title} />;
}

export function Sidebar() {
  const servers = useServers();
  const { serverId, repo } = useUi();
  const ui = useUi.getState();
  const repos = useRepos(serverId);
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => (repos.data ?? []).filter((r) => r.name.toLowerCase().includes(filter.toLowerCase())), [repos.data, filter]);

  return (
    <aside className="pane sidebar" aria-label="Servers and repositories">
      <div className="group-title">
        <span className="grow">Servers</span>
        <button className="mini" onClick={() => ui.setModal({ kind: "server" })} title="Add a Lore server">
          ＋ Add
        </button>
      </div>
      <div className="capped" role="listbox" aria-label="Servers">
        {servers.isPending && <div className="empty">Loading…</div>}
        {servers.data?.length === 0 && <div className="empty">No servers yet. Add one to get started.</div>}
        {servers.data?.map((s) => (
          <div key={s.id} role="option" aria-selected={s.id === serverId} className={`list-row${s.id === serverId ? " active" : ""}`} onClick={() => ui.selectServer(s.id)} title={s.url}>
            <ServerDot id={s.id} />
            <span className="grow">{s.name}</span>
            <span className="hint">{s.url.replace(/^lore:\/\//, "")}</span>
          </div>
        ))}
      </div>

      <div className="group-title">
        <span className="grow">Repositories{repos.data ? ` (${repos.data.length})` : ""}</span>
        <button className="mini" disabled={!serverId} onClick={() => ui.setModal({ kind: "createRepo" })} title="Create a repository (lore repository create)">
          ＋ New
        </button>
      </div>
      {serverId && (
        <div style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
          <input className="input" style={{ width: "100%" }} placeholder="Filter repositories…" aria-label="Filter repositories" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      <div className="pane-body" role="listbox" aria-label="Repositories">
        {!serverId && <div className="empty">Select a server.</div>}
        {repos.isPending && serverId && <div className="empty">Loading repositories…</div>}
        {repos.isError && <div className="empty err-text">{repos.error.message}</div>}
        {repos.data && visible.length === 0 && <div className="empty">{filter ? "No match." : "No repositories on this server."}</div>}
        {visible.map((r) => (
          <div key={r.id} role="option" aria-selected={r.name === repo} className={`list-row${r.name === repo ? " active" : ""}`} onClick={() => ui.selectRepo(r.name === repo ? null : r.name)} title={r.description || r.url}>
            <span aria-hidden>▣</span>
            <span className="grow">{r.name}</span>
            {r.defaultBranch && <span className="hint">{r.defaultBranch}</span>}
          </div>
        ))}
      </div>
    </aside>
  );
}
