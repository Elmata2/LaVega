import type { CSSProperties, ReactNode } from "react";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { useSidebar } from "../hooks/useSidebar.js";
import { SHELL_MIN_VIEWPORT } from "../lib/sidebar.js";

/* The new app frame (SHELL_V2): full viewport, no margin, radius or shadow.
 *
 *   rail (72)  |  account sidebar (296, 240..440, collapsible)  |  main
 *
 * Main owns the scroll. Its top bar is sticky inside it; the content below is
 * `children`, which App.tsx passes already wrapped in the module-grid container
 * (CONTENT_CONTAINER_CLASS), so the wrapper stays off the scroll element and off
 * the sticky bar.
 *
 * Slots for later steps: `rail` (step 8, a <nav>), `sidebar` (step 9a). Below
 * 1024px only main renders; the bottom bar and drawer arrive in steps 8 and 9b. */

export type ShellProps = {
  /** Page title, the one h1. */
  title: string;
  /** Right side of the top bar. */
  actions?: ReactNode;
  /** Replaces the rail placeholder (step 8). */
  rail?: ReactNode;
  /** Account sidebar content (step 9a). Empty until then. */
  sidebar?: ReactNode;
  children: ReactNode;
};

const SIDEBAR_ID = "shell2-sidebar";

function SidebarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.25" y="3.25" width="13.5" height="11.5" rx="2" />
      <path d="M7 3.5v11" />
    </svg>
  );
}

export function Shell({ title, actions, rail, sidebar, children }: ShellProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale].frame;
  const wide = useMediaQuery(`(min-width: ${SHELL_MIN_VIEWPORT}px)`);
  const { open, width, toggle } = useSidebar();

  /* `inert` is not in React 18's types; an empty string renders the attribute. */
  const inertProps = (open ? {} : { inert: "" }) as Record<string, string>;
  const style = { "--shell2-sidebar-w": `${width}px` } as CSSProperties;

  return (
    <div className="shell2" style={style}>
      {wide && (rail ?? <div className="shell2-rail" aria-hidden="true" />)}
      {wide && (
        <aside
          id={SIDEBAR_ID}
          className={`shell2-sidebar${open ? "" : " shell2-sidebar-closed"}`}
          aria-label={c.sidebarLabel}
          {...inertProps}
        >
          <div className="shell2-sidebar-inner">{sidebar}</div>
        </aside>
      )}
      <main id="main" className="shell2-main">
        <header className="shell2-topbar">
          {wide && (
            <button
              type="button"
              className="shell2-toggle"
              aria-expanded={open}
              aria-controls={SIDEBAR_ID}
              aria-label={open ? c.sidebarClose : c.sidebarOpen}
              onClick={toggle}
            >
              <SidebarIcon />
            </button>
          )}
          <h1 className="shell2-title">{title}</h1>
          <div className="shell2-actions">{actions}</div>
        </header>
        <div className="shell2-content">{children}</div>
      </main>
    </div>
  );
}

export type ShellSwitchProps = ShellProps & {
  /** The flag (`SHELL_V2`). Off renders the old shell unchanged. */
  v2: boolean;
  /** Old shell chrome, rendered only when `v2` is false. */
  legacyNav: ReactNode;
  legacyTop: ReactNode;
};

/** The one place the two shells differ. `children` is shared. */
export function ShellSwitch({ v2, legacyNav, legacyTop, children, ...rest }: ShellSwitchProps) {
  if (v2) return <Shell {...rest}>{children}</Shell>;
  return (
    <div className="shell">
      {legacyNav}
      <div className="shell-body">
        {legacyTop}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
