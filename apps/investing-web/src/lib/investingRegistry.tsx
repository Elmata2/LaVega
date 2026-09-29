import type { ReactNode } from "react";
import {
  INVESTING_MODULE_IDS,
  INVESTING_WIDGET_IDS,
  type InvestingModuleId,
  type InvestingWidgetId,
} from "@lavega/core";

/* The module and widget registry — the one place a tab or Overview card is
 * declared, mirroring apps/web/src/components/moduleRegistry.tsx. Investing
 * stores the chosen ids server-side (see lib/layoutResource.ts) instead of
 * localStorage, and uses react-router paths instead of Personal's view state,
 * so this is an adaptation of that file's shape, not a shared import. */

export const HOME_MODULE = "overview" as const;
type ModuleOrHome = InvestingModuleId | typeof HOME_MODULE;

export type InvestingModuleDef = {
  id: ModuleOrHome;
  label: string;
  what: string;
  path: string;
  preview: ReactNode;
};

export type InvestingWidgetDef = {
  id: InvestingWidgetId;
  label: string;
  what: string;
  preview: ReactNode;
};

function Thumb({ children }: { children: ReactNode }) {
  return (
    <svg
      className="h-[60px] w-24 shrink-0"
      viewBox="0 0 96 60"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width="96" height="60" rx="8" className="fill-secondary" />
      {children}
    </svg>
  );
}

function Tile({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx="3" className="fill-card stroke-border" />;
}

function Line({ x, y, w, strong }: { x: number; y: number; w: number; strong?: boolean }) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={strong ? 4 : 2.5}
      rx="1.25"
      className={strong ? "fill-foreground" : "fill-muted-foreground"}
      opacity={strong ? 0.85 : 0.45}
    />
  );
}

/** In the order they appear in the top bar, after Overview. */
export const MODULES: InvestingModuleDef[] = [
  {
    id: "overview",
    label: "Overview",
    what: "Your home screen: performance, allocation and key figures.",
    path: "/",
    preview: (
      <Thumb>
        <Tile x={8} y={8} w={36} h={20} />
        <Line x={12} y={13} w={16} strong />
        <Tile x={52} y={8} w={36} h={20} />
        <Line x={56} y={13} w={12} strong />
        <Tile x={8} y={34} w={80} h={18} />
        <Line x={12} y={40} w={20} strong />
      </Thumb>
    ),
  },
  {
    id: "positions",
    label: "Positions",
    what: "Every open and closed position, sortable by value, weight and return.",
    path: "/positions",
    preview: (
      <Thumb>
        <Line x={8} y={8} w={26} strong />
        <Tile x={8} y={18} w={80} h={10} />
        <Tile x={8} y={31} w={80} h={10} />
        <Tile x={8} y={44} w={80} h={10} />
      </Thumb>
    ),
  },
  {
    id: "net-worth",
    label: "Net worth",
    what: "A stacked chart of invested value and cash over time.",
    path: "/net-worth",
    preview: (
      <Thumb>
        <path d="M8 44h80" className="stroke-border" strokeWidth="1.5" />
        <path
          d="M8 40 L26 34 L44 38 L62 24 L80 16"
          fill="none"
          className="stroke-primary"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Thumb>
    ),
  },
  {
    id: "agents",
    label: "Agents",
    what: "Portfolio lenses you can ask about concentration, return and risk.",
    path: "/agents",
    preview: (
      <Thumb>
        <circle cx="24" cy="30" r="12" className="fill-primary" opacity="0.35" />
        <circle cx="56" cy="20" r="9" className="fill-primary" opacity="0.25" />
        <circle cx="78" cy="38" r="9" className="fill-primary" opacity="0.2" />
      </Thumb>
    ),
  },
];

export function investingModulePath(id: ModuleOrHome): string {
  return MODULES.find((m) => m.id === id)?.path ?? "/";
}

const KNOWN_MODULES = new Set<string>(INVESTING_MODULE_IDS);

