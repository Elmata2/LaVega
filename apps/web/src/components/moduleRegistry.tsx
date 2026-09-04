import { useSyncExternalStore } from "react";
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
  | "overview"
  | "transactions"
  | "accounts"
  | "forecast"
  | "optimalisatie"
  | "valuta"
  | "punten"
  | "belasting"
  | "facturen"
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
  /** IN DE NAV ZODRA ER NOG NIETS GEKOZEN IS? Standaard ja — zie
   *  DEFAULT_MODULES, waar staat waarom "alles aan" het juiste beginpunt is.
   *
   *  Eén module zegt hier nee, en dat is geen uitzondering maar het gevolg van
   *  een eerder besluit: Transacties is in augustus BEWUST uit de navigatie
   *  gehaald (commit a52da45 — importeren hoort op de startpagina en transacties
   *  bereik je via een rekening). Review 4 punt 6 vraagt hem terug als iets dat
   *  je kunt AANZETTEN, niet als iets dat er weer standaard staat. Hem in de
   *  gewone lijst zetten zou die verwijdering stilletjes terugdraaien bij
   *  iedereen die nooit iets koos. */
  defaultOn?: boolean;
};

/** The home module. An app with no home is a broken app, so this one is always
 *  in the nav and its toggle is disabled. */
export const HOME_MODULE: ModuleId = "overview";

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
  return (
    <rect x={x} y={y} width={w} height={h} rx="3" fill="var(--surface)" stroke="var(--line)" />
  );
}

