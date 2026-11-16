import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { View } from "../App";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { useAssistantPanel } from "../hooks/useAssistantPanel.js";
import { useSidebar } from "../hooks/useSidebar.js";
import { ASSISTANT_MAX_WIDTH, ASSISTANT_MIN_WIDTH, fitPanels } from "../lib/assistantPanel.js";
import {
  MAIN_MIN_WIDTH,
  RAIL_WIDTH,
  SHELL_MIN_VIEWPORT,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "../lib/sidebar.js";
import { BAR_IDS, BottomBar, PhoneTopBar } from "./BottomBar.js";
import { AssistantSheet } from "./AssistantSheet.js";
import { Rail, type ShellNavProps } from "./Rail.js";
import { ShellDrawer, type DrawerMode } from "./ShellDrawer.js";
import { SidebarResizeHandle } from "./SidebarResizeHandle.js";

/* The app frame: full viewport, no margin, radius or shadow.
 *
 *   rail (84)  |  account sidebar (296, 240..440, collapsible)  |  main  |  assistant (380, 320..520, collapsible)
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
  /** The assistant panel (AssistantPanel). From 1024px it is a right-hand
   *  column with a top-bar toggle; below it, a bottom-bar item opens it in a
   *  full-height sheet. One element, so one conversation; this frame passes it
   *  `onClose` and `active`. Absent: no toggle, no column, no bar item, no sheet. */
  assistant?: ReactNode;
  /** Called when an overlay that covers the page (the phone drawer or the
   *  assistant sheet) opens or closes. */
  onOverlayChange?: (open: boolean) => void;
  children: ReactNode;
};

const SIDEBAR_ID = "shell2-sidebar";
const ASSISTANT_ID = "shell2-assistant";

/* The props the frame hands to the assistant panel element. */
type PanelSlotProps = { onClose?: () => void; active?: boolean; hideTitle?: boolean };

function AssistantIcon() {
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
      <path d="M11 3.5v11" />
    </svg>
  );
}

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

