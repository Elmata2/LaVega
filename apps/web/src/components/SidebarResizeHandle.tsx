import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";

const STEP = 16;
const STEP_SHIFT = 64;

export type SidebarResizeHandleProps = {
  /** Width shown now. */
  width: number;
  min: number;
  max: number;
  /** Live width while the pointer moves. Not persisted. */
  onDrag: (width: number) => void;
  /** Final width: pointer-up or a key press. This is the storage write. */
  onCommit: (width: number) => void;
  onReset: () => void;
};

/** The sidebar's right-edge drag handle (a WAI-ARIA window splitter). */
export function SidebarResizeHandle({
  width,
  min,
  max,
  onDrag,
  onCommit,
  onReset,
}: SidebarResizeHandleProps) {
  const [locale] = useAppLocale();
  const drag = useRef<{ x: number; width: number; last: number } | null>(null);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, width, last: width };
    drag.current = start;
    onDrag(width);
    const move = (ev: PointerEvent) => {
      start.last = clamp(start.width + ev.clientX - start.x);
      onDrag(start.last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      drag.current = null;
      onCommit(start.last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? STEP_SHIFT : STEP;
    switch (e.key) {
      case "ArrowRight":
        onCommit(clamp(width + step));
        break;
      case "ArrowLeft":
        onCommit(clamp(width - step));
        break;
      case "Home":
        onCommit(min);
        break;
      case "End":
        onCommit(max);
        break;
      case "Enter":
        onReset();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={shellCopy[locale].accountSidebar.resizeLabel}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="shell2-resize"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
