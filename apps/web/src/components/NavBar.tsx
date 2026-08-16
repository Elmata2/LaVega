import type { ReactNode } from "react";
import type { View } from "../App";
import type { ModuleDef } from "./moduleRegistry";

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
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
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
          <button
            key={m.id}
            type="button"
            className={`nav-item${view === m.id ? " active" : ""}`}
            aria-current={view === m.id ? "page" : undefined}
            onClick={() => onNavigate(m.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {m.icon}
            </span>
            <span>{m.label}</span>
          </button>
        ))}
      </nav>

      <div className="appbar-right">
        <button
          type="button"
          className={`appbar-profile${view === "profiel" ? " active" : ""}`}
          aria-current={view === "profiel" ? "page" : undefined}
          onClick={onOpenProfile}
        >
          <span className="profile-avatar" aria-hidden="true">
            <Icon>
              <circle cx="12" cy="8.5" r="3.5" />
              <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
            </Icon>
          </span>
          <span>Profiel</span>
        </button>
      </div>
    </header>
  );
}
