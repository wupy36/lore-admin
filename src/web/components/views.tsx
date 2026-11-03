// The center pane views. Each is a filterable table; selecting a row fills the
// detail pane, actions live on the row and in the detail pane.
import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { shortHash, type Lock } from "@shared/types";
import { keys, useAudit, useBranches, useCall, useHistory, useLocks, useRepos, useServerStatus, useServers } from "../api/queries";
import { avatar, formatTime, relTime } from "../format";
import { lockKey, useUi } from "../store/ui";

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

// ---------------- Overview (p4 info + p4 depots) ----------------

export function OverviewView() {
  const { serverId, repo } = useUi();
  const ui = useUi.getState();
  const server = useServers().data?.find((s) => s.id === serverId);
  const status = useServerStatus(serverId);
  const repos = useRepos(serverId);
  if (!serverId || !server) return <Empty>Select or add a Lore server on the left.</Empty>;
  const s = status.data;
  const current = repos.data?.find((r) => r.name === repo);

  return (
    <div className="pane-body">
      <div className="section-title">
        <span className="grow">{server.name}</span>
        <button className="mini" onClick={() => void status.refetch()} disabled={status.isFetching}>
          {status.isFetching ? "Checking…" : "Check now"}
        </button>
        {!server.managed && (
          <button className="mini" onClick={() => ui.setModal({ kind: "server", id: server.id })}>
            Edit server…
          </button>
        )}
      </div>
      <div className="cards">
        <div className="card">
          <div className="k">Connection</div>
          <div className={`v ${s ? (s.reachable ? "ok-text" : "err-text") : ""}`}>{status.isPending ? "…" : s?.reachable ? "Reachable" : "Unreachable"}</div>
          <div className="s mono">{server.url}</div>
        </div>
        <div className="card">
          <div className="k">Latency</div>
          <div className="v">{s?.latencyMs != null ? `${s.latencyMs} ms` : "—"}</div>
          <div className="s">repository list round trip</div>
        </div>
        <div className="card">
          <div className="k">Health check</div>
          <div className={`v ${s?.health === "ok" ? "ok-text" : s?.health === "unavailable" ? "err-text" : ""}`}>{s ? { ok: "Healthy", unavailable: "Failing", unknown: "Not set" }[s.health] : "…"}</div>
          <div className="s">{s?.healthDetail ?? ""}</div>
        </div>
        <div className="card">
          <div className="k">Repositories</div>
          <div className="v">{s?.repositoryCount ?? "—"}</div>
          <div className="s">on this server</div>
        </div>
        <div className="card">
          <div className="k">Acting as</div>
          <div className="v">{s?.user?.name ?? server.identity ?? "anonymous"}</div>
          <div className="s">{s?.user ? s.user.id : server.hasToken ? "token configured" : "no token"}</div>
        </div>
        <div className="card">
          <div className="k">Last checked</div>
          <div className="v">{s ? relTime(s.checkedAt) : "—"}</div>
          <div className="s">{s ? formatTime(s.checkedAt) : ""}</div>
        </div>
      </div>
      {s?.error && <div className="note error">{s.error}</div>}
      {s?.authNote && <div className={`note${/No authentication/.test(s.authNote) ? " warn" : ""}`}>{s.authNote}</div>}

      {current && (
        <>
          <div className="section-title">
            <span className="grow">Repository · {current.name}</span>
            <button className="mini" onClick={() => ui.setTab("branches")}>
              Branches
            </button>
            <button className="mini" onClick={() => ui.setTab("locks")}>
              Locks
            </button>
            <button className="btn danger sm" style={{ height: 20, fontSize: 11 }} onClick={() => ui.setModal({ kind: "deleteRepo", repo: current.name })}>
              Delete…
            </button>
          </div>
          <dl className="kv" style={{ gridTemplateColumns: "120px 1fr", padding: "4px 10px" }}>
            <dt>URL</dt>
            <dd className="mono">{current.url}</dd>
            <dt>ID</dt>
            <dd className="mono">{current.id}</dd>
            <dt>Description</dt>
            <dd>{current.description || "—"}</dd>
            <dt>Default branch</dt>
            <dd>{current.defaultBranch ?? "—"}</dd>
            <dt>Created</dt>
            <dd>
              {formatTime(current.created) || "—"}
              {current.creator ? ` by ${current.creator}` : ""}
            </dd>
          </dl>
        </>
      )}

      <div className="section-title">
        <span className="grow">Repositories</span>
        <button className="mini" onClick={() => ui.setModal({ kind: "createRepo" })}>
          ＋ New repository
        </button>
      </div>
      {repos.isError && <div className="note error">{repos.error.message}</div>}
      <table className="table" aria-label="Repositories">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Default branch</th>
            <th>Created</th>
            <th>Creator</th>
          </tr>
        </thead>
        <tbody>
          {repos.data?.map((r) => (
            <tr key={r.id} aria-selected={r.name === repo} onClick={() => ui.selectRepo(r.name)} onDoubleClick={() => (ui.selectRepo(r.name), ui.setTab("branches"))}>
              <td>{r.name}</td>
              <td className="cell dim">{r.description}</td>
              <td>{r.defaultBranch ?? ""}</td>
              <td className="dim">{formatTime(r.created)}</td>
              <td className="dim">{r.creator ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {repos.data?.length === 0 && <Empty>No repositories yet.</Empty>}
    </div>
  );
}

// ---------------- Branches (p4 streams) ----------------

export function BranchesView() {
  const { serverId, repo, detail } = useUi();
  const ui = useUi.getState();
  const q = useBranches(serverId, repo);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState("");
  const rows = (q.data ?? []).filter((b) => (showArchived || !b.archived) && b.name.toLowerCase().includes(filter.toLowerCase()));
  const archivedCount = (q.data ?? []).filter((b) => b.archived).length;

  return (
    <>
      <div className="filters">
        <input className="input" placeholder="Filter branches…" aria-label="Filter branches" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="row hint">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived ({archivedCount})
        </label>
        <span className="tspacer" />
        <button className="btn" onClick={() => ui.setModal({ kind: "createBranch" })}>
          ＋ New branch
        </button>
      </div>
      <div className="pane-body">
        {q.isPending && <Empty>Loading branches… (the first visit to a repository makes a bare mirror of it)</Empty>}
        {q.isError && <div className="note error">{q.error.message}</div>}
        {q.data && (
          <table className="table" aria-label="Branches">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Latest</th>
                <th>Created</th>
                <th>Creator</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className={b.archived ? "archived" : undefined} aria-selected={detail?.kind === "branch" && detail.name === b.name} onClick={() => ui.setDetail({ kind: "branch", name: b.name })} onDoubleClick={() => (ui.setBranch(b.name), ui.setTab("history"))}>
                  <td>
                    {b.name} {b.isDefault && <span className="badge">default</span>} {b.archived && <span className="badge">archived</span>}
                  </td>
                  <td className="mono dim">{shortHash(b.latestHash)}</td>
                  <td className="dim">{formatTime(b.created)}</td>
                  <td className="dim">{b.creator ?? ""}</td>
                  <td className="act">
                    <button className="mini" onClick={(e) => (e.stopPropagation(), ui.setBranch(b.name), ui.setTab("history"))}>
                      History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {q.data && rows.length === 0 && <Empty>No branches match.</Empty>}
      </div>
    </>
  );
}

// ---------------- History (p4 changes) ----------------

export function HistoryView() {
  const { serverId, repo, branch, detail } = useUi();
  const ui = useUi.getState();
  const branches = useBranches(serverId, repo);
  const def = branches.data?.find((b) => b.isDefault)?.name ?? branches.data?.[0]?.name ?? null;
  const current = branch ?? def;
  const q = useHistory(serverId, repo, current);
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const f = filter.toLowerCase();
    return (q.data ?? []).filter((r) => !f || r.message.toLowerCase().includes(f) || (r.author ?? "").toLowerCase().includes(f) || r.hash.startsWith(f) || String(r.number) === f);
  }, [q.data, filter]);
  const ref = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => 40, overscan: 12 });

  return (
    <>
      <div className="filters">
        <select className="input" aria-label="Branch" value={current ?? ""} onChange={(e) => ui.setBranch(e.target.value)}>
          {(branches.data ?? []).map((b) => (
            <option key={b.id} value={b.name}>
              {b.name}
              {b.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <input className="input" style={{ minWidth: 220 }} placeholder="Filter by message, author, #number, hash…" aria-label="Filter revisions" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="tspacer" />
        <span className="hint">{q.data ? `${rows.length} of ${q.data.length} revision(s)` : ""}</span>
      </div>
      <div ref={ref} className="pane-body" style={{ background: "var(--bg-0)" }} role="listbox" aria-label="Revisions">
        {(q.isPending || branches.isPending) && <Empty>Loading history…</Empty>}
        {q.isError && <div className="note error">{q.error.message}</div>}
        {q.data?.length === 0 && <Empty>No revisions on this branch yet.</Empty>}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            if (!r) return null;
            const a = avatar(r.author);
            const active = detail?.kind === "revision" && detail.hash === r.hash;
            return (
              <div key={r.hash} role="option" aria-selected={active} className={`rev-row${active ? " active" : ""}`} style={{ transform: `translateY(${vi.start}px)`, display: "flex", gap: 8, alignItems: "center" }} onClick={() => ui.setDetail({ kind: "revision", hash: r.hash })}>
                <span className={a.cls} title={r.author ?? "unknown author"}>
                  {a.initials}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="rev-msg">{r.message || <span className="hint">(no message)</span>}</div>
                  <div className="hint" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    #{r.number} · {r.author ?? "unknown"} · {relTime(r.timestamp)} · <span className="mono">{shortHash(r.hash)}</span>
                    {r.branch && r.branch !== current ? ` · from ${r.branch}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ---------------- Locks (p4 opened -a / p4 unlock -f) ----------------

export function LocksView() {
  const { serverId, repo, detail } = useUi();
  const ui = useUi.getState();
  const branches = useBranches(serverId, repo);
  const [branch, setBranch] = useState("");
  const [owner, setOwner] = useState("");
  const [path, setPath] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const q = useLocks(serverId, repo, { ...(branch ? { branch } : {}) });
  const rows = (q.data ?? []).filter((l) => (!owner || l.owner.toLowerCase().includes(owner.toLowerCase())) && (!path || l.path.toLowerCase().includes(path.toLowerCase())));
  const owners = new Map<string, number>();
  for (const l of q.data ?? []) owners.set(l.owner, (owners.get(l.owner) ?? 0) + 1);
  const chosen: Lock[] = rows.filter((l) => selected.has(lockKey(l)));
  const toggle = (k: string) => setSelected((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  return (
    <>
      <div className="filters">
        <select className="input" aria-label="Lock branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">All branches</option>
          {(branches.data ?? [])
            .filter((b) => !b.archived)
            .map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
        </select>
        <input className="input" placeholder="Owner…" aria-label="Filter owner" list="lock-owners" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <datalist id="lock-owners">
          {[...owners.keys()].map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <input className="input" placeholder="Path…" aria-label="Filter path" value={path} onChange={(e) => setPath(e.target.value)} />
        <span className="tspacer" />
        <span className="hint" title="Lore locks are advisory: storage, push and merge never consult them.">
          advisory ⓘ
        </span>
        <button className="btn danger" disabled={!chosen.length} onClick={() => ui.setModal({ kind: "releaseLocks", locks: chosen })}>
          Release {chosen.length || ""} lock{chosen.length === 1 ? "" : "s"}…
        </button>
      </div>
      <div className="pane-body">
        {q.isPending && <Empty>Querying locks…</Empty>}
        {q.isError && <div className="note error">{q.error.message}</div>}
        {q.data && (
          <table className="table" aria-label="Locks">
            <thead>
              <tr>
                <th className="act">
                  <input type="checkbox" aria-label="Select all locks" checked={!!rows.length && chosen.length === rows.length} onChange={(e) => setSelected(new Set(e.target.checked ? rows.map(lockKey) : []))} />
                </th>
                <th>Path</th>
                <th>Owner</th>
                <th>Branch</th>
                <th>Locked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const k = lockKey(l);
                return (
                  <tr key={k} aria-selected={detail?.kind === "lock" && detail.key === k} onClick={() => ui.setDetail({ kind: "lock", key: k })}>
                    <td className="act" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${l.path}`} checked={selected.has(k)} onChange={() => toggle(k)} />
                    </td>
                    <td className="mono">
                      <span className="lock">🔒</span> {l.path}
                    </td>
                    <td>{l.owner}</td>
                    <td className="dim">{l.branch}</td>
                    <td className="dim" title={formatTime(l.lockedAt)}>
                      {relTime(l.lockedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {q.data && rows.length === 0 && <Empty>{q.data.length ? "No locks match the filter." : "No locks held."}</Empty>}
      </div>
    </>
  );
}

// ---------------- Audit log ----------------

export function AuditView() {
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState("");
  const q = useAudit(!all);
  const { detail } = useUi();
  const ui = useUi.getState();
  const f = filter.toLowerCase();
  const rows = (q.data ?? []).filter((e) => !f || `${e.actor} ${e.op} ${e.command ?? ""} ${e.message} ${e.server ?? ""}`.toLowerCase().includes(f));
  return (
    <>
      <div className="filters">
        <input className="input" style={{ minWidth: 240 }} placeholder="Filter by user, command, result…" aria-label="Filter audit log" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="row hint">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Include read-only calls (this run only)
        </label>
        <span className="tspacer" />
        <button className="mini" onClick={() => void q.refetch()}>
          ⟳
        </button>
      </div>
      <div className="pane-body">
        {q.isError && <div className="note error">{q.error.message}</div>}
        <table className="table" aria-label="Audit log">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Command</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} aria-selected={detail?.kind === "audit" && detail.id === e.id} onClick={() => ui.setDetail({ kind: "audit", id: e.id })}>
                <td className="dim">{formatTime(e.ts)}</td>
                <td>{e.actor}</td>
                <td>{e.op}</td>
                <td className="mono" title={e.command ?? ""}>
                  {e.command ?? ""}
                </td>
                <td className={e.ok ? "ok-text" : "err-text"} title={e.message}>
                  {e.ok ? "✓" : "✗"} {e.message}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data && rows.length === 0 && <Empty>{all ? "Nothing logged yet." : "No changes have been made through this console yet."}</Empty>}
      </div>
    </>
  );
}

/** Invalidation lists shared by dialogs and the detail pane. */
export const inval = {
  repos: (s: string) => [keys.repos(s), keys.status(s), keys.audit],
  branches: (s: string, r: string) => [keys.branches(s, r), ["history", s, r], keys.audit],
  locks: (s: string, r: string) => [["locks", s, r], keys.audit],
};
export { useCall };
