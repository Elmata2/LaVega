import { makePanelPrefsStore, type PanelPrefs } from "./panelPrefs";
import { MAIN_MIN_WIDTH, RAIL_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./sidebar";

export const ASSISTANT_KEY = "lavega.assistantPanel";
export const ASSISTANT_DEFAULT_WIDTH = 380;
export const ASSISTANT_MIN_WIDTH = 320;
export const ASSISTANT_MAX_WIDTH = 520;
/* A first visit opens the assistant column only from this width. */
export const ASSISTANT_OPEN_MIN_VIEWPORT = 1440;

export type { PanelPrefs };

export function defaultAssistant(viewport: number): PanelPrefs {
  return { open: viewport >= ASSISTANT_OPEN_MIN_VIEWPORT, width: ASSISTANT_DEFAULT_WIDTH };
}

/* Width to keep: the fixed 320..520 range only. */
export function clampAssistantWidth(width: number): number {
  const w = Number.isFinite(width) ? width : ASSISTANT_DEFAULT_WIDTH;
  return Math.max(ASSISTANT_MIN_WIDTH, Math.min(ASSISTANT_MAX_WIDTH, w));
}

const store = makePanelPrefsStore({
  key: ASSISTANT_KEY,
  defaultPrefs: defaultAssistant,
  clampStoredWidth: clampAssistantWidth,
});

export function forgetMemoryAssistant(): void {
  store.forgetMemory();
}

/* Stored prefs, else the first-visit default. Never throws. */
export function readAssistant(viewport: number): PanelPrefs {
  return store.read(viewport);
}

/* Persist. False when storage is blocked; the choice then lives in memory. */
export function writeAssistant(prefs: PanelPrefs): boolean {
  return store.write(prefs);
}

export type Fit = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  assistantOpen: boolean;
  assistantWidth: number;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/* Which panels show, and how wide, so main keeps its 480. The stored `open`
 * of a panel this hides is never touched: only the returned Fit says "hidden". */
export function fitPanels(input: {
  viewport: number;
  sidebar: PanelPrefs;
  assistant: PanelPrefs;
  lastOpened: "sidebar" | "assistant";
}): Fit {
  const room = input.viewport - RAIL_WIDTH - MAIN_MIN_WIDTH;
  const s = clamp(input.sidebar.width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
  const a = clampAssistantWidth(input.assistant.width);
  const sMax = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, room));
  const aMax = Math.max(ASSISTANT_MIN_WIDTH, Math.min(ASSISTANT_MAX_WIDTH, room));
  const only = (which: "sidebar" | "assistant"): Fit => ({
    sidebarOpen: which === "sidebar",
    sidebarWidth: Math.min(s, sMax),
    assistantOpen: which === "assistant",
    assistantWidth: Math.min(a, aMax),
  });

  const wantS = input.sidebar.open;
  const wantA = input.assistant.open;
  if (wantS && wantA) {
    if (s + a <= room) {
      return { sidebarOpen: true, sidebarWidth: s, assistantOpen: true, assistantWidth: a };
    }
    if (SIDEBAR_MIN_WIDTH + ASSISTANT_MIN_WIDTH <= room) {
      const excess = s + a - room;
      const slackS = s - SIDEBAR_MIN_WIDTH;
      const slackA = a - ASSISTANT_MIN_WIDTH;
      const cutS = Math.ceil((excess * slackS) / (slackS + slackA));
      const cutA = excess - cutS;
      return {
        sidebarOpen: true,
        sidebarWidth: s - cutS,
        assistantOpen: true,
        assistantWidth: a - cutA,
      };
    }
    return only(input.lastOpened);
  }
  if (wantS) return only("sidebar");
  if (wantA) return only("assistant");
  return {
    sidebarOpen: false,
    sidebarWidth: Math.min(s, sMax),
    assistantOpen: false,
    assistantWidth: Math.min(a, aMax),
  };
}
