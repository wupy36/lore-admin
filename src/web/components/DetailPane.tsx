import { shortHash } from "@shared/types";
import { useAudit, useBranches, useLocks, useRevision } from "../api/queries";
import { formatSize, formatTime, relTime } from "../format";
import { lockKey, useUi } from "../store/ui";
import { inval, useCall } from "./views";

const copy = (s: string) => void navigator.clipboard?.writeText(s);

function BranchDetail({ name }: { name: string }) {
  const { serverId, repo } = useUi();
  const ui = useUi.getState();
  const b = useBranches(serverId, repo).data?.find((x) => x.name === name);
  const action = useCall("branches:action", (i) => inval.branches(i.serverId, i.repo));
  if (!b || !serverId || !repo) return <div className="empty">Branch not found.</div>;
  const run = (a: "protect" | "unprotect" | "archive") => action.mutate({ serverId, repo, name, action: a });
  return (
    <div className="detail-body">
      <h2>{b.name}</h2>
      <dl className="kv" style={{ padding: 0 }}>
        <dt>ID</dt>
        <dd className="mono">{b.id}</dd>
        <dt>Latest</dt>
        <dd className="mono">{b.latestHash ?? "—"}</dd>
        <dt>Created</dt>
        <dd>
          {formatTime(b.created) || "—"} {b.creator ? `by ${b.creator}` : ""}
        </dd>
        <dt>State</dt>
        <dd>{[b.isDefault && "default", b.archived ? "archived" : "active"].filter(Boolean).join(", ")}</dd>
      </dl>
      <div className="detail-actions">
        <button className="btn" onClick={() => (ui.setBranch(b.name), ui.setTab("history"))}>
          History
        </button>
        <button className="btn" onClick={() => ui.setModal({ kind: "createBranch", from: b.name })}>
          Branch from here…
        </button>
        <button className="btn" disabled={action.isPending} onClick={() => run("protect")} title="Prevent pushes that rewrite or delete the branch (lore branch protect)">
          Protect
        </button>
        <button className="btn" disabled={action.isPending} onClick={() => run("unprotect")}>
          Unprotect
        </button>
        <button
          className="btn danger"
          disabled={b.isDefault || b.archived || action.isPending}
          title={b.isDefault ? "The default branch cannot be archived" : "Hide the branch from listings (lore branch archive)"}
          onClick={() => ui.setModal({ kind: "confirm", title: "Archive branch", body: `Archive "${b.name}"? It disappears from branch lists; revisions are kept.`, confirmLabel: "Archive", danger: true, run: () => action.mutateAsync({ serverId, repo, name, action: "archive" }) })}
        >
          Archive…
        </button>
      </div>
      {action.isSuccess && <div className="note">Done: {action.variables?.action}.</div>}
      {action.isError && <div className="note error">{action.error.message}</div>}
      <p className="hint">Lore does not report whether a branch is protected; Protect/Unprotect set it explicitly.</p>
    </div>
  );
}

function RevisionDetailView({ hash }: { hash: string }) {
  const { serverId, repo } = useUi();
  const q = useRevision(serverId, repo, hash);
  if (q.isPending) return <div className="empty">Loading revision…</div>;
  if (q.isError) return <div className="note error" style={{ margin: 8 }}>{q.error.message}</div>;
  const r = q.data;
  return (
    <div className="detail-body">
      <h2>
        #{r.number} {r.message.split("\n")[0]}
      </h2>
      <dl className="kv" style={{ padding: 0 }}>
        <dt>Hash</dt>
        <dd className="mono" onDoubleClick={() => copy(r.hash)} title="Double-click to copy">
          {r.hash}
        </dd>
        <dt>Author</dt>
        <dd>{r.author ?? "unknown (unauthenticated server)"}</dd>
        <dt>Date</dt>
        <dd>
          {formatTime(r.timestamp)} ({relTime(r.timestamp)})
        </dd>
        <dt>Branch</dt>
        <dd>{r.branch}</dd>
        <dt>Parents</dt>
        <dd className="mono">{r.parents.map(shortHash).join(", ") || "—"}</dd>
      </dl>
      {r.message.includes("\n") && <pre className="code" style={{ whiteSpace: "pre-wrap" }}>{r.message}</pre>}
      <div className="section-title" style={{ padding: "10px 0 4px" }}>
        Files ({r.files.length})
      </div>
      <ul className="file-list">
        {r.files.map((f) => (
          <li key={f.path} title={f.fromPath ? `from ${f.fromPath}` : f.path}>
            <span className={`act-${f.action}`} style={{ width: 52, flex: "none" }}>
              {f.action}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{f.path}</span>
            <span className="hint">{f.action === "delete" ? "" : formatSize(f.size)}</span>
          </li>
        ))}
      </ul>
      <div className="detail-actions">
        <button className="btn" onClick={() => copy(r.hash)}>
          Copy hash
        </button>
        <button className="btn" onClick={() => copy(`${r.branch}@${r.number}`)}>
          Copy {r.branch}@{r.number}
        </button>
      </div>
    </div>
  );
}

