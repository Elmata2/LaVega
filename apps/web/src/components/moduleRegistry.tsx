import type { ReactNode } from "react";
import type { View } from "../App";

/* The module registry — the ONE place a module is declared.
 *
 * A module is a workspace you can put in the top navigation. Everything that is
 * a *setting* rather than a place you work (Regels, Koppelingen, Back-up,
 * Import, land, vergrendelen) lives in the profile instead and is deliberately
 * NOT in here.
 *
 * Each entry carries what the picker needs to show it honestly: the Dutch
 * label, one line of what it does, the nav icon, and a tiny preview drawn from
 * the design system's own tokens — a real (if miniature) drawing of the layout,
 * never a screenshot that can silently go stale.
 *
 * Adding a module is one entry here plus its route in App.tsx. The nav, the
 * picker and the stored preference all read from this list, so there is no
 * second catalogue to keep in sync. */

/** A module id is always a real route. `Extract` makes that a compile error
 *  rather than a dead nav item if a View is ever renamed. */
export type ModuleId = Extract<
  View,
  "overview" | "accounts" | "forecast" | "optimalisatie" | "valuta" | "punten" | "belasting" | "facturen"
>;

export type ModuleDef = {
  id: ModuleId;
  /** Dutch label, as shown in the nav and the picker. */
  label: string;
  /** One line: what this module does for you. */
  what: string;
  /** 18px line icon for the nav rail. */
  icon: ReactNode;
  /** Static thumbnail built from the design system (no screenshots). */
  preview: ReactNode;
};

/** The home module. An app with no home is a broken app, so this one is always
 *  in the nav and its toggle is disabled. */
export const HOME_MODULE: ModuleId = "overview";

/** What the nav holds before the owner has picked anything — his own words:
 *  "Stays in the nav: Overzicht, Forecast, and whatever the user switches on."
 *  Every other module starts off and is one toggle away in the profile. */
export const DEFAULT_MODULES: ModuleId[] = ["overview", "forecast"];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/* The preview canvas: a 96×60 miniature on the app's own nested surface, drawn
 * with the palette tokens (no new colours) so a thumbnail keeps matching the
 * real module when the theme changes. */
function Thumb({ children }: { children: ReactNode }) {
  return (
    <svg className="mp-thumb" viewBox="0 0 96 60" role="img" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="96" height="60" rx="8" fill="var(--surface-2)" />
      {children}
    </svg>
  );
}

