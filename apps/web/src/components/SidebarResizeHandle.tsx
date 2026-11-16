import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  /** Id of the sidebar element this handle resizes (aria-controls). */
  controls: string;
  /** Which edge of its panel the handle sits on. `left` (the assistant column)
   *  inverts the drag delta and the arrow keys: dragging left widens. */
  edge?: "right" | "left";
};

/** The sidebar's right-edge drag handle (a WAI-ARIA window splitter). */
export function SidebarResizeHandle({
  width,
  min,
  max,
  onDrag,
  onCommit,
  onReset,
  controls,
  edge = "right",
}: SidebarResizeHandleProps) {
  const [locale] = useAppLocale();
  const dir = edge === "left" ? -1 : 1;
  const drag = useRef<{ x: number; width: number; last: number } | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, width, last: width };
    drag.current = start;
    onDrag(width);
    const move = (ev: PointerEvent) => {
      start.last = clamp(start.width + dir * (ev.clientX - start.x));
      onDrag(start.last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      drag.current = null;
      stop.current = null;
      onCommit(start.last);
    };
    /* Unmount mid-drag: drop the listeners, commit nothing. */
    stop.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? STEP_SHIFT : STEP;
    switch (e.key) {
      case "ArrowRight":
        onCommit(clamp(width + dir * step));
        break;
      case "ArrowLeft":
        onCommit(clamp(width - dir * step));
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
      aria-controls={controls}
      aria-label={
        edge === "left"
          ? shellCopy[locale].frame.assistantResizeLabel
          : shellCopy[locale].accountSidebar.resizeLabel
      }
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={edge === "left" ? "shell2-resize shell2-resize-left" : "shell2-resize"}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
