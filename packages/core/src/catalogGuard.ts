import { FEE_PERIOD_MONTHS, type FeePeriod } from "./accountCosts.js";
import { isCovered, type CatalogField, type CatalogValue } from "./catalog.js";
import type { MergeEntry } from "./catalogMerge.js";

/** A figure that jumped and waits for a second read. seenAt = YYYY-MM-DD of first read. */
export type PendingFigure = {
  value: number;
  /** accountFee only. Absent in state written before fees were swept. */
  period?: FeePeriod;
  seenAt: string;
};

export type HoldReason =
  | "out-of-range"
  | "unknown-host"
  | "comparison-route"
  | "bad-source-url"
  | "conflicting-read"
  | "fee-period-missing"
  | "change-not-cross-checked"
  | "held-for-person";

export type GuardVerdict =
  | { kind: "unjudged" }
  | { kind: "confirm" }
  | {
      kind: "publish";
      viaPending: boolean;
      /** Same figure as stored; only its conditions text appeared or its known-ness changed. */
      conditionsOnly?: true;
    }
  | { kind: "pending"; pending: PendingFigure }
  | { kind: "hold"; reason: HoldReason };

type Jump =
  | { kind: "points"; max: number; zeroIsJump: boolean }
  | { kind: "ratio"; factor: number };

export const FIELD_LIMITS: Readonly<
  Record<CatalogField, { min: number; max: number; jump: Jump }>
> = {
  fxFeePct: { min: 0, max: 5, jump: { kind: "points", max: 1, zeroIsJump: true } },
  convertFeePct: { min: 0, max: 5, jump: { kind: "points", max: 1, zeroIsJump: true } },
  interestPct: { min: 0, max: 10, jump: { kind: "points", max: 1.5, zeroIsJump: true } },
  cashbackPct: { min: 0, max: 10, jump: { kind: "points", max: 1, zeroIsJump: false } },
  pointsPerEuro: { min: 0, max: 10, jump: { kind: "ratio", factor: 2 } },
  accountFee: { min: 0, max: 1000, jump: { kind: "ratio", factor: 2 } },
};

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The amount the limits and the jump test apply to: a fee per year, any other field as is.
 *  A fee without a period cannot be annualised and is taken as stated. */
function limitValue(field: CatalogField, v: CatalogValue): number {
  return field === "accountFee" && v.period
    ? v.value * (12 / FEE_PERIOD_MONTHS[v.period])
    : v.value;
}

/** Same figure: value equal, and for a fee the period equal too. A fee with no period on either side equals nothing. */
function sameFigure(field: CatalogField, a: CatalogValue, b: CatalogValue): boolean {
  if (round4(a.value) !== round4(b.value)) return false;
  return field !== "accountFee" || (a.period !== undefined && a.period === b.period);
}

const ARCHIVE = /^https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\/(https?:\/\/.+)$/i;
const JINA = /^https?:\/\/r\.jina\.ai\/(https?:\/\/.+)$/i;
const JINA_HOST = "r.jina.ai";

/** True for a web.archive.org snapshot URL: the figure is as old as the snapshot. */
export function isArchiveUrl(sourceUrl: string): boolean {
  return ARCHIVE.test(sourceUrl.trim());
}

/** The URL of the page behind a web.archive.org snapshot or an r.jina.ai fetch proxy; any other URL, trimmed, as is. */
export function unwrapSourceUrl(sourceUrl: string): string {
  let url = sourceUrl.trim();
  url = ARCHIVE.exec(url)?.[1] ?? url;
  return JINA.exec(url)?.[1] ?? url;
}

/** Host of the page a figure came from. A web.archive.org snapshot and an r.jina.ai fetch proxy are unwrapped to the host of the page behind them; r.jina.ai itself is never a host. null when unparseable. */
export function sourceHost(sourceUrl: string): string | null {
  const url = unwrapSourceUrl(sourceUrl);
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host && host !== JINA_HOST ? host : null;
  } catch {
    return null;
  }
}

/** A second read counts only in a later weekly run: at least this many days after the first. */
export const MIN_DAYS_BETWEEN_READS = 6;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Whole days from `from` to `to` (YYYY-MM-DD). null when either is unparseable. Calendar arithmetic only, no clock. */
export function wholeDaysBetween(from: string, to: string): number | null {
  const a = DAY.exec(from);
  const b = DAY.exec(to);
  if (!a || !b) return null;
  const ms = (m: RegExpExecArray) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = (ms(b) - ms(a)) / MS_PER_DAY;
  return Number.isFinite(days) ? days : null;
}

/** Points fields with zeroIsJump: a move to zero or from zero is a jump, whatever its size. */
function isJump(jump: Jump, current: number, found: number): boolean {
  if (jump.kind === "points") {
    if (jump.zeroIsJump && (found === 0) !== (current === 0)) return true;
    return Math.abs(found - current) > jump.max;
  }
  if (current === 0 || found === 0) return current !== found;
  return found > current * jump.factor || found < current / jump.factor;
}

