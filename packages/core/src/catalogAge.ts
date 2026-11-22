import type { CatalogField, CatalogValue } from "./catalog.js";

export const MAX_FIGURE_AGE_MONTHS = 12;

/** Fields for which an aged-out figure leaves the ranking. Empty in slice 1 (spec: staged). */
export const AGE_REMOVAL_FIELDS: ReadonlySet<CatalogField> = new Set<CatalogField>();

export function lastConfirmed(v: CatalogValue): string {
  return v.confirmedAt ?? v.checkedAt;
}

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar months, no clock: 12 or more months since the date counts as old. A malformed date counts as old. */
export function isOlderThanMaxAge(v: CatalogValue, today: string): boolean {
  const from = FULL_DATE.exec(lastConfirmed(v));
  const to = FULL_DATE.exec(today);
  if (!from || !to) return true;
  const [fy, fm, fd] = [Number(from[1]), Number(from[2]), Number(from[3])];
  const [ty, tm, td] = [Number(to[1]), Number(to[2]), Number(to[3])];
  if (fm < 1 || fm > 12 || fd < 1 || fd > 31) return true;
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return months >= MAX_FIGURE_AGE_MONTHS;
}

export function isAgedOut(
  field: CatalogField,
  v: CatalogValue,
  today: string,
  enabled: ReadonlySet<CatalogField> = AGE_REMOVAL_FIELDS,
): boolean {
  return enabled.has(field) && isOlderThanMaxAge(v, today);
}
