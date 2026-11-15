import {
  FEE_PERIOD_MONTHS,
  isCovered,
  readAccountFee,
  type CatalogValue,
  type CatalogueEntryLike,
} from "@lavega/core";
import { CATALOGUE_ENTRIES } from "../catalogue-rates";
import { OTHER_CARD, cardLabel, type CardKind } from "../intake/wizard/cardOptions";

export type CardFact = {
  value: number;
  checkedAt: string;
  sourceUrl: string;
  conditions?: string;
  /** Yearly fee only: the amount as the source bills it, when that is not per year. */
  billed?: { cents: number; period: "maand" | "jaar" };
} | null;

export type StatedCardRow = {
  id: string;
  name: string;
  kind: "credit" | "debit";
  yearlyFee: CardFact;
  fxFeePct: CardFact;
  pointsPerEuro: CardFact;
};

const FULL_YEAR_MONTHS = 12;

const byId = new Map<string, CatalogueEntryLike>(CATALOGUE_ENTRIES.map((e) => [e.id, e]));

const withConditions = (c: string | null): { conditions?: string } =>
  c === null || c.trim() === "" ? {} : { conditions: c };

/** A covered number with its date and source, else null (niet bekend). */
function sourced(entry: CatalogueEntryLike, key: "fxFeePct" | "pointsPerEuro"): CardFact {
  const v = entry.fields?.[key] as CatalogValue | undefined;
  if (v === undefined || !isCovered(v)) return null;
  return {
    value: v.value,
    checkedAt: v.checkedAt,
    sourceUrl: v.sourceUrl,
    ...withConditions(v.conditions),
  };
}

/** The yearly fee in cents. The catalogue bills some fees per month; those are
 *  multiplied by the months in the source's own period, never read as yearly. */
function yearlyFee(entry: CatalogueEntryLike): CardFact {
  const fee = readAccountFee(entry);
  if (fee === null) return null;
  const billed = Math.round(fee.value * 100);
  const perYear = Math.round((billed * FULL_YEAR_MONTHS) / FEE_PERIOD_MONTHS[fee.period]);
  return {
    value: perYear,
    checkedAt: fee.checkedAt,
    sourceUrl: fee.sourceUrl,
    ...withConditions(fee.conditions),
    billed: { cents: billed, period: fee.period },
  };
}

/** The stated cards as rows with sourced catalogue facts. A card the bank data
 *  already holds (same catalogue id) is not repeated; an id the catalogue no
 *  longer has gets `unknownLabel` and no facts. */
export function statedCardRows(
  credit: readonly string[],
  debit: readonly string[],
  heldCatalogueIds: ReadonlySet<string>,
  otherLabels: { credit: string; debit: string },
  unknownLabel: string,
): StatedCardRow[] {
  const row = (id: string, kind: CardKind): StatedCardRow | null => {
    const label = kind === "credit" ? "credit" : "debit";
    if (id === OTHER_CARD)
      return {
        id,
        name: otherLabels[label],
        kind: label,
        yearlyFee: null,
        fxFeePct: null,
        pointsPerEuro: null,
      };
    if (heldCatalogueIds.has(id)) return null;
    const entry = byId.get(id);
    if (entry === undefined)
      return {
        id,
        name: unknownLabel,
        kind: label,
        yearlyFee: null,
        fxFeePct: null,
        pointsPerEuro: null,
      };
    const picked = cardLabel(id, otherLabels[label], kind);
    return {
      id,
      name: picked === id ? entry.product : picked,
      kind: label,
      yearlyFee: yearlyFee(entry),
      fxFeePct: sourced(entry, "fxFeePct"),
      pointsPerEuro: sourced(entry, "pointsPerEuro"),
    };
  };
  const out: StatedCardRow[] = [];
  for (const id of new Set(credit)) {
    const r = row(id, "credit");
    if (r !== null) out.push(r);
  }
  for (const id of new Set(debit)) {
    const r = row(id, "debit");
    if (r !== null) out.push(r);
  }
  return out;
}

/** The names of stated cards left out of the rows because the bank data holds
 *  them, so the page can say where they went. */
export function heldStatedNames(
  credit: readonly string[],
  debit: readonly string[],
  heldCatalogueIds: ReadonlySet<string>,
  otherLabels: { credit: string; debit: string },
): string[] {
  const names: string[] = [];
  for (const [ids, kind] of [
    [credit, "credit"],
    [debit, "debit"],
  ] as const)
    for (const id of new Set(ids)) {
      if (id === OTHER_CARD || !heldCatalogueIds.has(id)) continue;
      const picked = cardLabel(id, otherLabels[kind], kind);
      names.push(picked === id ? (byId.get(id)?.product ?? id) : picked);
    }
  return names;
}

/** Yearly fees of the known cards together; `unknownCount` cards are left out. */
export function yearlyFeeTotal(rows: readonly StatedCardRow[]): {
  totalCents: number;
  unknownCount: number;
} {
  let totalCents = 0;
  let unknownCount = 0;
  for (const r of rows) {
    if (r.yearlyFee === null) unknownCount++;
    else totalCents += r.yearlyFee.value;
  }
  return { totalCents, unknownCount };
}
