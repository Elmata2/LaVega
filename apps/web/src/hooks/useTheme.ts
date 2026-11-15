import { useCallback, useEffect, useState } from "react";
import {
  THEME_KEY,
  applyTheme,
  currentTheme,
  readStoredTheme,
  rememberTheme,
  storeTheme,
  type Theme,
} from "../lib/theme";

/** Drop the in-memory choice (tests; a real storage read wins again). */
export function forgetMemoryTheme(): void {
  rememberTheme(null);
}

/** Current theme plus a setter that applies at once and persists. Storage
 *  failures are silent; the switch still works for this page view. Another tab
 *  changing `lavega.theme` updates this one. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());

  const setTheme = useCallback((next: Theme) => {
    rememberTheme(storeTheme(next) ? null : next);
    setThemeState(next);
    applyTheme(next);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== THEME_KEY) return;
      const next = readStoredTheme();
      rememberTheme(null);
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [theme, setTheme];
}
