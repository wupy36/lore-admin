export function formatTime(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function relTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 45) return `${d} d ago`;
  return formatTime(ms).slice(0, 10);
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Same avatar scheme as lore-desktop's timeline (8 colors, stable per name). */
export function avatar(name: string | null): { initials: string; cls: string } {
  const n = name ?? "?";
  const parts = n.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { initials, cls: `avatar a${h % 8}` };
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
