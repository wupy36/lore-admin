import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatTime } from "../format";
import { useUi } from "../store/ui";

/** Live log of every Lore call (all console users), with the equivalent CLI command. Same look as lore-desktop's console. */
export function Console() {
  const log = useUi((s) => s.log);
  const ref = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: log.length, getScrollElement: () => ref.current, estimateSize: () => 20, overscan: 10 });
  const stick = useRef(true);
  useEffect(() => {
    if (stick.current && log.length) virt.scrollToIndex(log.length - 1, { align: "end" });
  }, [log.length, virt]);

  return (
    <section className="pane bottom" aria-label="Console">
      <div className="pane-header">
        <span>Console</span>
        <span className="hint">every Lore call with its CLI equivalent</span>
        <span className="tspacer" />
        <button className="modal-close" aria-label="Hide console" onClick={() => useUi.getState().toggleConsole()}>
          ✕
        </button>
      </div>
      <div
        ref={ref}
        className="pane-body"
        style={{ background: "var(--bg-0)" }}
        role="log"
        aria-label="Console log"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
        }}
      >
        {log.length === 0 && <div className="empty">Lore calls made through the console appear here.</div>}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const e = log[vi.index];
            if (!e) return null;
            return (
              <div key={e.id} className={`log-row${e.ok ? "" : " error"}`} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }} title={e.server ?? ""} onClick={() => useUi.getState().setDetail({ kind: "audit", id: e.id })}>
                <span className="t">{formatTime(e.ts).slice(11)}</span>
                <span className="b" style={{ width: 70, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {e.actor}
                </span>
                <span className="c">
                  {e.mutating && <span className="warn-text">● </span>}
                  {e.command ?? e.op} <span style={{ color: "var(--text-faint)" }}>→ {e.message}</span>
                </span>
                <span className="d">{e.durationMs} ms</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
