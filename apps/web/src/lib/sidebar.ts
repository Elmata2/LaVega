import { makePanelPrefsStore, type PanelPrefs } from "./panelPrefs";

export const SIDEBAR_KEY = "lavega.sidebar";
export const SIDEBAR_DEFAULT_WIDTH = 296;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 440;
export const RAIL_WIDTH = 84;
/* Main never gets narrower than this; the sidebar gives way first. */
export const MAIN_MIN_WIDTH = 480;

export type SidebarPrefs = PanelPrefs;

/* The rail and sidebar exist from 1024px; a first visit keeps the sidebar
 * closed below 1280px so main keeps room. */
export const SHELL_MIN_VIEWPORT = 1024;
const SIDEBAR_OPEN_MIN_VIEWPORT = 1280;

/* The widest the sidebar may be in this viewport. The 240 floor wins when the
 * viewport rule would go below it. */
export function maxWidthFor(viewport: number): number {
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, viewport - RAIL_WIDTH - MAIN_MIN_WIDTH),
  );
}

/* Width to show: 240..440, and no wider than leaves main its 480. */
export function clampWidth(width: number, viewport: number): number {
  const w = Number.isFinite(width) ? width : SIDEBAR_DEFAULT_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(w, maxWidthFor(viewport)));
}

/* Width to keep: only the fixed 240..440 range, so a narrow window does not
 * shrink the stored choice for the next wide one. */
export function clampStoredWidth(width: number): number {
  return clampWidth(width, Number.POSITIVE_INFINITY);
}

export function defaultSidebar(viewport: number): SidebarPrefs {
  return { open: viewport >= SIDEBAR_OPEN_MIN_VIEWPORT, width: SIDEBAR_DEFAULT_WIDTH };
}

const store = makePanelPrefsStore({
  key: SIDEBAR_KEY,
  defaultPrefs: defaultSidebar,
  clampStoredWidth,
});

export function forgetMemorySidebar(): void {
  store.forgetMemory();
}

/* Stored prefs, else the first-visit default. Never throws. The width is the
 * stored choice (240..440); apply `clampWidth` with the live viewport to show it. */
export function readSidebar(viewport: number): SidebarPrefs {
  return store.read(viewport);
}

/* Persist. False when storage is blocked; the choice then lives in memory. */
export function writeSidebar(prefs: SidebarPrefs): boolean {
  return store.write(prefs);
}
