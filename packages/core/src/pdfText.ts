/** A figure read out of a provider's own tariff document.
 *
 *  This route exists because testing ing.nl and concluding "ING is unreachable"
 *  was wrong: the block is on the HTML host, and the tariff sheet sits on
 *  assets.ing.com with no protection at all — it fetches with no User-Agent.
 *  These documents are legally required, stable across editions, and carry the
 *  CONDITIONS as well as the rates, which is the half that is otherwise hardest
 *  to get. */
export type PdfFigure = { field: "fxFeePct"; value: number; line: string; conditions: string | null };

/** "1,40 %" and "2,00%" both appear in the same document. */
const PCT = /(\d{1,2})[,.](\d{1,2})\s*%/;
/** A threshold that makes the rate conditional: "tot € 500 per creditcardperiode". */
const THRESHOLD = /\b(tot|boven|vanaf)\b[^%]{0,60}?€\s?[\d.]+[^%]{0,40}/i;
/** The same pattern, scanning, so the clause that GOVERNS a figure can be picked
 *  out rather than merely the first one on the row. */
const THRESHOLD_ALL = new RegExp(THRESHOLD.source, "gi");
/** A word that flips the tier mid-sentence: "Tot € 1000 geen koersopslag …,
 *  daarboven 2,00%". Both tiers on ONE line, so nearest-preceding is not enough —
 *  the threshold there names the tier in which the rate is ZERO. */
const TIER_FLIP = /\b(daarboven|daarna|erna)\b/i;

/** The threshold clause that governs the figure at `pctIndex`, or null.
 *
 *  Two rules, both learned from the real document:
 *
 *  1. Only a clause BEFORE the figure can govern it, and of those the nearest
 *     preceding one wins. A clause after the figure describes the next row.
 *  2. If a tier-flip word sits between that clause and the figure, the clause
 *     names the OTHER tier, so the condition must run through the flip word.
 *     Otherwise the rate carries the condition under which it does NOT apply —
 *     worse than no condition, because it looks established. */
function governingThreshold(text: string, pctIndex: number): string | null {
  THRESHOLD_ALL.lastIndex = 0;
  let governing: RegExpExecArray | null = null;
  for (let m = THRESHOLD_ALL.exec(text); m; m = THRESHOLD_ALL.exec(text)) {
    if (m.index >= pctIndex) break;
    governing = m;
  }
  if (!governing) return null;
  const span = text.slice(governing.index, pctIndex);
  const flip = TIER_FLIP.exec(span);
  if (!flip) return governing[0].trim();
  return span.slice(0, flip.index + flip[0].length).trim();
}

/** How many preceding lines travel with a figure as its evidence.
 *
 *  A single line is NOT the unit of meaning in a tariff table, and reading one
 *  line at a time gets both halves wrong on the real document:
 *
 *  - the product sits on a heading two lines up — "Met een Betaalpas in het
 *    buitenland" / "Bij winkels…" / "• In euro's € 0,00" / "• In vreemde valuta
 *    1,40 % koersopslag" — so a bare line can never be attributed to a card;
 *  - the cap sits above the rate — "• Vreemde valuta opnemen tot € 500 euro per"
 *    / "creditcardperiode2 … +" / "0,00% koersopslag" — so a bare line reports a
 *    capped 0% as unconditional, which is the Revolut mistake in a new document.
 *
 *  Three lines is what those two layouts need; the percentage itself is still
 *  read from the figure's OWN line, so no number is ever imported from a
 *  neighbouring row. */
const CONTEXT_LINES = 3;

export function readIngTariffs(text: string): PdfFigure[] {
  const out: PdfFigure[] = [];
  const context: string[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || /^\d{1,3}$/.test(line)) continue; // blank lines and page numbers state nothing

    if (/koersopslag/i.test(line)) {
      const m = PCT.exec(line); // the value comes from THIS line, never from the context
      if (m) {
        const value = Number(`${m[1]}.${m[2]}`);
        if (Number.isFinite(value)) {
          const evidence = [...context, line].join(" · ");
          // The figure's OWN row wins: "tot € 500 … 0,00%" and "boven € 500 …
          // 2,00%" are adjacent rows, and taking the nearest threshold stamps the
          // 2% with the cap under which it does not apply. Only when the row
          // states no threshold does the block above it speak for it.
          const cond =
            governingThreshold(line, m.index) ??
            governingThreshold(evidence, evidence.length - line.length + m.index);
          out.push({ field: "fxFeePct", value, line: evidence, conditions: cond });
        }
      }
      // a line about koersopslag with no number states nothing
    }

    context.push(line);
    if (context.length > CONTEXT_LINES) context.shift();
  }
  return out;
}