function LockDetail({ k }: { k: string }) {
  const { serverId, repo } = useUi();
  const ui = useUi.getState();
  const l = useLocks(serverId, repo, {}).data?.find((x) => lockKey(x) === k);
  if (!l) return <div className="empty">Lock released or filtered out.</div>;
  return (
    <div className="detail-body">
      <h2 className="mono">🔒 {l.path}</h2>
      <dl className="kv" style={{ padding: 0 }}>
        <dt>Owner</dt>
        <dd>{l.owner}</dd>
        <dt>Branch</dt>
        <dd>{l.branch}</dd>
        <dt>Locked</dt>
        <dd>
          {formatTime(l.lockedAt) || "—"} {l.lockedAt ? `(${relTime(l.lockedAt)})` : ""}
        </dd>
      </dl>
      <div className="detail-actions">
        <button className="btn danger" onClick={() => ui.setModal({ kind: "releaseLocks", locks: [l] })}>
          Force release…
        </button>
      </div>
      <p className="hint">Locks are advisory in Lore: they warn other users but storage, push and merge never consult them.</p>
    </div>
  );
}

function AuditDetail({ id }: { id: string }) {
  const e = useAudit(false).data?.find((x) => x.id === id) ?? useUi.getState().log.find((x) => x.id === id);
  if (!e) return <div className="empty">Entry not found.</div>;
  return (
    <div className="detail-body">
      <h2>{e.op}</h2>
      <dl className="kv" style={{ padding: 0 }}>
        <dt>Time</dt>
        <dd>{formatTime(e.ts)}</dd>
        <dt>User</dt>
        <dd>{e.actor}</dd>
        <dt>Server</dt>
        <dd className="mono">{e.server ?? "—"}</dd>
        <dt>Result</dt>
        <dd className={e.ok ? "ok-text" : "err-text"}>{e.message}</dd>
        <dt>Duration</dt>
        <dd>{e.durationMs} ms</dd>
      </dl>
      {e.command && (
        <>
          <div className="hint" style={{ margin: "8px 0 4px" }}>
            Equivalent CLI command
          </div>
          <code className="code">{e.command}</code>
        </>
      )}
    </div>
  );
}

export function DetailPane() {
  const detail = useUi((s) => s.detail);
  return (
    <aside className="pane detail" aria-label="Details">
      <div className="pane-header">
        <span>Details</span>
        <span className="tspacer" />
        {detail && (
          <button className="modal-close" aria-label="Close details" onClick={() => useUi.getState().setDetail(null)}>
            ✕
          </button>
        )}
      </div>
      {!detail && <div className="empty">Select a row to see details and actions.</div>}
      {detail?.kind === "branch" && <BranchDetail name={detail.name} />}
      {detail?.kind === "revision" && <RevisionDetailView hash={detail.hash} />}
      {detail?.kind === "lock" && <LockDetail k={detail.key} />}
      {detail?.kind === "audit" && <AuditDetail id={detail.id} />}
    </aside>
  );
}