export function Shell({
  title,
  actions,
  nav,
  sidebar,
  assistant,
  onOverlayChange,
  children,
}: ShellProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale].frame;
  const wide = useMediaQuery(`(min-width: ${SHELL_MIN_VIEWPORT}px)`);
  const sidebarApi = useSidebar();
  const { toggle, setWidth, reset } = sidebarApi;
  const assistantApi = useAssistantPanel();
  const hasAssistantNode = assistant !== undefined && assistant !== null;
  const hasAssistant = hasAssistantNode && wide;
  /* Which panel the owner asked for last: it wins when both cannot fit. */
  const [lastOpened, setLastOpened] = useState<"sidebar" | "assistant">("assistant");
  const fit = fitPanels({
    viewport: sidebarApi.viewport,
    sidebar: sidebarApi.prefs,
    assistant: hasAssistant ? assistantApi.prefs : { ...assistantApi.prefs, open: false },
    lastOpened,
  });
  const open = fit.sidebarOpen;
  const assistantShown = hasAssistant && fit.assistantOpen;
  const room = sidebarApi.viewport - RAIL_WIDTH - MAIN_MIN_WIDTH;
  const maxWidth = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, room - (assistantShown ? fit.assistantWidth : 0)),
  );
  const assistantMax = Math.max(
    ASSISTANT_MIN_WIDTH,
    Math.min(ASSISTANT_MAX_WIDTH, room - (open ? fit.sidebarWidth : 0)),
  );
  /* Widths while a drag is in progress; null otherwise. Not persisted. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [assistantDrag, setAssistantDrag] = useState<number | null>(null);
  const shownWidth = dragWidth ?? fit.sidebarWidth;
  const assistantWidth = assistantDrag ?? fit.assistantWidth;
  const dragging = dragWidth !== null || assistantDrag !== null;

  /* `inert` is not in React 18's types; an empty string renders the attribute. */
  const inertProps = (open ? {} : { inert: "" }) as Record<string, string>;
  const assistantInert = (assistantShown ? {} : { inert: "" }) as Record<string, string>;
  const assistantToggleRef = useRef<HTMLButtonElement>(null);
  /* Where focus goes once the toggle's state change has rendered. A new object
   * per toggle, so the effect runs on each one and not on other renders. */
  const [focusRequest, setFocusRequest] = useState<{ to: "input" | "toggle" } | null>(null);
  useEffect(() => {
    if (focusRequest?.to === "input") document.getElementById("assistant-input")?.focus();
    else if (focusRequest?.to === "toggle") assistantToggleRef.current?.focus();
  }, [focusRequest]);
  const toggleAssistant = () => {
    setFocusRequest({ to: assistantShown ? "toggle" : "input" });
    setLastOpened("assistant");
    /* Hidden by the fit rule but stored open: asking for it only brings it back. */
    if (!assistantShown && assistantApi.prefs.open) return;
    assistantApi.toggle();
  };
  const toggleSidebar = () => {
    setLastOpened("sidebar");
    if (!open && sidebarApi.prefs.open) return;
    toggle();
  };
  const rootRef = useRef<HTMLDivElement>(null);
  /* `view` is the view the drawer was opened on: any other view closes it, so
   * there is no effect that closes on navigation. */
  const [drawer, setDrawer] = useState<{ open: boolean; mode: DrawerMode; view?: View }>({
    open: false,
    mode: "menu",
  });
  if (drawer.open && (wide || drawer.view !== nav?.view)) setDrawer({ ...drawer, open: false });
  const drawerOpen = drawer.open && !wide;
  /* The phone assistant sheet. Never open together with the drawer. */
  const [sheetOpen, setSheetOpen] = useState(false);
  if (sheetOpen && wide) setSheetOpen(false);
  const sheetShown = sheetOpen && !wide;
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const closeDrawer = useCallback(() => setDrawer((d) => ({ ...d, open: false })), []);
  const openMenu = nav?.onOpenMenu;
  const openMore = nav?.onOpenMore;
  const phoneNav = wide
    ? undefined
    : nav && {
        ...nav,
        onOpenMenu: () => {
          openMenu?.();
          setSheetOpen(false);
          setDrawer({ open: true, mode: "menu", view: nav.view });
        },
        onOpenMore: () => {
          openMore?.();
          setSheetOpen(false);
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
  const wasSheetOpen = useRef(false);
  useEffect(() => {
    if (wasSheetOpen.current && !sheetShown && !wide) {
      rootRef.current?.querySelector<HTMLElement>(".shell2-bar-assistant")?.focus();
    }
    wasSheetOpen.current = sheetShown;
  }, [sheetShown, wide]);
  const overlayOpen = drawerOpen || sheetShown;
  useEffect(() => {
    onOverlayChange?.(overlayOpen);
  }, [overlayOpen, onOverlayChange]);
  const behind = (overlayOpen ? { inert: "" } : {}) as Record<string, string>;
  const style = {
    "--shell2-sidebar-w": `${shownWidth}px`,
    "--shell2-assistant-w": `${assistantWidth}px`,
    "--shell2-rail-w": `${RAIL_WIDTH}px`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`shell2${narrow ? " shell2-narrow" : ""}${dragging ? " shell2-dragging" : ""}`}
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
              if (w !== fit.sidebarWidth) setWidth(w);
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
              onClick={toggleSidebar}
            >
              <SidebarIcon />
            </button>
          )}
          <h1 className="shell2-title">{title}</h1>
          <div className="shell2-actions">{actions}</div>
          {hasAssistant && (
            <button
              ref={assistantToggleRef}
              type="button"
              className="shell2-toggle shell2-toggle-end"
              aria-expanded={assistantShown}
              aria-controls={ASSISTANT_ID}
              aria-label={assistantShown ? c.assistantClose : c.assistantOpen}
              onClick={toggleAssistant}
            >
              <AssistantIcon />
            </button>
          )}
        </header>
        <div className="shell2-content">{children}</div>
      </main>
      {hasAssistant && (
        <aside
          id={ASSISTANT_ID}
          className={`shell2-assistant${assistantShown ? "" : " shell2-assistant-closed"}`}
          aria-label={c.assistantLabel}
          {...assistantInert}
        >
          <SidebarResizeHandle
            controls={ASSISTANT_ID}
            edge="left"
            width={assistantWidth}
            min={ASSISTANT_MIN_WIDTH}
            max={assistantMax}
            onDrag={setAssistantDrag}
            onCommit={(w) => {
              setAssistantDrag(null);
              if (w !== fit.assistantWidth) assistantApi.setWidth(w);
            }}
            onReset={() => {
              setAssistantDrag(null);
              assistantApi.reset();
            }}
          />
          <div className="shell2-assistant-inner">
            {isValidElement(assistant)
              ? cloneElement(assistant as ReactElement<PanelSlotProps>, {
                  onClose: toggleAssistant,
                  active: assistantShown,
                })
              : assistant}
          </div>
        </aside>
      )}
      {phoneNav && (
        <BottomBar
          {...phoneNav}
          expanded={drawerOpen && drawer.mode === "more"}
          behind={overlayOpen}
          {...(hasAssistantNode
            ? {
                onOpenAssistant: () => {
                  setDrawer((d) => ({ ...d, open: false }));
                  setSheetOpen(true);
                },
                assistantExpanded: sheetShown,
              }
            : {})}
        />
      )}
      {phoneNav && hasAssistantNode && (
        <AssistantSheet
          open={sheetShown}
          onClose={closeSheet}
          title={c.assistant}
          closeLabel={c.assistantClose}
          initialFocus="#assistant-input"
        >
          {isValidElement(assistant)
            ? cloneElement(assistant as ReactElement<PanelSlotProps>, {
                active: sheetShown,
                hideTitle: true,
              })
            : assistant}
        </AssistantSheet>
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
