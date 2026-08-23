import { isCovered, type CatalogRoute, type CatalogValue } from "@lavega/core";

export type RouteAttempt = { route: CatalogRoute; run: () => Promise<CatalogValue | null> };
export type LadderResult = { value: CatalogValue | null; tried: CatalogRoute[]; reason: string | null };

/** Best first. The provider's own page and its own PDF outrank anything derived,
 *  and the agent is last because it costs money — not because it is inaccurate.
 *  Measured, it is accurate: it corrected bank.nl on Knab. */
const ORDER: CatalogRoute[] = ["provider-page", "provider-pdf", "wayback", "comparison", "agent"];

export function ladderOrder(): CatalogRoute[] {
  return [...ORDER];
}

/** Which PARTIAL to keep when NO rung came back covered — and deliberately not
 *  the ladder order.
 *
 *  The ladder is ordered by cost and by how authoritative a source is. That is the
 *  right order for choosing a COVERED answer, and the wrong one for choosing
 *  between two figures that both fell short, because what separates those is not
 *  the source's authority but whether the rung can show the number belongs to THIS
 *  product. Measured on two products this week:
 *
 *  - ABN AMRO betaalpas: the provider-page regex reads 2% (the credit card's rate,
 *    and a cash-withdrawal row at that) while the model reads 1,2% quoting
 *    "Met Betaalpas EUR 0,15 en 1,2% valutakoersopslag per keer" under the heading
 *    "Betalen via betaalautomaat buitenland in buitenlands geld". The truth is 1,2%.
 *  - Knab creditcard: the regex reads the debit row's 1,4%; the model reads 2%
 *    quoting "Betalingen in vreemde valuta 2% koersopslag" under "Knab Creditcard".
 *
 *  Both are refused before the app either way, so nothing wrong is ever served.
 *  But state.json's lastValue and the change-detection diff are read by people,
 *  and a committed artifact carrying the wrong row's number is a rumour with our
 *  name on it. So a partial that was checked against the text it came out of —
 *  quote found in the page, the number found inside that quote, the heading
 *  standing at or before it — outranks one that was pattern-matched out of
 *  stripped HTML with nothing tying it to the product asked about.
 *
 *  Within each group the ladder's own order is kept. */
const PARTIAL_ORDER: CatalogRoute[] = ["wayback", "agent", "provider-pdf", "provider-page", "comparison"];

export function partialOrder(): CatalogRoute[] {
  return [...PARTIAL_ORDER];
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
        // The best-EVIDENCED partial, not the highest rung's: see PARTIAL_ORDER.
        if (!partial || PARTIAL_ORDER.indexOf(value.route) < PARTIAL_ORDER.indexOf(partial.route)) {
          partial = value;
        }
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
