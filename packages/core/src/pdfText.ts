/** A figure read out of a provider's own tariff document.
 *
 *  This route exists because testing ing.nl and concluding "ING is unreachable"
 *  was wrong: the block is on the HTML host, and the tariff sheet sits on
 *  assets.ing.com with no protection at all — it fetches with no User-Agent.
 *  These documents are legally required, stable across editions, and carry the
 *  CONDITIONS as well as the rates, which is the half that is otherwise hardest
 *  to get. */
export type PdfFigure = {
  field: "fxFeePct";
  value: number;
  line: string;
  /** The clause that governs this figure, or null for "this row states none".
   *  null is NOT "unknown" — see `conditionsKnown`. */
  conditions: string | null;
  /** Whether this parser ESTABLISHED the conditions, rather than merely failing
   *  to match one. The sweep used to hard-code this as true for every PDF figure,
   *  which made "my regex found no threshold" and "this rate has no conditions"
   *  the same value — the conflation the Revolut incident is named after. */
  conditionsKnown: boolean;
};

/** "1,40 %" and "2,00%" both appear in the same document. */
const PCT = /(\d{1,2})[,.](\d{1,2})\s*%/;
/** A threshold that makes the rate conditional: "tot € 500 per creditcardperiode".
 *
 *  The tail is WORDS ONLY, and deliberately so. `pdftotext -layout` interleaves
 *  the columns of a tariff table, so the row arrives as "• Vreemde valuta opnemen
 *  tot € 500 euro per | 4,00% van het opgenomen bedrag" with the clause's real
 *  ending ("creditcardperiode") on the next line. A greedy `[^%]{0,40}` swallowed
 *  the 4,00 — the ATM withdrawal FEE from the column beside it — and the stored
 *  condition read "tot € 500 euro per 4,00". `conditions` is rendered as a note
 *  on screen and read aloud by the chat agent, so that is user-visible text
 *  asserting a number the threshold does not contain. A number after the amount
 *  belongs to another column until something proves otherwise. */
const THRESHOLD = /\b(tot|boven|vanaf)\b[^%]{0,60}?€\s?[\d.]+(?:\s+[A-Za-zÀ-ÿ][\w-]*){0,10}/i;
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
          // Established only when NAMED. Silence in a three-line window is not
          // evidence of absence: this very document caps the ING Creditcard Max
          // 0% in footnote 2 ("tot het aangegeven maximum per creditcardperiode")
          // with nothing in its row to show for it, and no local rule can tell
          // that row apart from the debit card's genuinely uncapped 1,40%.
          out.push({ field: "fxFeePct", value, line: evidence, conditions: cond, conditionsKnown: cond !== null });
        }
      }
      // a line about koersopslag with no number states nothing
    }

    context.push(line);
    if (context.length > CONTEXT_LINES) context.shift();
  }
  return out;
}

const MONTHS_NL = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/** "Deze brochure is geldig vanaf 15 juni 2026" -> "2026-06-15".
 *
 *  A figure keeps the date of the SOURCE that stated it. The sweep re-reads the
 *  VALUE from this URL every week while its date came from a constant typed into
 *  state.json by hand — and ING reuses the asset URL across editions (the file is
 *  still named `_2023.pdf` and holds the June 2026 edition). So the next edition's
 *  rate would have arrived stamped with this edition's date: dating a figure by
 *  something other than the source that stated it, which this project has now
 *  shipped twice. The document says it in machine-readable words on page 1. */