/** Resolve stored module choices into the tabs the top bar shows, always in
 *  registry order with Overview first and never removable. */
export function resolveModules(
  stored: Partial<Record<InvestingModuleId, boolean>>,
): ModuleOrHome[] {
  const chosen = MODULES.filter((m) => {
    if (m.id === HOME_MODULE) return true;
    const explicit = stored[m.id as InvestingModuleId];
    return explicit ?? true; // every module defaults on (spec §1)
  }).map((m) => m.id);
  return chosen;
}

export function toggleModule(
  enabled: Partial<Record<InvestingModuleId, boolean>>,
  id: InvestingModuleId,
  on: boolean,
): Partial<Record<InvestingModuleId, boolean>> {
  if (!KNOWN_MODULES.has(id)) return enabled;
  return { ...enabled, [id]: on };
}

/** In the order they appear on Overview: left column, then right column,
 *  then full-width cards below (spec §3's table). */
export const WIDGETS: InvestingWidgetDef[] = [
  {
    id: "performance",
    label: "Performance",
    what: "Portfolio value or indexed return against your chosen benchmarks.",
    preview: (
      <Thumb>
        <path
          d="M8 44 L28 30 L48 36 L68 18 L88 24"
          fill="none"
          className="stroke-primary"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Thumb>
    ),
  },
  {
    id: "allocation",
    label: "Allocation",
    what: "A donut of your holdings, by instrument or by entity.",
    preview: (
      <Thumb>
        <circle
          cx="48"
          cy="30"
          r="18"
          fill="none"
          className="stroke-primary"
          strokeWidth="8"
          opacity="0.7"
        />
      </Thumb>
    ),
  },
  {
    id: "kpis",
    label: "Key figures",
    what: "Portfolio value, daily change and total return since inception.",
    preview: (
      <Thumb>
        <Line x={8} y={12} w={40} strong />
        <Line x={8} y={26} w={30} strong />
        <Line x={8} y={40} w={34} strong />
      </Thumb>
    ),
  },
  {
    id: "risk",
    label: "Risk & composition",
    what: "Volatility, beta, alpha, drawdown and your largest positions.",
    preview: (
      <Thumb>
        <Tile x={8} y={8} w={80} h={44} />
        <Line x={13} y={14} w={30} strong />
        <Line x={13} y={24} w={40} />
        <Line x={13} y={34} w={36} />
      </Thumb>
    ),
  },
  {
    id: "sectors",
    label: "Sector allocation",
    what: "What sector your priced holdings are concentrated in.",
    preview: (
      <Thumb>
        <rect x="8" y="14" width="80" height="6" rx="3" className="fill-primary" opacity="0.7" />
        <rect x="8" y="26" width="56" height="6" rx="3" className="fill-primary" opacity="0.5" />
        <rect x="8" y="38" width="34" height="6" rx="3" className="fill-primary" opacity="0.35" />
      </Thumb>
    ),
  },
  {
    id: "agent",
    label: "Portfolio agent",
    what: "Ask a chosen investor lens about your positions.",
    preview: (
      <Thumb>
        <circle cx="24" cy="30" r="12" className="fill-primary" opacity="0.35" />
        <Line x={44} y={22} w={40} strong />
        <Line x={44} y={34} w={30} />
      </Thumb>
    ),
  },
];

const KNOWN_WIDGETS = new Set<string>(INVESTING_WIDGET_IDS);

/** Every widget defaults on (spec §3's table); an absent key means "on". */
export function resolveWidgets(
  stored: Partial<Record<InvestingWidgetId, boolean>>,
): InvestingWidgetId[] {
  return WIDGETS.filter((w) => stored[w.id] ?? true).map((w) => w.id);
}

export function toggleWidget(
  enabled: Partial<Record<InvestingWidgetId, boolean>>,
  id: InvestingWidgetId,
  on: boolean,
): Partial<Record<InvestingWidgetId, boolean>> {
  if (!KNOWN_WIDGETS.has(id)) return enabled;
  return { ...enabled, [id]: on };
}
