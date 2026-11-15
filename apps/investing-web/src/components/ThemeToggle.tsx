import { useState } from "react";
import { applyTheme, readStoredTheme, storeTheme, type Theme } from "../lib/theme";

/* role="switch": one control with two states, "light theme on" or off. The label
 * is fixed ("Light theme") so the announced name never changes with state. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const current = document.documentElement.dataset.theme;
    return current === "light" || current === "dark" ? current : readStoredTheme();
  });
  const isLight = theme === "light";

  const toggle = () => {
    const next: Theme = isLight ? "dark" : "light";
    applyTheme(next);
    storeTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label="Light theme"
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
      onClick={toggle}
      className="pressable flex size-11 items-center justify-center rounded-pill border border-border transition-colors hover:bg-secondary"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {isLight ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}
