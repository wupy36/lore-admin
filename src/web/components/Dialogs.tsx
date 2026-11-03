import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys, useBranches, useServers } from "../api/queries";
import { errorText } from "../format";
import { useUi, type Modal as ModalState } from "../store/ui";
import { Modal } from "./Modal";
import { inval, useCall } from "./views";

function Err({ e }: { e: unknown }) {
  return e ? (
    <div className="form-error" role="alert">
      {errorText(e)}
    </div>
  ) : null;
}

function ServerDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = useServers().data?.find((s) => s.id === id);
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "lore://");
  const [healthUrl, setHealthUrl] = useState(existing?.healthUrl ?? "");
  const [identity, setIdentity] = useState(existing?.identity ?? "");
  const [token, setToken] = useState<string | undefined>(undefined);
  const add = useCall("servers:add", () => [keys.servers]);
  const update = useCall("servers:update", () => [keys.servers]);
  const remove = useCall("servers:remove", () => [keys.servers]);
  const m = id ? update : add;
  const suggestHealth = () => {
    const host = /^lore:\/\/([^:/]+)/.exec(url)?.[1];
    if (host && !healthUrl) setHealthUrl(`http://${host}:41339/health_check`);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = { name, url, healthUrl, identity, ...(token !== undefined ? { token } : {}) };
    const p = id ? await update.mutateAsync({ id, ...input }) : await add.mutateAsync(input);
    void qc.invalidateQueries({ queryKey: keys.status(p.id) });
    useUi.getState().selectServer(p.id);
    onClose();
  };
  return (
    <Modal title={id ? "Edit server" : "Add Lore server"} onClose={onClose} width={520}>
      <form className="form" onSubmit={(e) => void submit(e).catch(() => undefined)}>
        <label>
          Name
          <input className="input" required placeholder="Studio" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Server URL
          <input className="input mono" required placeholder="lore://lore.studio.lan:41337" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={suggestHealth} />
        </label>
        <label>
          Health check URL (optional)
          <input className="input mono" placeholder="http://lore.studio.lan:41339/health_check" value={healthUrl} onChange={(e) => setHealthUrl(e.target.value)} />
        </label>
        <label>
          Identity for changes (unauthenticated servers)
          <input className="input" placeholder="admin@studio" value={identity} onChange={(e) => setIdentity(e.target.value)} />
        </label>
        <label>
          Identity token (authenticated servers){existing?.hasToken ? " — a token is stored; leave untouched to keep it" : ""}
          <input className="input mono" type="password" autoComplete="off" placeholder={existing?.hasToken ? "••••••••  (type to replace, clear to remove)" : "optional"} value={token ?? ""} onChange={(e) => setToken(e.target.value)} />
        </label>
        <Err e={m.error} />
        <div className="actions">
          {id && (
            <button
              type="button"
              className="btn danger"
              style={{ marginRight: "auto" }}
              onClick={() =>
                void remove
                  .mutateAsync({ id })
                  .then(() => (useUi.getState().selectServer(null), onClose()))
                  .catch(() => undefined)
              }
            >
              Remove server
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={m.isPending}>
            {id ? "Save" : "Add server"}
          </button>
        </div>
        <p className="hint">Tokens are stored on the console host only (data/servers.json, mode 600) and are never sent back to the browser.</p>
      </form>
    </Modal>
  );
}

function CreateRepoDialog({ onClose }: { onClose: () => void }) {
  const { serverId } = useUi();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const m = useCall("repos:create", (i) => inval.repos(i.serverId));
  if (!serverId) return null;
  return (
    <Modal title="New repository" onClose={onClose} width={480}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void m
            .mutateAsync({ serverId, name, description })
            .then((r) => (useUi.getState().selectRepo(r.name), onClose()))
            .catch(() => undefined);
        }}
      >
        <label>
          Name
          <input className="input" required placeholder="ShooterGame" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Description
          <input className="input" placeholder="optional" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <Err e={m.error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={m.isPending || !name.trim()}>
            {m.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteRepoDialog({ repo, onClose }: { repo: string; onClose: () => void }) {
  const { serverId } = useUi();
  const [confirm, setConfirm] = useState("");
  const m = useCall("repos:delete", (i) => inval.repos(i.serverId));
  if (!serverId) return null;
  return (
    <Modal title="Delete repository" onClose={onClose} width={480}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void m
            .mutateAsync({ serverId, repo, confirm })
            .then(() => (useUi.getState().selectRepo(null), onClose()))
            .catch(() => undefined);
        }}
      >
        <div className="note error" style={{ margin: 0 }}>
          This permanently deletes <b>{repo}</b> and all of its branches and history from the server. Existing clones stop syncing. This cannot be undone.
        </div>
        <label>
          Type <b className="mono">{repo}</b> to confirm
          <input className="input mono" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <Err e={m.error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" type="submit" disabled={confirm !== repo || m.isPending}>
            {m.isPending ? "Deleting…" : "Delete repository"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateBranchDialog({ from, onClose }: { from?: string; onClose: () => void }) {
  const { serverId, repo } = useUi();
  const branches = useBranches(serverId, repo).data ?? [];
  const [name, setName] = useState("");
  const [base, setBase] = useState(from ?? branches.find((b) => b.isDefault)?.name ?? "");
  const m = useCall("branches:create", (i) => inval.branches(i.serverId, i.repo));
  if (!serverId || !repo) return null;
  return (
    <Modal title={`New branch in ${repo}`} onClose={onClose} width={480}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void m
            .mutateAsync({ serverId, repo, name, ...(base ? { from: base } : {}) })
            .then((b) => (useUi.getState().setDetail({ kind: "branch", name: b.name }), onClose()))
            .catch(() => undefined);
        }}
      >
        <label>
          Name
          <input className="input" required placeholder="feature/weapon-sway" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          From the latest revision of
          <select className="input" value={base} onChange={(e) => setBase(e.target.value)}>
            {branches
              .filter((b) => !b.archived)
              .map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        <Err e={m.error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={m.isPending || !name.trim()}>
            {m.isPending ? "Creating…" : "Create & push"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReleaseLocksDialog({ locks, onClose }: { locks: { path: string; owner: string; branch: string }[]; onClose: () => void }) {
  const { serverId, repo } = useUi();
  const m = useCall("locks:release", (i) => inval.locks(i.serverId, i.repo));
  const [result, setResult] = useState<string | null>(null);
  if (!serverId || !repo) return null;
  // One release call per (branch, owner) group.
  const groups = new Map<string, { branch: string; owner: string; paths: string[] }>();
  for (const l of locks) {
    const k = `${l.branch}\u0000${l.owner}`;
    const g = groups.get(k) ?? { branch: l.branch, owner: l.owner, paths: [] };
    g.paths.push(l.path);
    groups.set(k, g);
  }
  const run = async () => {
    let released = 0;
    let missing = 0;
    for (const g of groups.values()) {
      const r = await m.mutateAsync({ serverId, repo, ...g });
      released += r.released.length;
      missing += r.notFound.length;
    }
    useUi.getState().setDetail(null);
    if (missing) setResult(`${released} released, ${missing} not found (already released?)`);
    else onClose();
  };
  return (
    <Modal title="Force release locks" onClose={onClose} width={560}>
      <div className="form">
        <div className="note warn" style={{ margin: 0 }}>
          Releases {locks.length} lock(s) held by {[...new Set(locks.map((l) => l.owner))].join(", ")}. The owners are not notified; their local edits are kept.
        </div>
        <ul className="file-list" style={{ maxHeight: 200, overflow: "auto" }}>
          {locks.map((l) => (
            <li key={`${l.branch}/${l.owner}/${l.path}`}>
              <span className="lock">🔒</span> {l.path} <span className="hint">· {l.owner} · {l.branch}</span>
            </li>
          ))}
        </ul>
        {result && <div className="note">{result}</div>}
        <Err e={m.error} />
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button className="btn danger" disabled={m.isPending} onClick={() => void run().catch(() => undefined)}>
              {m.isPending ? "Releasing…" : "Release"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ConfirmDialog({ m, onClose }: { m: Extract<ModalState, { kind: "confirm" }>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal title={m.title} onClose={onClose} width={440}>
      <div className="form">
        <p style={{ margin: 0 }}>{m.body}</p>
        <Err e={error} />
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${m.danger ? "danger" : "primary"}`}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              m.run().then(onClose, (e: unknown) => (setError(e), setBusy(false)));
            }}
          >
            {m.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const modal = useUi((s) => s.modal);
  const close = () => useUi.getState().setModal(null);
  if (!modal) return null;
  switch (modal.kind) {
    case "server":
      return <ServerDialog id={modal.id} onClose={close} />;
    case "createRepo":
      return <CreateRepoDialog onClose={close} />;
    case "deleteRepo":
      return <DeleteRepoDialog repo={modal.repo} onClose={close} />;
    case "createBranch":
      return <CreateBranchDialog from={modal.from} onClose={close} />;
    case "releaseLocks":
      return <ReleaseLocksDialog locks={modal.locks} onClose={close} />;
    case "confirm":
      return <ConfirmDialog m={modal} onClose={close} />;
  }
}