export function readDocumentDate(text: string): string | null {
  // THE FID FORMAT, and it is the one that matters most. The EU Payment Accounts
  // Directive prescribes the layout of an "Informatiedocument betreffende de
  // vergoedingen", and it dates itself with a bare label: "Naam van de rekening:
  // BasisPakket Betalen / Datum: 1 januari 2026". Neither pattern below matched
  // it, so 32 of 43 covered figures were stamped with the day they were READ
  // rather than the day their document took effect — in the very document genre
  // that had just become the sweep's primary source.
  const fid = /\b(?:datum|ingangsdatum|geldig\s+op)\s*:\s*(\d{1,2})\s+([a-zA-Z\u00C0-\u00FF]+)\s+(\d{4})/i.exec(text);
  if (fid) {
    const month = MONTHS_NL.indexOf(fid[2].toLowerCase());
    const day = Number(fid[1]);
    if (month >= 0 && day >= 1 && day <= 31) {
      return `${fid[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  // A BARE "per <day> <month> <year>", which fell between the other two patterns:
  // one demanded the word "geldig", the other demanded no day at all. de
  // Volksbank's brands head their Tarievenwijzer "Tarievenwijzer Betalen & Sparen
  // per 1 februari 2026" and ASN's says "per 1 juli 2026" — so the documents were
  // read as undated and their figures took the day we fetched them. Guarded the
  // same way as the month-year form: it must sit on a title-like line near the
  // top, so "wij verhogen per 1 januari 2025 de tarieven" in body prose is not
  // mistaken for the document's own date.
  const bare = /\bper\s+(\d{1,2})\s+([a-zA-Z\u00C0-\u00FF]+)\s+(\d{4})/i.exec(text.slice(0, 2000));
  if (bare) {
    const month = MONTHS_NL.indexOf(bare[2].toLowerCase());
    const day = Number(bare[1]);
    const at = bare.index ?? 0;
    const start = text.lastIndexOf("\n", at) + 1;
    const end = text.indexOf("\n", at);
    const line = text.slice(start, end === -1 ? undefined : end).trim();
    const titleLike = line.length <= 140 && !/[.,;:]$/.test(line);
    if (month >= 0 && day >= 1 && day <= 31 && titleLike) {
      return `${bare[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  // "GELDEN VANAF" / "GELDT VANAF", the fifth format in one day. ABN's rate page
  // ends its ladder with "De rentes gelden vanaf 1 mei 2025" and the pattern below
  // wanted the adjective "geldig", not the verb — so a fifteen-month-old rate was
  // stamped with the day it was fetched and would have looked like the freshest
  // figure in the table.
  const verb = /\b(?:gelden|geldt)\s+vanaf\s+(\d{1,2})\s+([a-zA-Z\u00C0-\u00FF]+)\s+(\d{4})/i.exec(text);
  if (verb) {
    const month = MONTHS_NL.indexOf(verb[2].toLowerCase());
    const day = Number(verb[1]);
    if (month >= 0 && day >= 1 && day <= 31) {
      return `${verb[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const m = /\bgeldig\s+(?:vanaf|per|met\s+ingang\s+van)\s+(\d{1,2})\s+([a-zA-Z\u00C0-\u00FF]+)\s+(\d{4})/i.exec(text);
  if (m) {
    const month = MONTHS_NL.indexOf(m[2].toLowerCase());
    const day = Number(m[1]);
    if (month >= 0 && day >= 1 && day <= 31) {
      return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return readMonthYearEdition(text);
}

/** A DOCUMENT THAT DATES ITSELF BY MONTH, WITH NO DAY.
 *
 *  Amex's cardholder agreement carries "PER MAART 2022" in its running header and
 *  nowhere states a day. The day-requiring pattern above found nothing, so eight
 *  covered figures were stamped with the day they were READ — 2026-08-19 — which
 *  presents a four-and-a-half-year-old document as today's. That is the precise
 *  failure the date rule exists to stop, and it is worse than a missing date:
 *  cardTerms' age-aware precedence would let that figure beat a genuinely newer
 *  one, because it looks like the freshest thing in the cache.
 *
 *  Guarded against prose. "per januari 2025 gaan de tarieven omhoog" in a sentence
 *  is not the document's own edition, so a bare month-year counts only where
 *  documents actually date themselves: on the cover (the first 2.000 characters)
 *  or in a running header, which repeats. The day is set to the 1st, the earliest
 *  the edition can have been in force — the conservative direction, since it makes
 *  the figure look older rather than fresher than it is. */
function readMonthYearEdition(text: string): string | null {
  const re = /\b(?:geldig\s+per|per|versie|uitgave|editie)\s+([a-zA-Z\u00C0-\u00FF]+)\s+(\d{4})\b/gi;
  const found: { at: number; iso: string }[] = [];
  for (const m of text.matchAll(re)) {
    const month = MONTHS_NL.indexOf(m[1].toLowerCase());
    const year = Number(m[2]);
    if (month < 0 || year < 1990 || year > 2100) continue;
    found.push({ at: m.index ?? 0, iso: `${year}-${String(month + 1).padStart(2, "0")}-01` });
  }
  if (!found.length) return null;
  const counts = new Map<string, number>();
  for (const f of found) counts.set(f.iso, (counts.get(f.iso) ?? 0) + 1);
  // A running header repeats; a cover states it once, up top. Anything else is
  // prose and is refused rather than guessed at.
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  // A running header repeats — three or more is not prose.
  if (best[1] >= 3) return best[0];
  // Otherwise it must look like a LABEL rather than a sentence: on the cover, on
  // its own short line, and not punctuated like running text. "Wij verhogen per
  // januari 2025 de tarieven." is a sentence about a change and says nothing about
  // when THIS document was issued, so it is refused.
  const titleLike = found.some((f) => {
    if (f.iso !== best[0] || f.at >= 2000) return false;
    const start = text.lastIndexOf("\n", f.at) + 1;
    const end = text.indexOf("\n", f.at);
    const line = text.slice(start, end === -1 ? undefined : end).trim();
    return line.length <= 80 && !/[.,;:]$/.test(line);
  });
  return titleLike ? best[0] : null;
}
