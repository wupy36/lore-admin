import { useUi, type UiState } from "../store/ui";

type Key = keyof UiState["layout"];

/** Drag handle that resizes one layout dimension. `sign` flips direction for panes anchored right/bottom. */
export function Splitter({ k, axis, sign, className }: { k: Key; axis: "x" | "y"; sign: 1 | -1; className: string }) {
  const onPointerDown = (e: React.PointerEvent) => {
    const start = axis === "x" ? e.clientX : e.clientY;
    const base = useUi.getState().layout[k];
    const el = e.currentTarget as HTMLDivElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => useUi.getState().setLayout({ [k]: base + sign * ((axis === "x" ? ev.clientX : ev.clientY) - start) });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return <div className={className} onPointerDown={onPointerDown} role="separator" aria-orientation={axis === "x" ? "vertical" : "horizontal"} />;
}
