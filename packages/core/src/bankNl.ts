/* ONE comparison source instead of thirty bank tariff pages.
 *
 * Measured 2026-08-16: of the card tariff pages the travel ranking wants, only
 * three answer a plain fetch. Revolut and Trading 212 return 403 behind a
 * Cloudflare interstitial, ING drops the connection on both HTTP/2 and 1.1, and
 * Rabobank 403s. https://www.bank.nl/kennisbank/betalen-in-buitenland/ returns
 * 200 (~96 kB) with a browser User-Agent and carries the koersopslag per bank in
 * the RAW HTML — including banks that block us directly — and stamps its own
 * "laatst gecontroleerd" date next to every table.
 *
 * This module is the PURE half: HTML in, rows out. Fetching, caching and the
 * bundled snapshot live in apps/server/src/bankNl.ts, exactly the way rates.ts
 * splits the geld.nl scrape from its parsing.
 *
 * PRECISION, and it decides how these figures are used: a comparison table is
 * one step removed from the provider's own tariff page, so it must never
 * overwrite a fresher provider-specific figure, and never anything the owner set
 * himself. That ordering is enforced in apps/server/src/cardTerms.ts. */

/** The two card products LaVega ranks — the same split `productOf` generates
 *  ("ING betaalpas" / "ING creditcard"), because a debit card and a credit card
 *  at one bank are different products with different tariffs (ABN AMRO: 1,2% on
 *  the betaalpas, 2,0% on the creditcard). */
export type CardKind = "betaalpas" | "creditcard";

/** One tariff the comparison page states, for one bank AND one card kind. */
export type BankNlRow = {
  /** The bank as the PAGE names it ("ABN AMRO", "ASN Bank"). Mapping this onto
   *  the owner's own bank label happens in `comparisonTermsFor`. */
  bank: string;
  card: CardKind;
  /** The koersopslag in percent. Several components in one cell are summed
   *  (bunq Core: "1,5% van het transactiebedrag + 0,5% netwerkkosten" = 2,0%) —
   *  every percentage this page prints in a foreign-currency cell is a
   *  surcharge, and the raw cell text is kept in `note` so the sum is checkable. */
  fxFeePct: number;
  /** What the page actually said, its footnote, and when it was last checked.
   *  Fixed fees that are not a percentage (ABN AMRO's €0,15 per transaction)
   *  survive only here — never folded into `fxFeePct`, which is a percentage. */
  note: string;
  /** The page's own "Laatst gecontroleerd op" date for this table, ISO. */
  checkedAt: string | null;
};

export type BankNlTable = {
  /** The most recent per-table check date on the page, ISO, or null. */
  checkedAt: string | null;
  rows: BankNlRow[];
};

const NOTE_MAX = 900;

/* ---------- HTML → text ---------- */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  euro: "€",
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
}

