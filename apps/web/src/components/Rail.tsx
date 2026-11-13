import { type MouseEvent, type ReactNode } from "react";
import type { View } from "../App";
import type { ModuleDef } from "./moduleRegistry";
import { pathForView } from "../appRoutes";
import { INVESTING_URL } from "../investing.js";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";

/* Navigation of the shell: the 84px rail at >= 1024px. At < 1024 `BottomBar` and
 * `PhoneTopBar` take over; Shell picks one, so there is only ever one <nav>. */

export type ShellNavProps = {
  view: View;
  /** Enabled modules in registry order, plan already filtered when locked. */
  modules: ModuleDef[];
  onNavigate: (view: View) => void;
  onOpenProfile: () => void;
  /** Phone menu button; Shell opens the drawer and also calls this. */
  onOpenMenu?: () => void;
  /** Phone "Meer" slot; Shell opens the drawer and also calls this. */
  onOpenMore?: () => void;
};

/** SPA navigation that still exposes a real href for open-in-new-tab / share. */
export function navClick(e: MouseEvent, go: () => void) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  go();
}

export function LineIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ProfileGlyph() {
  return (
    <LineIcon>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
    </LineIcon>
  );
}

/** Props of the link out to the investing app (a separate deploy, not a view),
 *  or null when no URL resolves. Shared by the rail and the phone drawer. */
export function investingLinkProps(): {
  href: string;
  target?: string;
  rel?: string;
} | null {
  if (!INVESTING_URL) return null;
  return INVESTING_URL.startsWith("http")
    ? { href: INVESTING_URL, target: "_blank", rel: "noopener noreferrer" }
    : { href: INVESTING_URL };
}

export function InvestingGlyph() {
  return (
    <LineIcon>
      <path d="M4 19h16" />
      <path d="M7 19V10M12 19V5M17 19v-7" />
    </LineIcon>
  );
}

export function Rail({ view, modules, onNavigate, onOpenProfile }: ShellNavProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const investing = investingLinkProps();
  return (
    <nav className="shell2-rail" aria-label={c.nav.ariaLabel}>
      <span className="shell2-rail-brand dot dot-pos" role="img" aria-label="LaVega" />
      <div className="shell2-rail-list">
        {modules.map((m) => (
          <a
            key={m.id}
            href={pathForView(m.id)}
            className="shell2-rail-item"
            aria-current={view === m.id ? "page" : undefined}
            onClick={(e) => navClick(e, () => onNavigate(m.id))}
          >
            <span className="shell2-rail-icon" aria-hidden="true">
              {m.icon}
            </span>
            <span className="shell2-rail-label">{c.nav.moduleLabels[m.id]}</span>
          </a>
        ))}
      </div>
      <div className="shell2-rail-bottom">
        {investing && (
          <a {...investing} className="shell2-rail-item">
            <span className="shell2-rail-icon" aria-hidden="true">
              <InvestingGlyph />
            </span>
            <span className="shell2-rail-label">{c.nav.investing}</span>
          </a>
        )}
        <a
          href={pathForView("profiel")}
          className="shell2-rail-item"
          aria-current={view === "profiel" ? "page" : undefined}
          onClick={(e) => navClick(e, onOpenProfile)}
        >
          <span className="shell2-rail-icon" aria-hidden="true">
            <ProfileGlyph />
          </span>
          <span className="shell2-rail-label">{c.nav.profile}</span>
        </a>
      </div>
    </nav>
  );
}
