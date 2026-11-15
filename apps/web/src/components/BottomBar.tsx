import type { ModuleId } from "./moduleRegistry";
import { isProfileView, navClick, ProfileGlyph, type ShellNavProps } from "./Rail";
import { pathForView } from "../appRoutes";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";

/* Below 1024px: a sticky 48px top bar (menu, brand, Profiel) and a fixed bottom
 * tab bar. The bar holds exactly the core modules; every other enabled module
 * sits behind "Meer". Both openers take their drawer state from Shell. */

/** Registry order decides the sequence. */
export const BAR_IDS: ReadonlySet<ModuleId> = new Set([
  "overview",
  "optimalisatie",
  "accounts",
]);

export function PhoneTopBar({
  view,
  onOpenProfile,
  onOpenMenu,
  expanded = false,
}: ShellNavProps & { expanded?: boolean }) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  return (
    <div className="shell2-phonebar">
      <button
        type="button"
        className="shell2-phonebar-menu"
        aria-label={c.frame.openMenu}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        onClick={() => onOpenMenu?.()}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M3 6h14M3 10h14M3 14h14" />
        </svg>
      </button>
      <span className="shell2-phonebar-brand">
        <span className="dot dot-pos" aria-hidden="true" />
        LaVega
      </span>
      <a
        href={pathForView("profiel")}
        className="shell2-phonebar-profile"
        aria-label={c.nav.profile}
        aria-current={isProfileView(view) ? "page" : undefined}
        onClick={(e) => navClick(e, onOpenProfile)}
      >
        <span className="profile-avatar" aria-hidden="true">
          <ProfileGlyph />
        </span>
      </a>
    </div>
  );
}

export function BottomBar({
  view,
  modules,
  onNavigate,
  onOpenMore,
  expanded = false,
  behind = false,
}: ShellNavProps & { expanded?: boolean; behind?: boolean }) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const items = modules.filter((m) => BAR_IDS.has(m.id));
  const hasMore = modules.some((m) => !BAR_IDS.has(m.id));
  return (
    <nav
      className="shell2-bottombar"
      aria-label={c.nav.ariaLabel}
      {...((behind ? { inert: "" } : {}) as Record<string, string>)}
    >
      {items.map((m) => (
        <a
          key={m.id}
          href={pathForView(m.id)}
          className="shell2-bar-item"
          aria-current={view === m.id ? "page" : undefined}
          onClick={(e) => navClick(e, () => onNavigate(m.id))}
        >
          <span className="shell2-rail-icon" aria-hidden="true">
            {m.icon}
          </span>
          <span className="shell2-rail-label">{c.nav.moduleLabels[m.id]}</span>
        </a>
      ))}
      {hasMore && (
        <button
          type="button"
          className="shell2-bar-item shell2-bar-more"
          aria-haspopup="dialog"
          aria-expanded={expanded}
          onClick={() => onOpenMore?.()}
        >
          <span className="shell2-rail-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <circle cx="5.5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="18.5" cy="12" r="1.6" />
            </svg>
          </span>
          <span className="shell2-rail-label">{c.frame.more}</span>
        </button>
      )}
    </nav>
  );
}
