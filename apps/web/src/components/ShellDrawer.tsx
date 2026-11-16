import { useEffect, useId, useRef, type ReactNode } from "react";
import type { View } from "../App";
import { pathForView } from "../appRoutes";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import type { ModuleDef } from "./moduleRegistry";
import { trapTab } from "./focusTrap.js";
import { InvestingGlyph, investingLinkProps, navClick } from "./Rail.js";

/* The phone drawer (< 1024px): a left sheet with the module list on
 * top (the rail is gone) and the account sidebar body below it. Shell-local on
 * purpose, not a general Drawer primitive.
 *
 * Always mounted while narrow so the slide and the fade are plain CSS
 * transitions on `transform` / `opacity` that reverse mid-flight. Closed means
 * `inert`: not focusable, not in the accessibility tree. Shell makes its
 * siblings `inert` while open, so the page behind is out of reach; the Tab
 * handler below wraps focus at both ends of the sheet.
 *
 * "menu" lists every enabled module; "more" (the bottom bar's Meer slot) lists
 * only those not in the bar and puts focus on the first one. */

export type DrawerMode = "menu" | "more";

export type ShellDrawerProps = {
  open: boolean;
  mode: DrawerMode;
  /** Modules to list, already filtered for the mode. */
  modules: ModuleDef[];
  view: View;
  onNavigate: (view: View) => void;
  onClose: () => void;
  /** Account sidebar body (AccountSidebar), given the close seam to call after
   *  it navigates. */
  children?: (onNavigate: () => void) => ReactNode;
};

export function ShellDrawer({
  open,
  mode,
  modules,
  view,
  onNavigate,
  onClose,
  children,
}: ShellDrawerProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const titleId = useId();
  const investing = investingLinkProps();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const first = mode === "more" ? listRef.current?.querySelector<HTMLElement>("a") : null;
    (first ?? closeRef.current)?.focus();
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (panel) trapTab(e, panel);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`shell2-drawer-root${open ? " shell2-drawer-open" : ""}`}
      {...((open ? {} : { inert: "" }) as Record<string, string>)}
    >
      <div className="shell2-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="shell2-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="shell2-drawer-head">
          <h2 id={titleId} className="shell2-drawer-title">
            {mode === "more" ? c.drawer.moreTitle : c.drawer.menuTitle}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="shell2-drawer-close"
            aria-label={c.drawer.close}
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
        <div className="shell2-drawer-body">
          <ul ref={listRef} className="shell2-drawer-modules" aria-label={c.drawer.modulesLabel}>
            {modules.map((m) => (
              <li key={m.id}>
                <a
                  href={pathForView(m.id)}
                  className="shell2-drawer-item"
                  aria-current={view === m.id ? "page" : undefined}
                  onClick={(e) =>
                    navClick(e, () => {
                      onNavigate(m.id);
                      onClose();
                    })
                  }
                >
                  <span className="shell2-rail-icon" aria-hidden="true">
                    {m.icon}
                  </span>
                  <span>{c.nav.moduleLabels[m.id]}</span>
                </a>
              </li>
            ))}
          </ul>
          {mode === "menu" && investing && (
            <div className="shell2-drawer-out">
              <a {...investing} className="shell2-drawer-item shell2-drawer-investing">
                <span className="shell2-rail-icon" aria-hidden="true">
                  <InvestingGlyph />
                </span>
                <span>{c.nav.investing}</span>
              </a>
            </div>
          )}
          <div className="shell2-drawer-accounts">{children?.(onClose)}</div>
        </div>
      </div>
    </div>
  );
}
