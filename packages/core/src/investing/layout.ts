/** The tabs a switched-off module hides. "overview" is the home module: it is
 *  always on and is not part of this union (Extract-style pattern would need a
 *  route union this package does not own; the id list below is the single
 *  source instead, exactly like INVESTING_WIDGET_IDS next to it). */
export type InvestingModuleId = "positions" | "net-worth" | "agents";
export const INVESTING_MODULE_IDS: readonly InvestingModuleId[] = [
  "positions",
  "net-worth",
  "agents",
];

/** The Overview cards a reader can switch on and off. Deliberately its own
 *  union — mixing this with InvestingModuleId would let a stored id answer
 *  both "which tab" and "which card" questions, which is exactly the bug the
 *  no-widget-id-is-a-module-id rule (layout.test.ts) exists to catch. */
export type InvestingWidgetId =
  | "performance"
  | "allocation"
  | "kpis"
  | "risk"
  | "sectors"
  | "agent";
export const INVESTING_WIDGET_IDS: readonly InvestingWidgetId[] = [
  "performance",
  "allocation",
  "kpis",
  "risk",
  "sectors",
  "agent",
];

/** Only the choices a reader explicitly made. An absent key means "use the
 *  registry default" — never "off" — so a default changed later still reaches
 *  everyone who never touched that switch. */
export type InvestingLayout = {
  modules: Partial<Record<InvestingModuleId, boolean>>;
  widgets: Partial<Record<InvestingWidgetId, boolean>>;
};

export type InvestingLayoutSelection = { tenantId: string } & InvestingLayout;

export interface InvestingLayoutStore {
  get(tenantId: string): Promise<InvestingLayout>;
  set(selection: InvestingLayoutSelection): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickBooleans<Id extends string>(
  value: unknown,
  knownIds: readonly Id[],
): Partial<Record<Id, boolean>> {
  if (!isRecord(value)) return {};
  const result: Partial<Record<Id, boolean>> = {};
  for (const id of knownIds) {
    const entry = value[id];
    if (typeof entry === "boolean") result[id] = entry;
  }
  return result;
}

/** Normalizes any JSON value into a well-formed InvestingLayout: unknown ids
 *  and non-boolean values are dropped, never rejected. GET reads stored data
 *  this way; PUT sanitizes the incoming body the same way before persisting,
 *  so the two never disagree about what "valid" means. */
export function validateInvestingLayout(input: unknown): InvestingLayout {
  const record = isRecord(input) ? input : {};
  return {
    modules: pickBooleans(record.modules, INVESTING_MODULE_IDS),
    widgets: pickBooleans(record.widgets, INVESTING_WIDGET_IDS),
  };
}
