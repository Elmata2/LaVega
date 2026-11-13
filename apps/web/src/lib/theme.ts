export type Theme = "midnight" | "mono";

/* Same key and fallback as public/theme-init.js, which applies the theme before
 * first paint. Anything but "mono" (missing, invalid, blocked storage) is midnight. */
export const THEME_KEY = "lavega.theme";

export function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === "mono" ? "mono" : "midnight";
  } catch {
    return "midnight";
  }
}

/* Midnight is the :root default, so it is "no data-theme attribute". */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "mono") root.dataset.theme = "mono";
  else delete root.dataset.theme;
  root.style.colorScheme = theme === "mono" ? "light" : "dark";
}

/* Persist the choice. Returns false when storage is blocked; callers keep the
 * choice in memory and show nothing. */
export function storeTheme(theme: Theme): boolean {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/* What this page view chose, for when storage is blocked: the choice must still
 * win over the (unreadable) stored value everywhere, not only in Profiel. */
let chosenInMemory: Theme | null = null;

export function rememberTheme(theme: Theme | null): void {
  chosenInMemory = theme;
}

/** The theme this page view should show: the in-memory choice, else storage. */
export function currentTheme(): Theme {
  return chosenInMemory ?? readStoredTheme();
}
