// Typed HTTP client for src/shared/api.ts. Same-origin, relative URLs (works behind a
// reverse proxy under a sub-path); every POST carries
// the X-Lore-Admin header the server requires (CSRF guard).
import type { Channel, Input, Output, ServerEvent } from "@shared/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized = () => {};
export const setUnauthorizedHandler = (fn: Unauthorized) => (onUnauthorized = fn);

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-lore-admin": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as { ok: boolean; value?: T; error?: string };
  if (res.status === 401 && path.startsWith("api/call/")) onUnauthorized();
  if (!res.ok || !data.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
  return data.value as T;
}

export const api = {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- channels with no input take no argument
  call<C extends Channel>(channel: C, ...input: Input<C> extends void ? [] : [Input<C>]): Promise<Output<C>> {
    return post<Output<C>>(`api/call/${channel}`, input[0]);
  },
  async session(): Promise<{ user: string | null; authRequired: boolean }> {
    const res = await fetch("api/session", { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as { user: string | null; authRequired: boolean };
  },
  login: (user: string, password: string) => post<unknown>("api/login", { user, password }),
  logout: () => post<unknown>("api/logout", undefined),
  /** Server-sent events; reconnects automatically (EventSource). */
  events(onEvent: (e: ServerEvent) => void): () => void {
    const es = new EventSource("api/events", { withCredentials: true });
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data as string) as ServerEvent);
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  },
};