export function judgeField(input: {
  field: CatalogField;
  current: CatalogValue | undefined;
  found: CatalogValue;
  knownHosts: ReadonlySet<string>;
  pending: PendingFigure | undefined;
  today: string;
  /** Answer of the cross-check on the STORED figure when the run read a different one: still on the
   *  page (conflicting), gone from it (the change may go on), or no clear answer (change held). */
  storedCheck?: "still-stated" | "gone" | "unresolved";
  /** The figure is on the manual hold list: any covered read that differs from the stored one waits for a person. */
  manualHold?: boolean;
}): GuardVerdict {
  const { field, current, found, knownHosts, pending, today } = input;
  if (!isCovered(found)) {
    // An uncovered read of the very number we already hold, from a host the issuer is known by,
    // re-confirms it. The stored conditions and source stay: this read proves nothing new.
    if (isCovered(current) && Number.isFinite(found.value) && sameFigure(field, current!, found)) {
      // A regex read counts only on the page the stored figure came from; the model's
      // confirm step (route "agent") may use any document of the issuer.
      const host = sourceHost(found.sourceUrl);
      const trusted = found.route === "agent" || found.sourceUrl === current!.sourceUrl;
      if (host !== null && knownHosts.has(host) && trusted) return { kind: "confirm" };
    }
    return { kind: "unjudged" };
  }

  const baseline = isCovered(current) ? current : undefined;
  // Same value: only conditions appearing (null -> text) is new information and publishes, so
  // "unconditional" does not outlive a cap that was added. Text -> null never drops a stored
  // condition on one read that did not mention it. Wording differences are not changes.
  const sameValue = !!baseline && sameFigure(field, baseline, found);
  if (
    baseline &&
    sameValue &&
    baseline.conditionsKnown === found.conditionsKnown &&
    (found.conditions === null || baseline.conditions !== null)
  ) {
    return { kind: "confirm" };
  }

  if (input.manualHold) return { kind: "hold", reason: "held-for-person" };

  // A fee without its period cannot be published: it would replace or start a figure whose unit is unknown.
  if (field === "accountFee" && found.period === undefined) {
    return { kind: "hold", reason: "fee-period-missing" };
  }

  if (found.route === "comparison") return { kind: "hold", reason: "comparison-route" };

  const host = sourceHost(found.sourceUrl);
  if (host === null) return { kind: "hold", reason: "bad-source-url" };
  if (!knownHosts.has(host)) return { kind: "hold", reason: "unknown-host" };

  const limits = FIELD_LIMITS[field];
  const foundLimit = limitValue(field, found);
  if (foundLimit < limits.min || foundLimit > limits.max) {
    return { kind: "hold", reason: "out-of-range" };
  }

  if (!baseline) return { kind: "publish", viaPending: false };
  if (sameValue) return { kind: "publish", viaPending: false, conditionsOnly: true };

  // Both the stored and the new figure are on the page: one of the two reads is wrong,
  // and the stored one has the longer record. Never pass the new one on as a change.
  if (input.storedCheck === "still-stated") return { kind: "hold", reason: "conflicting-read" };
  if (input.storedCheck === "unresolved") {
    return { kind: "hold", reason: "change-not-cross-checked" };
  }

  if (isJump(limits.jump, limitValue(field, baseline), foundLimit)) {
    const same =
      pending !== undefined &&
      round4(pending.value) === round4(found.value) &&
      (field !== "accountFee" || pending.period === found.period);
    const days = same ? wholeDaysBetween(pending.seenAt, today) : null;
    if (same && days !== null && days >= MIN_DAYS_BETWEEN_READS)
      return { kind: "publish", viaPending: true };
    return {
      kind: "pending",
      pending: {
        value: found.value,
        ...(found.period ? { period: found.period } : {}),
        seenAt: same ? pending.seenAt : today,
      },
    };
  }
  return { kind: "publish", viaPending: false };
}

/** Hosts a figure may legitimately come from, per issuer. */
export function knownHostsByIssuer(
  products: Readonly<
    Record<
      string,
      {
        issuer?: string;
        termsUrl?: string | null;
        pdfUrl?: string | null;
        foundUrl?: string | null;
        docUrl?: string | null;
      }
    >
  >,
  entries: readonly MergeEntry[],
): Map<string, Set<string>> {
  const byIssuer = new Map<string, Set<string>>();
  const add = (issuer: string, url: string | null | undefined) => {
    if (!url) return;
    const host = sourceHost(url);
    if (host === null) return;
    const set = byIssuer.get(issuer) ?? new Set<string>();
    set.add(host);
    byIssuer.set(issuer, set);
  };
  for (const [id, p] of Object.entries(products)) {
    const issuer = p.issuer ?? id;
    add(issuer, p.termsUrl);
    add(issuer, p.pdfUrl);
    add(issuer, p.foundUrl);
    add(issuer, p.docUrl);
  }
  for (const e of entries) {
    const issuer = e.issuer ?? e.id;
    for (const v of Object.values(e.fields)) add(issuer, v?.sourceUrl);
  }
  return byIssuer;
}
