import { isCovered, type CatalogRoute, type CatalogValue } from "./catalog.js";

export type RouteAttempt = { route: CatalogRoute; run: () => Promise<CatalogValue | null> };
export type LadderResult = { value: CatalogValue | null; tried: CatalogRoute[]; reason: string | null };

/** Best first. The provider's own page and its own PDF outrank anything derived,
 *  and the agent is last because it costs money — not because it is inaccurate.
 *  Measured, it is accurate: it corrected bank.nl on Knab. */
const ORDER: CatalogRoute[] = ["provider-page", "provider-pdf", "wayback", "comparison", "agent"];

export function ladderOrder(): CatalogRoute[] {
  return [...ORDER];
}

/** Which of the four parts a figure is missing. Mirrors isCovered's checks so the
 *  recorded reason names the actual shortfall rather than a guess at it. */
function shortfall(v: CatalogValue): string {
  if (!Number.isFinite(v.value)) return "not a number";
  if (!v.sourceUrl.trim()) return "no source";
  if (!v.checkedAt.trim()) return "no date";
  return "conditions not established";
}

/** Try routes in ladder order, the first COVERED answer wins, and record what was
 *  tried.
 *
 *  A throwing route does NOT end the sweep: half these sources 403, time out or
 *  moved, and one unreachable host must not cost us the other four routes. When
 *  everything falls short the reason is kept, because "we could not read it" is a
 *  useful answer and a silent zero is a wrong one.
 *
 *  "Answers" means isCovered — value, source, date AND conditions. A figure with
 *  only three of the four does not stop the ladder, because provider-page sorts
 *  ABOVE provider-pdf and cannot establish a cap from stripped HTML: stopping
 *  there would skip the tariff PDF, the one rung that carries conditions, and the
 *  product would be refused at the server with its covering source never fetched.
 *  96 of the 124 products are readable=yes with a termsUrl, so that is the default
 *  shape. It is also not thrown away — the best partial comes back WITH the reason
 *  it fell short, and isCovered() stays the thing that decides what gets served. */
export async function runLadder(attempts: readonly RouteAttempt[]): Promise<LadderResult> {
  const ordered = [...attempts].sort((a, b) => ORDER.indexOf(a.route) - ORDER.indexOf(b.route));
  const tried: CatalogRoute[] = [];
  const reasons: string[] = [];
  let partial: CatalogValue | null = null;

  for (const attempt of ordered) {
    tried.push(attempt.route);
    try {
      const value = await attempt.run();
      if (value && isCovered(value)) return { value, tried, reason: null };
      if (value) {
        partial ??= value; // the highest rung's partial, not the last one's
        reasons.push(`${attempt.route}: ${shortfall(value)}`);
      } else {
        reasons.push(`${attempt.route}: no figure`);
      }
    } catch (e) {
      reasons.push(`${attempt.route}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { value: partial, tried, reason: reasons.join(" · ") || null };
}