/** Visible text of an HTML fragment: tags out, entities in, whitespace collapsed. */
function text(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function firstSection(html: string, tag: "thead" | "tbody"): string {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
}

function rowsOf(html: string): string[] {
  return html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
}

function cellsOf(tr: string): string[] {
  return (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(text);
}

/* ---------- the bits of Dutch this page speaks ---------- */

/** Which card a COLUMN header describes. "Met creditcard of platinumcard" (ING)
 *  is a credit card, so creditcard is tested first. Returns null for the empty
 *  corner cell and for anything we don't recognise — a column we can't attribute
 *  to a product is dropped, never guessed onto one. */
function cardOfHeader(header: string): CardKind | null {
  const s = header.toLowerCase();
  if (/creditcard|platinumcard|credit card/.test(s)) return "creditcard";
  if (/betaalpas|debitcard|betaalkaart|bankpas/.test(s)) return "betaalpas";
  return null;
}

function isForeignCurrency(label: string): boolean {
  return /vreemde valuta|buitenlandse valuta|andere valuta/i.test(label);
}

/** Every percentage in a cell, summed. Null when the cell states no percentage —
 *  which leaves the tariff UNKNOWN rather than free. "Gratis" in a
 *  foreign-currency cell would be a claim, and a claim needs a figure. */
function feePct(cell: string): number | null {
  const found = [...cell.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) =>
    Number(m[1].replace(",", ".")),
  );
  if (found.length === 0 || found.some((n) => !Number.isFinite(n))) return null;
  return Math.round(found.reduce((a, b) => a + b, 0) * 1000) / 1000;
}

function dutchPct(n: number): string {
  return String(n).replace(".", ",");
}

/** "Laatst gecontroleerd op 15-1-2026" → "2026-01-15". */
function checkedDate(caption: string): string | null {
  const m = caption.match(/laatst gecontroleerd(?:\s+op)?\s+(\d{1,2})-(\d{1,2})-(\d{4})/i);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function clip(s: string): string {
  return s.length <= NOTE_MAX ? s : s.slice(0, NOTE_MAX - 1).trimEnd() + "…";
}

function sourceNote(body: string, checkedAt: string | null): string {
  const stamp = checkedAt
    ? `Bron: bank.nl-vergelijking, laatst gecontroleerd ${checkedAt}.`
    : "Bron: bank.nl-vergelijking.";
  return clip(body ? `${body} ${stamp}` : stamp);
}

/* ---------- the parser ---------- */

const FIGURE_RE = /<figure[^>]*class="[^"]*wp-block-table[^"]*"[^>]*>([\s\S]*?)<\/figure>/gi;
const HEADING_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;

/** Turn the raw page into rows. Pure: HTML in, rows out, no clock and no I/O.
 *
 *  The page is a WordPress article: an `<h2>` naming the bank, then a
 *  `<figure class="wp-block-table">` holding that bank's tariffs and a
 *  `<figcaption>` with the check date. Each figure is attributed to the nearest
 *  heading ABOVE it, which is why the site navigation — where "American Express"
 *  and "SNS Bank" appear as menu links, with no tariff attached — cannot become
 *  a row: there is no table under them.
 *
 *  Two table shapes exist and both are handled:
 *  · cards in COLUMNS (six banks) — "Met betaalpas" / "Met creditcard" headers,
 *    one row per situation; we take the "Betalen in vreemde valuta" row.
 *  · plans in ROWS (bunq) — "Betalen in vreemde valuta" is a COLUMN and each row
 *    is a subscription (Core / Pro / Elite). See `fromPlanRows` for why that
 *    collapses to one conservative row instead of three products. */
export function parseBankNlPage(html: string): BankNlTable {
  const headings = [...html.matchAll(HEADING_RE)].map((m) => ({
    at: m.index ?? 0,
    name: text(m[1]),
  }));
  const rows: BankNlRow[] = [];

  for (const fig of html.matchAll(FIGURE_RE)) {
    const at = fig.index ?? 0;
    const bank = [...headings].reverse().find((h) => h.at < at)?.name ?? "";
    if (!bank) continue;
    const block = fig[1];
    const caption = text(block.match(/<figcaption[\s\S]*?<\/figcaption>/i)?.[0] ?? "");
    const checkedAt = checkedDate(caption);
    // The caption's italic tail is the footnote the asterisked cells refer to.
    const footnote = text(
      block.match(/<figcaption[\s\S]*?<em[^>]*>([\s\S]*?)<\/em>/i)?.[1] ?? "",
    ).replace(/^\*+\s*/, "");

    const header = cellsOf(rowsOf(firstSection(block, "thead"))[0] ?? "");
    const body = rowsOf(firstSection(block, "tbody"));
    if (header.length === 0 || body.length === 0) continue;

    const found = header.some((h) => cardOfHeader(h) !== null)
      ? fromCardColumns(bank, header, body, footnote, checkedAt)
      : fromPlanRows(bank, header, body, footnote, checkedAt);
    rows.push(...found);
  }

  const dates = rows.map((r) => r.checkedAt).filter((d): d is string => d !== null);
  return { checkedAt: dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null, rows };
}

/** Cards in columns: one row per card kind the table actually names. A table
 *  with only a "Met betaalpas" column (Triodos) yields only a betaalpas row —
 *  where the page draws no debit/credit distinction we do not invent one. */
function fromCardColumns(
  bank: string,
  header: string[],
  body: string[],
  footnote: string,
  checkedAt: string | null,
): BankNlRow[] {
  const fx = body.map(cellsOf).find((cells) => isForeignCurrency(cells[0] ?? ""));
  if (!fx) return [];
  const out: BankNlRow[] = [];
  for (let i = 1; i < header.length; i++) {
    const card = cardOfHeader(header[i]);
    const cell = fx[i];
    if (!card || !cell) continue;
    const fxFeePct = feePct(cell);
    if (fxFeePct === null) continue; // no figure stated -> stays unknown
    const body_ =
      cell.includes("*") && footnote ? `${cell.replace(/\*/g, "").trim()} ${footnote}` : cell;
    out.push({ bank, card, fxFeePct, note: sourceNote(body_, checkedAt), checkedAt });
  }
  return out;
}

/** Plans in rows (bunq): the table's rows are SUBSCRIPTIONS, not products — Core
 *  pays 1,5% + 0,5% netwerkkosten, Pro and Elite only the 0,5%. The page never
 *  says which plan you are on, and LaVega's product name is bank + card kind, so
 *  there is no honest way to emit three products here.
 *
 *  So one row is emitted, at the DEAREST plan, with every plan named in the note.
 *  Erring cheap is the failure that matters: it would crown the wrong card and
 *  send someone abroad with it, which is the exact mistake the travel ranking
 *  exists to prevent. Erring dear only loses a comparison the owner can correct —
 *  and his correction outranks this figure permanently. */
function fromPlanRows(
  bank: string,
  header: string[],
  body: string[],
  footnote: string,
  checkedAt: string | null,
): BankNlRow[] {
  const col = header.findIndex((h) => isForeignCurrency(h));
  if (col < 1) return [];
  const plans: { label: string; cell: string; pct: number }[] = [];
  for (const tr of body) {
    const cells = cellsOf(tr);
    const cell = cells[col];
    const pct = cell ? feePct(cell) : null;
    if (!cell || pct === null) continue;
    plans.push({ label: cells[0] ?? "", cell, pct });
  }
  if (plans.length === 0) return [];
  const worst = plans.reduce((a, b) => (b.pct > a.pct ? b : a));
  const listed = plans.map((p) => `${p.label}: ${p.cell}`).join("; ");
  const note =
    plans.length === 1
      ? worst.cell
      : `Per abonnement — ${listed}. Hier is het duurste aangehouden (${dutchPct(worst.pct)}%); corrigeer dit als je een ander abonnement hebt.`;
  return [
    {
      bank,
      card: "betaalpas",
      fxFeePct: worst.pct,
      note: sourceNote(footnote ? `${note} ${footnote}` : note, checkedAt),
      checkedAt,
    },
  ];
}

/* ---------- name mapping: a table row -> a LaVega product ---------- */

/** Split a LaVega product name back into its two halves. `productOf` always
 *  builds "<bank> betaalpas" or "<bank> creditcard", so anything else is not a
 *  product we can attribute a bank tariff to. */
export function splitProductName(product: string): { bank: string; card: CardKind } | null {
  const s = String(product ?? "").trim();
  for (const card of ["betaalpas", "creditcard"] as const) {
    if (s.toLowerCase().endsWith(` ${card}`)) {
      const bank = s.slice(0, s.length - card.length - 1).trim();
      return bank ? { bank, card } : null;
    }
  }
  return null;
}

function normBank(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Does the owner's bank label mean the same bank the page names?
 *
 *  Matching is normalised and prefix-tolerant rather than a fixed alias table,
 *  because `account.bank` is FREE TEXT the owner can edit in Rekeningen: the same
 *  bank arrives as "ASN Bank" from one source and "ASN" from another, "Triodos
 *  Bank" or "Triodos", "ABN AMRO" or "ABN". A three-character floor keeps a stub
 *  from matching everything; on the seven banks this page lists no two names are
 *  a prefix of each other, so a prefix match cannot cross banks. */
export function bankNameMatches(pageBank: string, ownBank: string): boolean {
  const a = normBank(pageBank);
  const b = normBank(ownBank);
  if (a.length < 3 || b.length < 3) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** The comparison figure for ONE LaVega product name, or null when this page
 *  says nothing about it. The returned `provider` is the name as ASKED, so the
 *  figure keys onto exactly the product the caller ranks. */
export function comparisonTermsFor(
  rows: readonly BankNlRow[],
  product: string,
): { provider: string; fxFeePct: number; note: string; checkedAt?: string } | null {
  const want = splitProductName(product);
  if (!want) return null;
  const row = rows.find((r) => r.card === want.card && bankNameMatches(r.bank, want.bank));
  if (!row) return null;
  // The page stamps when it was last checked. Carry that as a FIELD, not only
  // buried in the note text: how old a fee is decides whether it may still
  // overwrite a fresher one, and a date nobody can read is a date nobody can use.
  return {
    provider: String(product).trim(),
    fxFeePct: row.fxFeePct,
    note: row.note,
    checkedAt: row.checkedAt ?? undefined,
  };
}
