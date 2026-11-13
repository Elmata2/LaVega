import { useCallback, useEffect, useState } from "react";
import { THEME_KEY, applyTheme, readStoredTheme, storeTheme, type Theme } from "../lib/theme";

/* What this page view chose, for when storage is blocked: a remount (Profiel
 * closed and reopened) must still show the radio that matches what is applied. */
let chosenInMemory: Theme | null = null;

/** Drop the in-memory choice (tests; a real storage read wins again). */
export function forgetMemoryTheme(): void {
  chosenInMemory = null;
}

/** Current theme plus a setter that applies at once and persists. Storage
 *  failures are silent; the switch still works for this page view. Another tab
 *  changing `lavega.theme` updates this one. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => chosenInMemory ?? readStoredTheme());

  const setTheme = useCallback((next: Theme) => {
    chosenInMemory = storeTheme(next) ? null : next;
    setThemeState(next);
    applyTheme(next);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== THEME_KEY) return;
      const next = readStoredTheme();
      chosenInMemory = null;
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [theme, setTheme];
}
