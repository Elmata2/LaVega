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
          const cond = THRESHOLD.exec(line) ?? THRESHOLD.exec(evidence);
          out.push({ field: "fxFeePct", value, line: evidence, conditions: cond ? cond[0].trim() : null });
        }
      }
      // a line about koersopslag with no number states nothing
    }

    context.push(line);
    if (context.length > CONTEXT_LINES) context.shift();
  }
  return out;
}
