import { type MouseEvent, type ReactNode } from "react";
import type { View } from "../App";
import type { ModuleDef } from "./moduleRegistry";
import { pathForView } from "../appRoutes";
import { INVESTING_URL } from "../investing.js";

/* The app bar: brand, the owner's own module selection as a horizontal tab set,
 * and the profile entry top right (the reference's avatar position).
 *
 * The rail no longer shows the whole catalogue — it shows exactly the modules
 * switched on in the profile's picker, which is why it can afford the
 * reference's quieter treatment: plain text tabs with a rule under the active
 * one instead of round-edged tiles. Everything that is a setting rather than a
 * place you work (Regels, Koppelingen, Back-up, Import, land, vergrendelen)
 * lives behind the profile button. */

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** SPA navigation that still exposes a real href for open-in-new-tab / share. */
function navClick(e: MouseEvent, go: () => void) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  go();
}

type NavBarProps = {
  view: View;
  /** The enabled modules, in registry order — see components/moduleRegistry. */
  modules: ModuleDef[];
  onNavigate: (view: View) => void;
  onOpenProfile: () => void;
};

export default function NavBar({ view, modules, onNavigate, onOpenProfile }: NavBarProps) {
  return (
    <header className="appbar">
      <div className="brand">
        <span className="dot dot-pos" aria-hidden="true" />
        <span>LaVega</span>
      </div>

      <nav className="navrail" aria-label="Weergaven">
        {modules.map((m) => (
          <a
            key={m.id}
            href={pathForView(m.id)}
            className={`nav-item${view === m.id ? " active" : ""}`}
            aria-current={view === m.id ? "page" : undefined}
            onClick={(e) => navClick(e, () => onNavigate(m.id))}
          >
            <span className="nav-icon" aria-hidden="true">
              {m.icon}
            </span>
            <span>{m.label}</span>
          </a>
        ))}
      </nav>

      <div className="appbar-right">
        {/* Separate deploy (apps/investing-web). Plain link out so the unlocked
         * vault stays put. Always shown when a URL is configured — reachability
         * used to hide a dead localhost link; production default is /investing. */}
        {INVESTING_URL && (
          <a
            href={INVESTING_URL}
            {...(INVESTING_URL.startsWith("http")
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            className="appbar-investing"
          >
            <Icon>
              <path d="M4 19h16" />
              <path d="M7 19V10M12 19V5M17 19v7" />
            </Icon>
            <span>Investing</span>
          </a>
        )}

        <a
          href={pathForView("profiel")}
          className={`appbar-profile${view === "profiel" ? " active" : ""}`}
          aria-current={view === "profiel" ? "page" : undefined}
          onClick={(e) => navClick(e, onOpenProfile)}
        >
          <span className="profile-avatar" aria-hidden="true">
            <Icon>
              <circle cx="12" cy="8.5" r="3.5" />
              <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
            </Icon>
          </span>
          <span>Profiel</span>
        </a>
      </div>
    </header>
  );
}
