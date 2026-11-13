import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { View } from "../App";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { useSidebar } from "../hooks/useSidebar.js";
import { RAIL_WIDTH, SHELL_MIN_VIEWPORT, SIDEBAR_MIN_WIDTH } from "../lib/sidebar.js";
import { BAR_IDS, BottomBar, PhoneTopBar } from "./BottomBar.js";
import { Rail, type ShellNavProps } from "./Rail.js";
import { ShellDrawer, type DrawerMode } from "./ShellDrawer.js";
import { SidebarResizeHandle } from "./SidebarResizeHandle.js";

/* The app frame: full viewport, no margin, radius or shadow.
 *
 *   rail (84)  |  account sidebar (296, 240..440, collapsible)  |  main
 *
 * Main owns the scroll. Its top bar is sticky inside it; the content below is
 * `children`, which App.tsx passes already wrapped in the module-grid container
 * (CONTENT_CONTAINER_CLASS), so the wrapper stays off the scroll element and off
 * the sticky bar.
 *
 * `nav` feeds the rail (>= 1024) or the phone top bar + bottom bar (< 1024), one
 * <nav> at a time. `sidebar` is the account sidebar body (AccountSidebar); this
 * frame owns its width, collapse and resize handle, so the toggle and the handle
 * share one `useSidebar()` state. Below 1024 `ShellDrawer` holds the module list and
 * the same sidebar body; while it is open everything else is `inert`. */

export type ShellProps = {
  /** Page title, the one h1. */
  title: string;
  /** Right side of the top bar. */
  actions?: ReactNode;
  /** Navigation data. Without it the rail placeholder renders (tests). */
  nav?: ShellNavProps;
  /** Account sidebar body (AccountSidebar). A function receives the drawer's
   *  close seam (pass it as `onNavigate`); the inline sidebar calls it with
   *  nothing to close. */
  sidebar?: ReactNode | ((onNavigate?: () => void) => ReactNode);
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

export function Shell({ title, actions, nav, sidebar, children }: ShellProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale].frame;
  const wide = useMediaQuery(`(min-width: ${SHELL_MIN_VIEWPORT}px)`);
  const { open, width, maxWidth, toggle, setWidth, reset } = useSidebar();
  /* Width while a drag is in progress; null otherwise. Not persisted. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const shownWidth = dragWidth ?? width;

  /* `inert` is not in React 18's types; an empty string renders the attribute. */
  const inertProps = (open ? {} : { inert: "" }) as Record<string, string>;
  const rootRef = useRef<HTMLDivElement>(null);
  /* `view` is the view the drawer was opened on: any other view closes it, so
   * there is no effect that closes on navigation. */
  const [drawer, setDrawer] = useState<{ open: boolean; mode: DrawerMode; view?: View }>({
    open: false,
    mode: "menu",
  });
  if (drawer.open && (wide || drawer.view !== nav?.view)) setDrawer({ ...drawer, open: false });
  const drawerOpen = drawer.open && !wide;
  const closeDrawer = useCallback(() => setDrawer((d) => ({ ...d, open: false })), []);
  const openMenu = nav?.onOpenMenu;
  const openMore = nav?.onOpenMore;
  const phoneNav = wide
    ? undefined
    : nav && {
        ...nav,
        onOpenMenu: () => {
          openMenu?.();
          setDrawer({ open: true, mode: "menu", view: nav.view });
        },
        onOpenMore: () => {
          openMore?.();
          setDrawer({ open: true, mode: "more", view: nav.view });
        },
      };
  const narrow = phoneNav !== undefined;
  /* Focus goes back to the opener by class: Safari does not focus a button on
   * click, so `document.activeElement` at open time is unreliable. */
  const wasOpen = useRef(false);
  const mode = drawer.mode;
  useEffect(() => {
    if (wasOpen.current && !drawerOpen && !wide) {
      const opener = rootRef.current?.querySelector<HTMLElement>(
        mode === "more" ? ".shell2-bar-more" : ".shell2-phonebar-menu",
      );
      (opener ?? document.getElementById("main"))?.focus();
    }
    wasOpen.current = drawerOpen;
  }, [drawerOpen, mode, wide]);
  const behind = (drawerOpen ? { inert: "" } : {}) as Record<string, string>;
  const style = {
    "--shell2-sidebar-w": `${shownWidth}px`,
    "--shell2-rail-w": `${RAIL_WIDTH}px`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`shell2${narrow ? " shell2-narrow" : ""}${dragWidth === null ? "" : " shell2-dragging"}`}
      style={style}
    >
      <a
        href="#main"
        className="shell2-skip"
        {...behind}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {c.skipLink}
      </a>
      {wide && (nav ? <Rail {...nav} /> : <div className="shell2-rail" aria-hidden="true" />)}
      {wide && (
        <aside
          id={SIDEBAR_ID}
          className={`shell2-sidebar${open ? "" : " shell2-sidebar-closed"}`}
          aria-label={c.sidebarLabel}
          {...inertProps}
        >
          <div className="shell2-sidebar-inner">
            {typeof sidebar === "function" ? sidebar() : sidebar}
          </div>
          <SidebarResizeHandle
            controls={SIDEBAR_ID}
            width={shownWidth}
            min={SIDEBAR_MIN_WIDTH}
            max={maxWidth}
            onDrag={setDragWidth}
            onCommit={(w) => {
              setDragWidth(null);
              if (w !== width) setWidth(w);
            }}
            onReset={() => {
              setDragWidth(null);
              reset();
            }}
          />
        </aside>
      )}
      <main id="main" className="shell2-main" tabIndex={-1} {...behind}>
        {phoneNav && <PhoneTopBar {...phoneNav} expanded={drawerOpen && drawer.mode === "menu"} />}
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
      {phoneNav && (
        <BottomBar
          {...phoneNav}
          expanded={drawerOpen && drawer.mode === "more"}
          behind={drawerOpen}
        />
      )}
      {phoneNav && (
        <ShellDrawer
          open={drawerOpen}
          mode={drawer.mode}
          modules={
            drawer.mode === "more"
              ? phoneNav.modules.filter((m) => !BAR_IDS.has(m.id))
              : phoneNav.modules
          }
          view={phoneNav.view}
          onNavigate={phoneNav.onNavigate}
          onClose={closeDrawer}
        >
          {(close) => (typeof sidebar === "function" ? sidebar(close) : sidebar)}
        </ShellDrawer>
      )}
    </div>
  );
}
