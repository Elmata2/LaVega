/* Shared storage for a collapsible panel's `{ open, width }` preference
 * (the account sidebar and the assistant column). Never throws: a blocked or
 * corrupt store falls back to the first-visit default, and a blocked write keeps
 * the choice in memory for this page view. */
export type PanelPrefs = { open: boolean; width: number };

export type PanelPrefsStore = {
  /** Stored prefs, else the first-visit default. */
  read: (viewport: number) => PanelPrefs;
  /** Persist. False when storage is blocked; the choice then lives in memory. */
  write: (prefs: PanelPrefs) => boolean;
  forgetMemory: () => void;
};

export function makePanelPrefsStore(config: {
  key: string;
  defaultPrefs: (viewport: number) => PanelPrefs;
  /** Keeps a stored width inside the panel's fixed range. */
  clampStoredWidth: (width: number) => number;
}): PanelPrefsStore {
  const { key, defaultPrefs, clampStoredWidth } = config;
  let chosenInMemory: PanelPrefs | null = null;

  function coerce(raw: unknown, viewport: number): PanelPrefs {
    const fallback = defaultPrefs(viewport);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fallback;
    const rec = raw as Record<string, unknown>;
    return {
      open: typeof rec.open === "boolean" ? rec.open : fallback.open,
      width: typeof rec.width === "number" ? clampStoredWidth(rec.width) : fallback.width,
    };
  }

  return {
    read(viewport) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw !== null) {
          try {
            return coerce(JSON.parse(raw), viewport);
          } catch {
            return defaultPrefs(viewport);
          }
        }
      } catch {
        /* storage blocked: fall through to the in-memory choice */
      }
      return chosenInMemory ?? defaultPrefs(viewport);
    },
    write(prefs) {
      try {
        window.localStorage.setItem(key, JSON.stringify(prefs));
        chosenInMemory = null;
        return true;
      } catch {
        chosenInMemory = prefs;
        return false;
      }
    },
    forgetMemory() {
      chosenInMemory = null;
    },
  };
}
