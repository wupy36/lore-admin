import { useState } from "react";
import { api } from "../api/client";
import { errorText } from "../format";

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [user, setUser] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(user.trim(), password);
      onSignedIn();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="login-card" role="main">
        <h1 className="brand">
          Lore <span>Admin</span>
        </h1>
        <p className="hint">Sign in to manage your Lore servers.</p>
        <form className="form" onSubmit={(e) => void submit(e)}>
          <label>
            User
            <input className="input" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
          <label>
            Password
            <input className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="actions">
            <button className="btn primary" type="submit" disabled={busy || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
