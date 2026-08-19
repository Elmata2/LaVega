/* SENDING THE WHOLE DOCUMENT IS WHERE THE MONEY GOES.
 *
 * Measured on five pinned sources: only 39% of a tariff document sits anywhere
 * near a currency term, and Amex's 50k-character cardholder agreement is 12% —
 * we were paying a model to read insurance clauses and cash-advance tables to
 * find one row.
 *
 * THE TRAP, and it is why this is not a two-line regex. The exhaustive-document
 * rule earns `conditions: null` only when the model SAW a cap priced on some
 * OTHER row of the same document — ING's sheet writes "tot EUR 500 ... 0,00%"
 * and "boven EUR 500 2,00%" for the creditcard, which is what proves the sheet
 * expresses caps at all and therefore that the unqualified debit row is
 * genuinely unqualified. Slice to the currency rows alone and that evidence
 * disappears, `capsExpressedElsewhere` comes back false, and every figure
 * quietly reverts to refused. The cost saving would have read as a quality
 * collapse with no error anywhere.
 *
 * So three kinds of region are kept, and the third is the whole point:
 *   1. the neighbourhood of every currency term — the rows being asked about;
 *   2. anything that states a cap, tier, threshold or allowance ANYWHERE — the
 *      evidence the rule runs on;
 *   3. footnote and validity lines — where the asterisk that disqualifies a row
 *      actually lives, and where the document states its own date.
 *
 * Pure: no I/O, no clock. The caller passes text and gets text.
 */

/** The rows we are asking about. Vocabulary matters: de Volksbank writes
 *  "valutawisselkosten" and never "koersopslag". */
const FX_TERM =
  /koersopslag|wisselkoers|valutakoers|valutawisselkosten|valutakosten|vreemde valuta|buitenlands geld|currency conversion|exchange rate fee|foreign (?:exchange|transaction) fee/gi;

/** The evidence the exhaustive-document rule needs. Kept from ANYWHERE in the
 *  document, deliberately — a cap on the creditcard row proves something about
 *  the debit row precisely because it is elsewhere. */
const CAP_TERM =
  /\btot\s*€|\bboven\s*€|\bvanaf\s*€|per maand|per kalenderjaar|per maandcyclus|incassoperiode|vrijgesteld|\blimiet\b|\bstaffel\b|\bmaximaal\b|\bmax\.|up to\s*€|up to\s*EUR|per calendar (?:month|year)|threshold|allowance|fair usage/gi;

/** Where the asterisk that disqualifies a row lives, and where a document states
 *  its own date — both cheap to keep and expensive to lose. */
const NOTE_LINE =
  /^\s*(?:[*†‡¹²³]|\(\d{1,2}\)|\d{1,2}\s+[A-Z])|geldig\s+(?:vanaf|per)|van toepassing vanaf|\bper\s+(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+\d{4}/gim;

export type SliceOptions = {
  /** Characters kept before a match. Generous, because a table row's label often
   *  sits well left of the number in `pdftotext -layout` output. */
  before?: number;
  /** Characters kept after a match. */
  after?: number;
  /** Below this the whole document is cheaper to send than to reason about. */
  minLength?: number;
};

export type SliceResult = {
  text: string;
  /** What fraction of the original survived, for the sweep to log. A slice that
   *  keeps everything is not a bug — a dense tariff sheet legitimately is all
   *  relevant — but a slice that keeps 2% deserves a human's attention. */
  kept: number;
  regions: number;
  /** True when the slicer declined and returned the document untouched. */
  whole: boolean;
};

/** Merge overlapping windows so the joined text reads in document order and no
 *  passage appears twice. */
function merge(spans: [number, number][], len: number): [number, number][] {
  spans.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of spans) {
    const a = Math.max(0, s);
    const b = Math.min(len, e);
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function sliceForExtraction(text: string, opts: SliceOptions = {}): SliceResult {
  const before = opts.before ?? 700;
  const after = opts.after ?? 900;
  const minLength = opts.minLength ?? 6_000;

  // A short document is not worth slicing: the risk of cutting the one line that
  // mattered outweighs a saving measured in fractions of a cent.
  if (text.length <= minLength) return { text, kept: 1, regions: 1, whole: true };

  const spans: [number, number][] = [];
  for (const re of [FX_TERM, CAP_TERM]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      spans.push([at - before, at + after]);
    }
  }
  NOTE_LINE.lastIndex = 0;
  for (const m of text.matchAll(NOTE_LINE)) {
    const at = m.index ?? 0;
    // A footnote is worth its line, not a paragraph either side.
    spans.push([at - 80, at + 320]);
  }

  // Nothing matched: the document may still hold the answer in wording we do not
  // know yet, and returning an empty slice would turn "we did not look properly"
  // into "the document says nothing". Send it whole and let the model decide.
  if (!spans.length) return { text, kept: 1, regions: 1, whole: true };

  const regions = merge(spans, text.length);
  const sliced = regions.map(([a, b]) => text.slice(a, b)).join("\n[…]\n");

  // If slicing barely helps, the joins are pure downside — they can split a table
  // row from its header and make the text harder to read than the original.
  if (sliced.length > text.length * 0.8) return { text, kept: 1, regions: 1, whole: true };

  return { text: sliced, kept: sliced.length / text.length, regions: regions.length, whole: false };
}
