import type { CatalogField, CatalogValue } from "./catalog.js";
import { wholeDaysBetween } from "./catalogGuard.js";
import type { FieldVerdict } from "./catalogGuardRun.js";
import type { MergeEntry } from "./catalogMerge.js";

export type FigureStatus = "confirmed" | "changed" | "waiting" | "held" | "not-checked";

export type NotCheckedCause =
  | "field-not-swept"
  | "not-asked"
  | "not-tracked"
  | "not-in-this-run"
  | "model-off"
  | "no-source"
  | "fetch-failed"
  | "not-found-on-page"
  | "no-figure-yet"
  | "stopped-early";

/** How a confirmed figure was confirmed. */
export type ConfirmedBy = "read-again" | "same-number" | "quote-check" | "conditions-updated";

export const CONFIRMED_DETAIL: Record<ConfirmedBy, string> = {
  "read-again": "read again",
  "same-number": "same number read",
  "quote-check": "quote check",
  "conditions-updated": "conditions updated",
};

/** The reason text of a product that had no route wired. The sweep writes it, the coverage reads it. */
export const NO_ROUTE_PREFIX = "no route wired";

export type FigureCoverage = {
  id: string;
  product: string;
  field: CatalogField;
  status: FigureStatus;
  cause?: NotCheckedCause;
  detail?: string;
  /** 0 when checked this run. */
  uncheckedWeeks: number;
  /** Weeks unchecked if this run's results are not saved: from the STORED date, whatever this
   *  run's verdict was; 1 when no date is stored. */
  weeksIfNotSaved: number;
  /** Held figures only: weeks since the figure was first held (1 in the week it was first held). */
  heldWeeks?: number;
};

/** Calendar weeks since `since`, counting the week it started as week 1. */
export function weeksSince(since: string, today: string): number {
  const days = wholeDaysBetween(since, today);
  return Math.floor(Math.max(days ?? 0, 0) / 7) + 1;
}

/** The held-since dates to persist: a figure keeps the date it was first held, a figure no longer held loses it. */
export function nextHeldSince(
  previous: Readonly<Record<string, string>>,
  heldKeys: readonly string[],
  today: string,
): Record<string, string> {
  return Object.fromEntries(heldKeys.map((k) => [k, previous[k] ?? today]));
}

/** The one question the weekly sweep asks of a product. null: no FX or interest figure applies,
 *  so the product is neither fetched nor expected. `held` = the fields the catalogue already holds. */
export function sweptFieldFor(
  kind: string | undefined,
  held: ReadonlySet<CatalogField>,
): "fxFeePct" | "interestPct" | null {
  if (kind === "spaarrekening" || kind === "beleggingsrekening") return "interestPct";
  if (kind === "creditcard" || kind === "betaalpas" || kind === "prepaid") return "fxFeePct";
  if (held.has("interestPct")) return "interestPct";
  if (held.has("fxFeePct")) return "fxFeePct";
  return null;
}

const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url.trim());

