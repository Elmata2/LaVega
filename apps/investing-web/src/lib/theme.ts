export type Theme = "dark" | "light";

/* Same key and fallback as public/theme-init.js, which sets the theme before
 * first paint. Dark is the brand default; prefers-color-scheme is ignored. */
export const THEME_KEY = "lavega-investing-theme";

export function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked: the choice lasts for this page view only */
  }
}