/** A miniature module card inside a preview. */
function Tile({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx="3" fill="var(--surface)" stroke="var(--line)" />;
}

/** A miniature text line inside a preview. */
function Line({ x, y, w, strong }: { x: number; y: number; w: number; strong?: boolean }) {
  return <rect x={x} y={y} width={w} height={strong ? 4 : 2.5} rx="1.25" fill={strong ? "var(--ink)" : "var(--muted)"} opacity={strong ? 0.85 : 0.45} />;
}

export const MODULES: ModuleDef[] = [
  {
    id: "overview",
    label: "Overzicht",
    what: "Je startpagina: totaalpositie, cashflow, aandachtspunten en statistieken.",
    icon: (
      <Icon>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </Icon>
    ),
    preview: (
      <Thumb>
        <Tile x={8} y={8} w={36} h={20} />
        <Line x={12} y={13} w={16} strong />
        <Line x={12} y={21} w={22} />
        <Tile x={52} y={8} w={36} h={20} />
        <Line x={56} y={13} w={12} strong />
        <Line x={56} y={21} w={26} />
        <Tile x={8} y={34} w={80} h={18} />
        <Line x={12} y={40} w={20} strong />
        <Line x={12} y={47} w={60} />
      </Thumb>
    ),
  },
  {
    id: "accounts",
    label: "Rekeningen",
    what: "Al je rekeningen en kaarten, per bank en per bedrijf, met hun saldo.",
    icon: (
      <Icon>
        <path d="M3 10l9-6 9 6" />
        <path d="M5 10v9M19 10v9M9 10v9M15 10v9" />
        <path d="M3 19h18" />
      </Icon>
    ),
    preview: (
      <Thumb>
        <Tile x={8} y={8} w={80} h={13} />
        <circle cx="16" cy="14.5" r="3.5" fill="var(--accent)" opacity="0.5" />
        <Line x={24} y={12.5} w={26} strong />
        <Line x={70} y={13} w={12} />
        <Tile x={8} y={24} w={80} h={13} />
        <circle cx="16" cy="30.5" r="3.5" fill="var(--accent)" opacity="0.5" />
        <Line x={24} y={28.5} w={20} strong />
        <Line x={70} y={29} w={12} />
        <Tile x={8} y={40} w={80} h={13} />
        <circle cx="16" cy="46.5" r="3.5" fill="var(--accent)" opacity="0.5" />
        <Line x={24} y={44.5} w={30} strong />
        <Line x={70} y={45} w={12} />
      </Thumb>
    ),
  },
  {
    id: "forecast",
    label: "Forecast",
    what: "Wat er de komende 30, 60 en 90 dagen binnenkomt en uitgaat.",
    icon: (
      <Icon>
        <path d="M4 16l5-6 4 3 7-9" />
        <path d="M14 4h6v6" />
      </Icon>
    ),
    preview: (
      <Thumb>
        <path d="M8 44h80" stroke="var(--line)" strokeWidth="1.5" />
        <path d="M8 40 L26 34 L44 38 L62 24 L80 16" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 50h80" stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7" />
        <circle cx="80" cy="16" r="3" fill="var(--accent)" />
        <Line x={8} y={8} w={24} strong />
      </Thumb>
    ),
  },
  {
    id: "optimalisatie",
    label: "Optimalisatie",
    what: "Abonnementen die je kunt opzeggen en spaarrentes die meer opleveren.",
    icon: (
      <Icon>
        <path d="M9 18h6" />
        <path d="M10 21h4" />
        <path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0 0 12 3z" />
      </Icon>
    ),
    preview: (
      <Thumb>
        <Line x={8} y={8} w={28} strong />
        <rect x="8" y="20" width="18" height="28" rx="3" fill="var(--muted)" opacity="0.35" />
        <rect x="32" y="30" width="18" height="18" rx="3" fill="var(--muted)" opacity="0.35" />
        <rect x="56" y="14" width="18" height="34" rx="3" fill="var(--pos)" opacity="0.75" />
        <path d="M78 26 L84 18 L90 26" fill="none" stroke="var(--pos)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </Thumb>
    ),
  },
  {
    id: "valuta",
    label: "Valuta",
    what: "De beste route om geld om te wisselen, met de live ECB-koers.",
    icon: (
      <Icon>
        <path d="M4 7h13M17 7l-3-3M17 7l-3 3" />
        <path d="M20 17H7M7 17l3 3M7 17l3-3" />
      </Icon>
    ),
    preview: (
      <Thumb>
        <Tile x={8} y={14} w={30} h={32} />
        <Line x={13} y={20} w={14} strong />
        <Line x={13} y={30} w={20} />
        <Tile x={58} y={14} w={30} h={32} />
        <Line x={63} y={20} w={14} strong />
        <Line x={63} y={30} w={20} />
        <path d="M42 25h12M54 25l-4-3.5M54 25l-4 3.5" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M54 36H42M42 36l4-3.5M42 36l4 3.5" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </Thumb>
    ),
  },
  {
    id: "punten",
    label: "Punten",
    what: "Je spaarpunten en airmiles op één plek, met wat ze waard zijn.",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8" />
        <path d="M9.5 15h3.5a2 2 0 0 0 0-4h-2a2 2 0 0 1 0-4h3.5" />
        <path d="M12 6.5v11" />
      </Icon>
    ),
    preview: (
      <Thumb>
        <Line x={8} y={8} w={22} strong />
        <circle cx="22" cy="34" r="12" fill="none" stroke="var(--accent)" strokeWidth="2.5" opacity="0.8" />
        <circle cx="22" cy="34" r="5" fill="var(--accent)" opacity="0.35" />
        <Line x={44} y={26} w={34} strong />
        <Line x={44} y={34} w={26} />
        <Line x={44} y={41} w={18} />
      </Thumb>
    ),
  },
  {
    id: "belasting",
    label: "Belasting",
    what: "Btw opzijzetten per bedrijf, met de eerstvolgende aangiftedatum.",
    icon: (
      <Icon>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </Icon>
    ),
    preview: (
      <Thumb>
        <Tile x={8} y={8} w={44} h={44} />
        <Line x={13} y={14} w={22} strong />
        <Line x={13} y={24} w={30} />
        <Line x={13} y={31} w={26} />
        <Line x={13} y={38} w={30} />
        <Tile x={58} y={8} w={30} h={20} />
        <Line x={63} y={13} w={12} strong />
        <Line x={63} y={21} w={18} />
        <rect x="58" y="34" width="30" height="18" rx="3" fill="var(--warn)" opacity="0.3" />
      </Thumb>
    ),
  },
  {
    id: "facturen",
    label: "Facturen",
    what: "Facturen die nog open staan, en wanneer ze binnen zouden moeten komen.",
    icon: (
      <Icon>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v4h4" />
        <path d="M9 13h6M9 17h6" />
      </Icon>
    ),
    preview: (
      <Thumb>
        <Tile x={20} y={6} w={56} h={48} />
        <Line x={26} y={13} w={26} strong />
        <Line x={26} y={23} w={44} />
        <Line x={26} y={30} w={38} />
        <Line x={26} y={37} w={44} />
        <rect x="26" y="43" width="20" height="6" rx="3" fill="var(--pos)" opacity="0.55" />
        <rect x="50" y="43" width="20" height="6" rx="3" fill="var(--neg)" opacity="0.45" />
      </Thumb>
    ),
  },
];

const KNOWN = new Set<string>(MODULES.map((m) => m.id));

/** Resolve the STORED preference into the modules that belong in the nav.
 *
 *  `stored === null` means "never chosen" — not "chose nothing" — so that case
 *  falls back to DEFAULT_MODULES, while an explicit empty list stays empty.
 *  Ids that are no longer in the registry are dropped, the home module is
 *  always added back, and the result is always in registry order so the nav
 *  never reshuffles itself because of the order things were toggled in. */
export function enabledModules(stored: string[] | null): ModuleId[] {
  const chosen = stored === null ? DEFAULT_MODULES : stored.filter((id): id is ModuleId => KNOWN.has(id));
  const set = new Set<ModuleId>(chosen);
  set.add(HOME_MODULE);
  return MODULES.filter((m) => set.has(m.id)).map((m) => m.id);
}

/** Switch one module on or off. The home module is never removable — an app
 *  with no home is a broken app — so asking to switch it off is a no-op. */
export function toggleModule(enabled: ModuleId[], id: ModuleId, on: boolean): ModuleId[] {
  if (id === HOME_MODULE && !on) return enabledModules(enabled);
  const set = new Set<ModuleId>(enabled);
  if (on) set.add(id);
  else set.delete(id);
  return enabledModules([...set]);
}

/** The definitions behind the enabled ids, in registry order — what the nav renders. */
export function navModules(enabled: ModuleId[]): ModuleDef[] {
  const set = new Set<ModuleId>(enabled);
  return MODULES.filter((m) => set.has(m.id));
}
