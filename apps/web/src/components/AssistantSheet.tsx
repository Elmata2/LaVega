import { useEffect, useId, useRef, type ReactNode } from "react";
import { trapTab } from "./focusTrap.js";

/* The assistant on the phone (< 1024px): a right-hand modal sheet, full height.
 * Same mechanics as ShellDrawer: always mounted so the slide and the fade are
 * plain CSS transitions that reverse mid-flight; closed means `inert`. Shell
 * makes its siblings `inert` while it is open. The children (the one assistant
 * panel) stay mounted while closed, so the conversation survives a close. */

export type AssistantSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  /** CSS selector of the element to focus on open; the close button otherwise. */
  initialFocus?: string;
  children: ReactNode;
};

export function AssistantSheet({
  open,
  onClose,
  title,
  closeLabel,
  initialFocus,
  children,
}: AssistantSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const target = initialFocus ? panelRef.current?.querySelector<HTMLElement>(initialFocus) : null;
    (target ?? closeRef.current)?.focus();
  }, [open, initialFocus]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && panelRef.current) {
        trapTab(e, panelRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`shell2-sheet-root${open ? " shell2-sheet-open" : ""}`}
      {...((open ? {} : { inert: "" }) as Record<string, string>)}
    >
      <div className="shell2-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="shell2-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="shell2-sheet-head">
          <h2 id={titleId} className="shell2-sheet-title">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="shell2-sheet-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 4l10 10M14 4L4 14" />
            </svg>
          </button>
        </div>
        <div className="shell2-sheet-body">{children}</div>
      </div>
    </div>
  );
}
