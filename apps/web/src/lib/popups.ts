import { DateTime, Option } from "effect";

export type PopupId =
  | "intake:intake"
  | "intake:new-questions"
  | "intake:round2"
  | "intake:risk"
  | "connect";
export type Dismissed = Partial<Record<PopupId, string>>;

export const POPUP_SNOOZE_DAYS = 7;
export const POPUPS_KEY = "lavega.popups";
export const POPUP_SHOWN_KEY = "lavega.popupShown";

const POPUP_IDS: readonly PopupId[] = [
  "intake:intake",
  "intake:new-questions",
  "intake:round2",
  "intake:risk",
  "connect",
];

/* A dismissal hides the pop-up for POPUP_SNOOZE_DAYS. A missing or unparsable
 * timestamp never hides it. */
export function isSnoozed(dismissedAt: string | undefined, now: string): boolean {
  if (dismissedAt === undefined) return false;
  const since = DateTime.make(dismissedAt);
  const current = DateTime.make(now);
  if (Option.isNone(since) || Option.isNone(current)) return false;
  const until = DateTime.add(since.value, { days: POPUP_SNOOZE_DAYS });
  return DateTime.isLessThan(current.value, until);
}

export function nextPopup(input: {
  view: string;
  inviteKind: "intake" | "new-questions" | "round2" | "risk" | null;
  unconnectedCount: number;
  dismissed: Dismissed;
  shownThisSession: boolean;
  blocked: boolean;
  now: string;
}): PopupId | null {
  if (input.view !== "overview" || input.blocked || input.shownThisSession) return null;
  const open = (id: PopupId) => !isSnoozed(input.dismissed[id], input.now);
  if (input.inviteKind !== null) {
    const id: PopupId = `intake:${input.inviteKind}`;
    if (open(id)) return id;
  }
  if (input.unconnectedCount > 0 && open("connect")) return "connect";
  return null;
}

export function readDismissed(): Dismissed {
  try {
    const raw = window.localStorage.getItem(POPUPS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Dismissed = {};
    for (const id of POPUP_IDS) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === "string") out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/* Best effort: with storage blocked the pop-up may return after a reload. */
export function writeDismissed(id: PopupId, now: string): void {
  try {
    window.localStorage.setItem(POPUPS_KEY, JSON.stringify({ ...readDismissed(), [id]: now }));
  } catch {
    /* storage blocked */
  }
}

let shownInMemory = false;

export function wasShownThisSession(): boolean {
  try {
    if (window.sessionStorage.getItem(POPUP_SHOWN_KEY) === "1") return true;
  } catch {
    /* storage blocked: use the in-memory flag */
  }
  return shownInMemory;
}

export function markShownThisSession(): void {
  shownInMemory = true;
  try {
    window.sessionStorage.setItem(POPUP_SHOWN_KEY, "1");
  } catch {
    /* storage blocked */
  }
}

/* Tests only. */
export function forgetPopupMemory(): void {
  shownInMemory = false;
}