export function coverageForRun(input: {
  /** The catalogue before the run. */
  entries: readonly MergeEntry[];
  /** The one figure the sweep asks of each product on its watch list. */
  expected: readonly { id: string; product: string; field: CatalogField }[];
  verdicts: readonly FieldVerdict[];
  sweptFields: ReadonlySet<CatalogField>;
  /** Every product on the sweep's watch list. */
  watchedIds: ReadonlySet<string>;
  /** Products this run was set to visit. */
  sweptIds: ReadonlySet<string>;
  /** Products the loop reached, by id. */
  reached: ReadonlyMap<string, { fetched: boolean; reason: string | null }>;
  stoppedEarlyIds: ReadonlySet<string>;
  /** "id.field" to the first date the figure went unchecked, from state.json. */
  uncheckedSince: Readonly<Record<string, string>>;
  /** "id.field" to how a confirm verdict was reached. */
  confirmedBy?: ReadonlyMap<string, ConfirmedBy>;
  /** Whether the model rungs ran. */
  modelOn: boolean;
  today: string;
  /** An --only run changes no date. */
  fullRun?: boolean;
  /** "id.field" to the date the figure was first held, including holds made this run. */
  heldSince?: Readonly<Record<string, string>>;
}): { figures: FigureCoverage[]; uncheckedSince: Record<string, string> } {
  const verdicts = new Map(input.verdicts.map((v) => [`${v.id}.${v.field}`, v.verdict]));

  const causeOf = (id: string, field: CatalogField, stored: CatalogValue | undefined) => {
    if (!input.sweptFields.has(field)) return "field-not-swept" as const;
    const asked = input.expected.find((x) => x.id === id)?.field;
    if (asked && asked !== field) return "not-asked" as const;
    if (!input.watchedIds.has(id)) return "not-tracked" as const;
    if (!input.sweptIds.has(id)) return "not-in-this-run" as const;
    const reached = input.reached.get(id);
    const noRoute = !!reached?.reason?.startsWith(NO_ROUTE_PREFIX);
    const webSource = !stored || isWebUrl(stored.sourceUrl);
    if (noRoute && !input.modelOn && webSource) return "model-off" as const;
    if (noRoute || !webSource) return "no-source" as const;
    if (!reached || input.stoppedEarlyIds.has(id)) return "stopped-early" as const;
    if (!reached.fetched) return "fetch-failed" as const;
    return stored ? ("not-found-on-page" as const) : ("no-figure-yet" as const);
  };

  const weeksFor = (since: string): number => weeksSince(since, input.today);

  const rows: { id: string; product: string; field: CatalogField; stored?: CatalogValue }[] = [];
  const seen = new Set<string>();
  const add = (row: (typeof rows)[number]) => {
    const key = `${row.id}.${row.field}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  const firstById = new Map<string, MergeEntry>();
  for (const e of input.entries) if (!firstById.has(e.id)) firstById.set(e.id, e);
  for (const e of firstById.values()) {
    for (const field of Object.keys(e.fields) as CatalogField[]) {
      const stored = e.fields[field];
      if (stored) add({ id: e.id, product: e.product, field, stored });
    }
  }
  for (const x of input.expected) add({ id: x.id, product: x.product, field: x.field });

  const figures: FigureCoverage[] = [];
  const stored = (key: string): number => {
    const since = input.uncheckedSince[key];
    return since ? weeksFor(since) : 1;
  };
  const next: Record<string, string> = {};
  for (const row of rows) {
    const key = `${row.id}.${row.field}`;
    const base = {
      id: row.id,
      product: row.product,
      field: row.field,
      weeksIfNotSaved: stored(key),
    };
    const verdict = verdicts.get(key);
    if (verdict && verdict.kind !== "unjudged") {
      switch (verdict.kind) {
        case "confirm":
          figures.push({
            ...base,
            status: "confirmed",
            detail: CONFIRMED_DETAIL[input.confirmedBy?.get(key) ?? "read-again"],
            uncheckedWeeks: 0,
          });
          break;
        case "publish":
          figures.push(
            verdict.conditionsOnly
              ? {
                  ...base,
                  status: "confirmed",
                  detail: CONFIRMED_DETAIL["conditions-updated"],
                  uncheckedWeeks: 0,
                }
              : { ...base, status: "changed", uncheckedWeeks: 0 },
          );
          break;
        case "pending":
          figures.push({
            ...base,
            status: "waiting",
            detail: String(verdict.pending.value),
            uncheckedWeeks: 0,
          });
          break;
        case "hold":
          figures.push({
            ...base,
            status: "held",
            detail: verdict.reason,
            uncheckedWeeks: 0,
            heldWeeks: input.heldSince?.[key] ? weeksFor(input.heldSince[key]!) : 1,
          });
          break;
      }
      continue;
    }
    const since = input.uncheckedSince[key] ?? input.today;
    next[key] = since;
    figures.push({
      ...base,
      status: "not-checked",
      cause: causeOf(row.id, row.field, row.stored),
      uncheckedWeeks: weeksFor(since),
    });
  }
  return { figures, uncheckedSince: input.fullRun === false ? { ...input.uncheckedSince } : next };
}
