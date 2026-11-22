import { isCovered, type CatalogField, type CatalogValue } from "./catalog.js";
import type { MergeEntry } from "./catalogMerge.js";

/** A figure that jumped and waits for a second read. seenAt = YYYY-MM-DD of first read. */
export type PendingFigure = { value: number; seenAt: string };

export type HoldReason = "out-of-range" | "unknown-host" | "comparison-route" | "bad-source-url";

export type GuardVerdict =
  | { kind: "unjudged" }
  | { kind: "confirm" }
  | { kind: "publish"; viaPending: boolean }
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

const ARCHIVE = /^https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\/(https?:\/\/.+)$/i;
const JINA = /^https?:\/\/r\.jina\.ai\/(https?:\/\/.+)$/i;
const JINA_HOST = "r.jina.ai";

/** True for a web.archive.org snapshot URL: the figure is as old as the snapshot. */
export function isArchiveUrl(sourceUrl: string): boolean {
  return ARCHIVE.test(sourceUrl.trim());
}

/** Host of the page a figure came from. A web.archive.org snapshot and an r.jina.ai fetch proxy are unwrapped to the host of the page behind them; r.jina.ai itself is never a host. null when unparseable. */
export function sourceHost(sourceUrl: string): string | null {
  let url = sourceUrl.trim();
  url = ARCHIVE.exec(url)?.[1] ?? url;
  url = JINA.exec(url)?.[1] ?? url;
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
function daysBetween(from: string, to: string): number | null {
  const a = DAY.exec(from);
  const b = DAY.exec(to);
  if (!a || !b) return null;
  const ms = (m: RegExpExecArray) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = (ms(b) - ms(a)) / MS_PER_DAY;
  return Number.isFinite(days) ? days : null;
}

function isJump(jump: Jump, current: number, found: number): boolean {
  if (jump.kind === "points") {
    if (jump.zeroIsJump && found === 0 && current !== 0) return true;
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
}): GuardVerdict {
  const { field, current, found, knownHosts, pending, today } = input;
  if (!isCovered(found)) return { kind: "unjudged" };

  const baseline = isCovered(current) ? current : undefined;
  // A value that stayed the same while its conditions appeared or vanished is a change:
  // "unconditional" must not outlive the cap that was added. Different wording of two
  // non-null conditions is not (model paraphrase must not churn the file).
  if (
    baseline &&
    round4(baseline.value) === round4(found.value) &&
    baseline.conditionsKnown === found.conditionsKnown &&
    (baseline.conditions === null) === (found.conditions === null)
  ) {
    return { kind: "confirm" };
  }

  if (found.route === "comparison") return { kind: "hold", reason: "comparison-route" };

  const host = sourceHost(found.sourceUrl);
  if (host === null) return { kind: "hold", reason: "bad-source-url" };
  if (!knownHosts.has(host)) return { kind: "hold", reason: "unknown-host" };

  const limits = FIELD_LIMITS[field];
  if (found.value < limits.min || found.value > limits.max) {
    return { kind: "hold", reason: "out-of-range" };
  }

  if (!baseline) return { kind: "publish", viaPending: false };

  if (isJump(limits.jump, baseline.value, found.value)) {
    const same = pending !== undefined && round4(pending.value) === round4(found.value);
    const days = same ? daysBetween(pending.seenAt, today) : null;
    if (same && days !== null && days >= MIN_DAYS_BETWEEN_READS)
      return { kind: "publish", viaPending: true };
    return {
      kind: "pending",
      pending: { value: found.value, seenAt: same ? pending.seenAt : today },
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
