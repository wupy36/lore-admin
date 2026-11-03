// Console sign-in. Server mode: named admin accounts from LORE_ADMIN_USERS (or
// LORE_ADMIN_PASSWORD for a single "admin"), in-memory sessions, HttpOnly
// SameSite=Strict cookie, login throttling. Desktop mode: one random session
// minted at start and handed to the Electron window as a cookie.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const COOKIE = "lore_admin_session";
const SESSION_MS = 12 * 3600_000;
const FAIL_WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;

/** Accepts plain passwords or `scrypt$<saltHex>$<hashHex>` (see `scripts/hash-password.mjs`). */
export function checkPassword(stored: string, given: string): boolean {
  const m = /^scrypt\$([0-9a-f]+)\$([0-9a-f]+)$/i.exec(stored);
  if (m) {
    const want = Buffer.from(m[2] as string, "hex");
    const got = scryptSync(given, Buffer.from(m[1] as string, "hex"), want.length);
    return timingSafeEqual(want, got);
  }
  // Compare digests so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(stored).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
}

/** `alice:pw,bob:scrypt$…$…` (comma or newline separated). */
export function parseUsers(spec: string | undefined, singlePassword: string | undefined): Map<string, string> {
  const users = new Map<string, string>();
  for (const entry of (spec ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean)) {
    const i = entry.indexOf(":");
    if (i <= 0 || i === entry.length - 1) throw new Error(`LORE_ADMIN_USERS: expected user:password, got "${entry.slice(0, 40)}"`);
    users.set(entry.slice(0, i).trim(), entry.slice(i + 1));
  }
  if (singlePassword) users.set("admin", singlePassword);
  return users;
}

export class Auth {
  private sessions = new Map<string, { user: string; expires: number }>();
  private fails = new Map<string, { count: number; since: number }>();

  /** `users` empty + `required` false = no sign-in (desktop / --no-auth). */
  constructor(
    private readonly users: Map<string, string>,
    readonly required: boolean,
  ) {}

  /** Session for a user without a password check (desktop window). */
  mint(user: string): string {
    const id = randomBytes(32).toString("base64url");
    this.sessions.set(id, { user, expires: Date.now() + SESSION_MS });
    return id;
  }

  login(user: string, password: string, ip: string): { ok: true; session: string } | { ok: false; error: string; status: number } {
    const now = Date.now();
    const f = this.fails.get(ip);
    if (f && now - f.since < FAIL_WINDOW_MS && f.count >= MAX_FAILS) return { ok: false, error: "Too many failed sign-ins. Try again later.", status: 429 };
    const stored = this.users.get(user);
    // Always run a comparison so unknown users take as long as wrong passwords.
    const ok = checkPassword(stored ?? "\u0000invalid", password) && stored !== undefined;
    if (!ok) {
      const cur = f && now - f.since < FAIL_WINDOW_MS ? f : { count: 0, since: now };
      cur.count++;
      this.fails.set(ip, cur);
      return { ok: false, error: "Wrong user name or password", status: 401 };
    }
    this.fails.delete(ip);
    return { ok: true, session: this.mint(user) };
  }

  /** User for a session cookie; null when signed out or expired. Sliding expiry. */
  user(session: string | undefined): string | null {
    if (!this.required) return "local";
    if (!session) return null;
    const s = this.sessions.get(session);
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.sessions.delete(session);
      return null;
    }
    s.expires = Date.now() + SESSION_MS;
    return s.user;
  }

  logout(session: string | undefined): void {
    if (session) this.sessions.delete(session);
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(value: string, secure: boolean, maxAgeSec = SESSION_MS / 1000): string {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}