/** A miniature text line inside a preview. */
function Line({ x, y, w, strong }: { x: number; y: number; w: number; strong?: boolean }) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={strong ? 4 : 2.5}
      rx="1.25"
      fill={strong ? "var(--ink)" : "var(--muted)"}
      opacity={strong ? 0.85 : 0.45}
    />
  );
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
    id: "transactions",
    /* Review 4, punt 6. De route bestaat al en is bereikbaar via een rekening;
     * wat ontbrak was een eigen ingang. Uit tenzij hij hem aanzet — zie
     * `defaultOn` hierboven. */
    label: "Transacties",
    what: "Al je transacties in één lijst, met filters op periode, rekening en categorie.",
    defaultOn: false,
    icon: (
      <Icon>
        <path d="M4 6h16M4 12h16M4 18h10" />
        <path d="M17 15v6M17 21l-2.5-2.5M17 21l2.5-2.5" />
      </Icon>
    ),
    preview: (
      <Thumb>
        <Line x={8} y={8} w={26} strong />
        <Tile x={8} y={18} w={80} h={10} />
        <Line x={13} y={21.5} w={30} />
        <Line x={72} y={22} w={10} strong />
        <Tile x={8} y={31} w={80} h={10} />
        <Line x={13} y={34.5} w={22} />
        <Line x={72} y={35} w={10} strong />
        <Tile x={8} y={44} w={80} h={10} />
        <Line x={13} y={47.5} w={34} />
        <Line x={72} y={48} w={10} strong />
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
        <path
          d="M8 40 L26 34 L44 38 L62 24 L80 16"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 50h80"
          stroke="var(--warn)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          opacity="0.7"
        />
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
        <path
          d="M78 26 L84 18 L90 26"
          fill="none"
          stroke="var(--pos)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
        <path
          d="M42 25h12M54 25l-4-3.5M54 25l-4 3.5"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M54 36H42M42 36l4-3.5M42 36l4 3.5"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Thumb>
    ),
  },
  {
    id: "punten",
    label: "Punten",
    /* NIET MEER "met wat ze waard zijn": die euro-schatting is er bewust uit.
     * Een saldo in punten is een feit, een euro-waarde was altijd een gok — en
     * een moduletekst die iets belooft wat het scherm niet toont, is precies het
     * soort onwaarheid dat hier nergens mag staan. */
    what: "Je spaarpunten en airmiles op één plek, met de regels van elk programma.",
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
        <circle
          cx="22"
          cy="34"
          r="12"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          opacity="0.8"
        />
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

/** What the nav holds before the owner has picked anything: everything that was
 *  already there.
 *
 *  Starting with only Overzicht + Forecast matched his sentence literally, but
 *  it emptied the nav of an EXISTING install on the next load, which reads as
 *  the app having lost its tabs rather than as an invitation to choose.
 *  Decluttering by switching OFF what you do not want reaches the same end state
 *  and never looks like a fault. Declared after MODULES because it is derived
 *  from it — the registry stays the single list.
 *
 *  `defaultOn: false` is de andere kant van diezelfde redenering. "Alles aan"
 *  betekent hier "de nav blijft zoals hij was", en dat is precies waarom een
 *  module die eerder WEGGEHAALD is er niet vanzelf weer bij komt: dat zou net zo
 *  goed een verandering zijn die niemand vroeg. */
export const DEFAULT_MODULES: ModuleId[] = MODULES.filter((m) => m.defaultOn !== false).map(
  (m) => m.id,
);

const KNOWN = new Set<string>(MODULES.map((m) => m.id));

/** Resolve the STORED preference into the modules that belong in the nav.
 *
 *  `stored === null` means "never chosen" — not "chose nothing" — so that case
 *  falls back to DEFAULT_MODULES, while an explicit empty list stays empty.
 *  Ids that are no longer in the registry are dropped, the home module is
 *  always added back, and the result is always in registry order so the nav
 *  never reshuffles itself because of the order things were toggled in. */
export function enabledModules(stored: string[] | null): ModuleId[] {
  const chosen =
    stored === null ? DEFAULT_MODULES : stored.filter((id): id is ModuleId => KNOWN.has(id));
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

/* ====================================================================== *
 * OVERZICHT-WIDGETS
 *
 * A module is a place you go; a widget is a card on the homescreen. Aandacht
 * and Positie per bedrijf were neither registered nor switchable — they were
 * written straight into the Overzicht view, which is exactly why the profile
 * had nothing to offer for them. They are declared here now, next to the
 * modules, for the same reason the modules are: one list, no second catalogue.
 * Betaalagenda kwam er in review 4 (punt 8) bij, langs dezelfde weg.
 *
 * They are deliberately NOT ModuleIds. A ModuleId is a route (`Extract<View>`),
 * and none of these is a route — folding them into MODULES would put a card
 * in the top navigation and break that type's promise.
 * ====================================================================== */

/** A widget id is not a route, so it is its own union — see above.
 *
 *  GEEN ENKELE WIDGET-ID IS OOK EEN MODULE-ID, en dat is een eis en geen
 *  toeval. De twee voorkeuren staan onder verschillende sleutels, maar
 *  `enabledWidgets` accepteert nog steeds een KALE LIJST (de oude opslagvorm),
 *  en een lijst die per ongeluk uit de verkeerde hoek komt moet dan nul widgets
 *  opleveren in plaats van er stilletjes een aan te zetten. Daarom heten de twee
 *  nieuwe kaarten `facturen-open` en `btw-stand` en niet `facturen` en
 *  `belasting`: die laatste twee zijn routes. Er staat een test op. */
export type WidgetId = "aandacht" | "positie" | "betaalagenda" | "facturen-open" | "btw-stand";

export type WidgetDef = {
  id: WidgetId;
  /** Dutch label. The SAME text as the card's own title, so the switch and the
   *  thing it switches are recognisably one object. */
  label: string;
  /** One line: what this card tells you. */
  what: string;
  /** Static thumbnail built from the design system (no screenshots). */
  preview: ReactNode;
  /** OP DE STARTPAGINA ZOLANG HIJ ER NIETS OVER GEZEGD HEEFT?
   *
   *  Aandacht en Positie staan uit: die zijn er als KEUZE bijgekomen ("instead
   *  of it always being default there"), dus ze mogen niet ongevraagd
   *  verschijnen. Betaalagenda staat aan, en dat is dezelfde regel en niet de
   *  omgekeerde: die kaart staat er al sinds hij bestaat, en review 4 punt 8
   *  vraagt om een schakelaar — niet om hem kwijt te raken. Een widget
   *  schakelbaar maken mag nooit hetzelfde zijn als hem weghalen.
   *
   *  BTW IS HET OMGEKEERDE GEVAL EN DE UITZONDERING DIE UITGESCHREVEN MOET
   *  WORDEN: die kaart is NIEUW en staat tóch aan. Niet omdat een nieuwe kaart
   *  dat mag — dat mag hij niet, zie Facturen hiernaast — maar omdat hij er in
   *  dezelfde zin expliciet om vroeg: "als de gebruiker dat wilt, doe default
   *  wel btw". De regel hierboven zegt dat een kaart niet ONGEVRAAGD verschijnt;
   *  deze is gevraagd. Facturen in diezelfde zin ("als de gebruiker dat wilt")
   *  is precies het tegenovergestelde verzoek en staat dus uit. Zonder deze
   *  alinea lezen die twee naast elkaar als een inconsequentie. */
  defaultOn?: boolean;
  /** Eén regel extra onder `what`, voor het geval dat uitleg nodig heeft. */
  note?: string;
};

/** In the order they appear on the homescreen, top down. */
export const WIDGETS: WidgetDef[] = [
  {
    id: "aandacht",
    label: "Aandacht",
    what: "Een brede balk bovenaan met wat er misgaat: tekorten, gemiste betalingen, deadlines.",
    preview: (
      <Thumb>
        <Tile x={8} y={10} w={80} h={40} />
        <circle cx="16" cy="20" r="2.5" fill="var(--neg)" />
        <Line x={23} y={19} w={40} strong />
        <circle cx="16" cy="31" r="2.5" fill="var(--warn)" />
        <Line x={23} y={30} w={52} />
        <circle cx="16" cy="42" r="2.5" fill="var(--warn)" opacity="0.5" />
        <Line x={23} y={41} w={34} />
      </Thumb>
    ),
  },
  {
    id: "positie",
    label: "Positie",
    what: "Een kleine kaart met de verdeling van je geld over je bedrijven.",
    preview: (
      <Thumb>
        <Tile x={20} y={10} w={56} h={40} />
        <rect x="26" y="18" width="26" height="4" rx="2" fill="var(--accent)" opacity="0.7" />
        <rect x="52" y="18" width="18" height="4" rx="2" fill="var(--pos)" opacity="0.7" />
        <circle cx="28" cy="31" r="2.5" fill="var(--accent)" />
        <Line x={34} y={30} w={16} />
        <Line x={60} y={30} w={10} strong />
        <circle cx="28" cy="41" r="2.5" fill="var(--pos)" />
        <Line x={34} y={40} w={12} />
        <Line x={60} y={40} w={10} strong />
      </Thumb>
    ),
  },
  {
    id: "betaalagenda",
    label: "Betaalagenda",
    what: "Wat er als eerste af moet: geplande bedragen en herkende vaste lasten, met hun datum.",
    note: "Deze stond al op je overzicht — hier zet je hem uit.",
    defaultOn: true,
    preview: (
      <Thumb>
        <rect
          x="8"
          y="10"
          width="14"
          height="14"
          rx="3"
          fill="var(--surface)"
          stroke="var(--line)"
        />
        <Line x={11} y={14} w={8} strong />
        <Line x={28} y={13} w={34} strong />
        <Line x={28} y={20} w={22} />
        <Line x={74} y={16} w={14} />
        <rect
          x="8"
          y="30"
          width="14"
          height="14"
          rx="3"
          fill="rgba(176, 120, 30, 0.18)"
          stroke="var(--warn)"
        />
        <Line x={11} y={34} w={8} strong />
        <Line x={28} y={33} w={28} strong />
        <Line x={28} y={40} w={18} />
        <Line x={74} y={36} w={14} />
      </Thumb>
    ),
  },
  {
    id: "facturen-open",
    label: "Facturen",
    what: "Hoeveel facturen er open staan, voor welk bedrag, en wat er over de vervaldatum heen is.",
    /* "dan moet de factuur ook in het overzicht komen, ALS DE GEBRUIKER DAT
     * WILT." Die tweede helft is de standaard: uit, tot hij hem hier aanzet. */
    note: "Staat standaard uit — zet hem aan als je hem op je overzicht wilt.",
    preview: (
      <Thumb>
        <Line x={8} y={9} w={10} strong />
        <Line x={22} y={10} w={22} />
        <Tile x={8} y={22} w={80} h={13} />
        <Line x={13} y={26} w={26} />
        <Line x={68} y={26} w={14} strong />
        <Tile x={8} y={38} w={80} h={13} />
        <Line x={13} y={42} w={20} />
        <Line x={68} y={42} w={14} strong />
        <rect x="8" y="38" width="3" height="13" rx="1.5" fill="var(--neg)" opacity="0.7" />
      </Thumb>
    ),
  },
  {
    id: "btw-stand",
    label: "BTW",
    what: "Wat je deze aangifteperiode te betalen of terug te vragen hebt, en tot wanneer je hebt.",
    /* Nieuw en tóch aan — zie de alinea bij `defaultOn` hierboven: hij vroeg er
     * met zoveel woorden om. De note zegt dat hier ook, want een schakelaar die
     * aan staat terwijl de kaart nieuw is, laat de lezer aan zichzelf twijfelen. */
    note: "Deze kaart staat standaard op je overzicht — hier zet je hem uit.",
    defaultOn: true,
    preview: (
      <Thumb>
        <Line x={8} y={9} w={14} strong />
        <rect x="8" y="18" width="34" height="9" rx="2" fill="var(--neg)" opacity="0.55" />
        <Line x={8} y={33} w={44} />
        <Line x={8} y={41} w={30} />
        <rect
          x="58"
          y="16"
          width="30"
          height="30"
          rx="3"
          fill="var(--surface)"
          stroke="var(--line)"
        />
        <Line x={63} y={22} w={12} strong />
        <Line x={63} y={30} w={20} />
        <rect x="63" y="36" width="20" height="5" rx="2.5" fill="var(--warn)" opacity="0.45" />
      </Thumb>
    ),
  },
];

/** Wat er op de startpagina staat zolang hij niets gekozen heeft: per widget wat
 *  `defaultOn` zegt, en niet één lijst voor alledrie.
 *
 *  De asymmetrie met DEFAULT_MODULES blijft: een ongekozen NAV betekent "alles",
 *  want een navigatie leegmaken leest als een storing. Een ongekozen WIDGET
 *  betekent per kaart iets anders, en dat is geen slordigheid maar het enige
 *  antwoord dat allebei zijn zinnen respecteert — Aandacht, Positie en Facturen
 *  mogen niet ongevraagd verschijnen, Betaalagenda mag niet ongevraagd
 *  verdwijnen, en BTW moet er staan omdat hij daar met zoveel woorden om vroeg. */
export const DEFAULT_WIDGETS: WidgetId[] = WIDGETS.filter((w) => w.defaultOn).map((w) => w.id);

const KNOWN_WIDGETS = new Set<string>(WIDGETS.map((w) => w.id));

/** ALLE ids, en dat is wat er als "gezien" wordt weggeschreven.
 *
 *  Verantwoord omdat de picker de hele lijst tegelijk toont: wie één schakelaar
 *  omzet, heeft de rest óók voor zich gehad en er (door hem te laten staan) een
 *  antwoord op gegeven. */
const ALL_WIDGETS: WidgetId[] = WIDGETS.map((w) => w.id);

/** De twee die bestonden toen de voorkeur nog een KALE LIJST was.
 *
 *  Deze constante is de migratie. Een opgeslagen array kan alleen geschreven
 *  zijn in de periode dat dit de enige twee widgets waren, dus over precies die
 *  twee heeft hij zich uitgesproken en over al het latere niet. Zonder dit zou
 *  een lijst als `["aandacht"]` betekenen dat hij de Betaalagenda heeft
 *  uitgezet, terwijl hij die vraag nooit gesteld heeft gekregen. */
const LEGACY_ARRAY_WIDGETS: WidgetId[] = ["aandacht", "positie"];

/** De opgeslagen voorkeur: wat AAN staat, en waar hij zich over UITGESPROKEN
 *  heeft. Twee lijsten, omdat één lijst het verschil niet kan dragen tussen
 *  "uitgezet" en "nooit gevraagd" — en dat verschil is precies waar een nieuwe
 *  widget in valt. */
export type StoredWidgets = { on: string[]; seen: string[] };

/** Een kale lijst is de oude vorm; die krijgt zijn gezien-verzameling erbij. */
function asStored(stored: string[] | StoredWidgets | null): StoredWidgets | null {
  if (stored === null) return null;
  if (Array.isArray(stored)) return { on: stored, seen: LEGACY_ARRAY_WIDGETS };
  return stored;
}

/** Resolve the STORED widget preference into the cards the homescreen shows.
 *
 *  ONBEKEND IS GEEN NUL, ook niet voor een voorkeur. Een widget die niet in
 *  `seen` staat is er nooit aan voorgelegd, dus telt zijn eigen `defaultOn` en
 *  niet zijn afwezigheid. Voor een widget die er wél in staat is afwezigheid een
 *  echt antwoord: uit.
 *
 *  Unknown ids are dropped and the result is always in registry order, so the
 *  page never reshuffles because of the order things were toggled in. */
export function enabledWidgets(stored: string[] | StoredWidgets | null): WidgetId[] {
  const pref = asStored(stored);
  if (pref === null) return [...DEFAULT_WIDGETS];
  const on = new Set(pref.on);
  const seen = new Set(pref.seen);
  return WIDGETS.filter((w) => (seen.has(w.id) ? on.has(w.id) : w.defaultOn === true)).map(
    (w) => w.id,
  );
}

/** Een lijst ids opschonen: alleen bestaande widgets, ontdubbeld, in
 *  registervolgorde. Los van `enabledWidgets` omdat dit géén opgeslagen voorkeur
 *  leest — hier is een ontbrekende id een uitgezette widget en niets anders. Die
 *  twee door elkaar halen betekende dat uitzetten niet werkte: de lijst kwam
 *  terug door de deur van "nooit gevraagd". */
export function normaliseWidgets(ids: readonly string[]): WidgetId[] {
  const set = new Set(ids.filter((id): id is WidgetId => KNOWN_WIDGETS.has(id)));
  return WIDGETS.filter((w) => set.has(w.id)).map((w) => w.id);
}

/** Switch one widget on or off. No widget is locked: a homescreen with none of
 *  these on it is still a homescreen. */
export function toggleWidget(enabled: WidgetId[], id: WidgetId, on: boolean): WidgetId[] {
  const set = new Set<WidgetId>(enabled);
  if (on) set.add(id);
  else set.delete(id);
  return normaliseWidgets([...set]);
}

/* ---------------------------------------------------------------------- *
 * The preference itself, and a store to hang it on.
 *
 * Its own key. Sharing `lavega.navModules` would let an old nav choice decide
 * a widget's default, and an emptied nav list would silently mean "no widgets
 * either" — two different questions must not answer each other.
 *
 * It is a store rather than App state because the switch (Profiel) and the
 * cards (Overzicht) sit in different branches of the tree; a store lets each
 * side read the same preference without a prop threaded through everything in
 * between. Same class of preference as the buffer and the home country: this
 * browser only, never in the vault, never in a back-up.
 * ---------------------------------------------------------------------- */

const WIDGETS_KEY = "lavega.overviewWidgets";

/** Alleen de strings uit een onbekende waarde. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** De ruwe opgeslagen voorkeur, of `null` voor "nooit gekozen".
 *
 *  Twee vormen komen hier binnen en allebei zijn echt: de huidige `{on, seen}`,
 *  en de KALE LIJST die installaties van vóór deze widget nog hebben staan. Die
 *  lijst wordt niet stilzwijgend als de nieuwe vorm gelezen — `asStored` plakt er
 *  de gezien-verzameling van dat tijdperk aan, want anders zou "staat er niet in"
 *  gaan betekenen "uitgezet".
 *
 *  Onleesbare rommel telt als nooit gekozen: dan beslist `defaultOn` per kaart,
 *  wat hetzelfde is als een verse installatie. */
export function getEnabledWidgets(): string[] | StoredWidgets | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(WIDGETS_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return strings(parsed);
    if (parsed !== null && typeof parsed === "object" && "on" in parsed) {
      const rec = parsed as { on?: unknown; seen?: unknown };
      return { on: strings(rec.on), seen: strings(rec.seen) };
    }
    return null;
  } catch {
    return null;
  }
}

const widgetListeners = new Set<() => void>();
let widgetCache: WidgetId[] | null = null;

/** Read-through, so a preference cleared from outside (a test, another tab, a
 *  restored back-up) is never served stale. The cached array is returned
 *  unchanged when the content is identical, because useSyncExternalStore needs
 *  a stable identity to stop re-rendering. */
function widgetSnapshot(): WidgetId[] {
  const next = enabledWidgets(getEnabledWidgets());
  const same =
    widgetCache !== null &&
    widgetCache.length === next.length &&
    widgetCache.every((id, i) => id === next[i]);
  if (!same) widgetCache = next;
  return widgetCache as WidgetId[];
}

function subscribeWidgets(onChange: () => void): () => void {
  widgetListeners.add(onChange);
  return () => widgetListeners.delete(onChange);
}

/** Persist the choice and tell every card and switch about it.
 *
 *  Wat er wordt weggeschreven is de keuze ÉN het feit dat hij hem gemaakt heeft:
 *  `seen` is de hele registerlijst, want de picker toont ze allemaal tegelijk.
 *  Vanaf dat moment is een ontbrekende id een uitgezette kaart en geen open
 *  vraag meer — en een widget die er later bij komt begint weer als open vraag. */
export function setEnabledWidgets(ids: WidgetId[]): void {
  const next = normaliseWidgets(ids);
  try {
    const value: StoredWidgets = { on: next, seen: ALL_WIDGETS };
    if (typeof localStorage !== "undefined")
      localStorage.setItem(WIDGETS_KEY, JSON.stringify(value));
  } catch {
    /* quota/serialization errors are non-fatal for a preference */
  }
  widgetCache = next;
  for (const listener of widgetListeners) listener();
}

/** The widgets that are on, plus the setter. Re-renders when either side
 *  changes it. */
export function useOverviewWidgets(): [WidgetId[], (next: WidgetId[]) => void] {
  const enabled = useSyncExternalStore(subscribeWidgets, widgetSnapshot, widgetSnapshot);
  return [enabled, setEnabledWidgets];
}

/** Is this one card on the homescreen? What a widget wrapper asks. */
export function useWidgetEnabled(id: WidgetId): boolean {
  return useSyncExternalStore(subscribeWidgets, widgetSnapshot, widgetSnapshot).includes(id);
}
