/** How a figure was obtained, best first. The tier travels WITH the value
 *  because "99% covered" that is half model-derived is a different product from
 *  99% primary, and one number would hide that. */
export type CatalogRoute = "provider-page" | "provider-pdf" | "wayback" | "comparison" | "agent";

export type CatalogField = "fxFeePct" | "convertFeePct" | "cashbackPct" | "pointsPerEuro" | "interestPct";

export type CatalogValue = {
  value: number;
  route: CatalogRoute;
  /** Where it came from. A number without one is a rumour. */
  sourceUrl: string;
  /** The date the SOURCE stated, else the sweep date. Never the date we fetched
   *  it under a different source's stamp — that shipped twice. */
  checkedAt: string;
  /** null means genuinely unconditional. It does NOT mean unknown; that is what
   *  `conditionsKnown` is for, and conflating the two is the whole reason this
   *  field exists. */
  conditions: string | null;
  conditionsKnown: boolean;
};

export type CatalogEntry = {
  id: string;
  product: string;
  fields: Partial<Record<CatalogField, CatalogValue>>;
};

/** Covered = a value, a source, a date, AND its conditions. All four.
 *  Revolut is the standing example of what the fourth one costs. */
export function isCovered(v: CatalogValue | undefined): boolean {
  if (!v) return false;
  if (!Number.isFinite(v.value)) return false;
  if (!v.sourceUrl.trim()) return false;
  if (!v.checkedAt.trim()) return false;
  return v.conditionsKnown;
}

const ROUTES: CatalogRoute[] = ["provider-page", "provider-pdf", "wayback", "comparison", "agent"];

export function coverage(
  entries: readonly CatalogEntry[],
  field: CatalogField,
): { covered: number; total: number; byRoute: Record<CatalogRoute, number> } {
  const byRoute = Object.fromEntries(ROUTES.map((r) => [r, 0])) as Record<CatalogRoute, number>;
  let covered = 0;
  for (const e of entries) {
    const v = e.fields[field];
    if (!isCovered(v)) continue;
    covered++;
    byRoute[(v as CatalogValue).route]++;
  }
  return { covered, total: entries.length, byRoute };
}
