import type { Account, Tx } from "../model.js";
import { norm } from "../hash.js";
import {
  splitRows,
  parseDate,
  parseAmount,
  headerIndex,
  findIban,
  bankFromIban,
} from "./primitives.js";

/* Ported from Kasoverzicht.html's PARSERS block: the `profiles` table (486-500),
 * `headerIndex`/`pick` column mapping (502-516), `parseABN` (523-547) and
 * `parseGenericCSV` (549-615). This is the profile-driven bank CSV engine:
 * detect the bank by header signature, map its columns, parse rows into
 * Omit<Tx,"id">[] + Account[]. Pure string parsing — no I/O.
 *
 * ING is folded in as one profile (map.acc:'rekening' derives the per-row
 * account key from the CSV's own "Rekening" column) so this single engine
 * replaces the bank-specific parsing path; ./csv.ts's parseIngCsv is now a
 * thin wrapper over parseBankCsv (see there for why it still forces every
 * tx's accountKey to the caller-supplied value). */

type ColumnMap = {
  date: string[];
  amount: string[];
  cp?: string[];
  desc?: string[];
  acc?: string[];
  cur?: string[];
  dc?: string[];
  dcNeg?: string[];
  fee?: string[];
  bal?: string[]; // running-balance column (e.g. Revolut "Saldo"): the latest row sets the account balance
};

type Profile = {
  bank: string;
  test: (headerNorm: string) => boolean;
  map: ColumnMap;
  flip?: boolean;
  cashOnly?: boolean;
  /** Turns the raw account cell into the account key ("" = unusable, fall back). */
  accKey?: (raw: string) => string;
  dateFormat?: "DMY" | "MDY";
};

/* --- CSV profiles per bank, keyed off a header signature. Order matters:
 * Array.prototype.find returns the first match, and some signatures are
 * loose enough to also fit an earlier profile's header (e.g. Rabobank's
 * "bedrag" substring), so ING must stay first. ---
 *
 * Note: the reference's ING map has `cp:'naam / beschrijving'`; the real ING
 * CSV export column (and this repo's existing tested parseIngCsv/fixtures)
 * is "Naam / Omschrijving", so that's what's used here — using the
 * reference's literal string would silently fail to map the counterparty
 * column (pick()'s fuzzy fallback only matches substrings, and neither name
 * is a substring of the other). */
const PROFILES: Profile[] = [
  {
    /* ING'S ENGLISH EXPORT, and it is the one that mattered most: it is his main
     * history file and no profile covered it, so every row fell through to the
     * generic profile, which has no `dc` column and no `acc` column — the sign came
     * out wrong and the per-row account was lost. A large share of the "onbekend"
     * category traced back to here rather than to the categoriser.
     *
     * ING localises the HEADERS but not the file: "Af Bij" becomes "Debit/credit"
     * and its values become Debit/Credit, "Naam / Omschrijving" becomes
     * "Name / Description", "Mededelingen" becomes "Notifications". Kept as a
     * separate profile rather than widening the Dutch one's `test`, because a
     * single test matching either language would also match a file that mixes
     * them — which is exactly what a hand-edited export looks like. */
    bank: "ING",
    test: (h) => h.includes("debit/credit") && (h.includes("amount (eur)") || h.includes("amount")),
    map: {
      date: ["date"],
      cp: ["name / description", "name/description"],
      desc: ["notifications", "notification"],
      amount: ["amount (eur)", "amount"],
      acc: ["account"],
      dc: ["debit/credit"],
      // "Debit" also satisfies the /^d/ fallback below, but naming it is what
      // makes this profile readable next to its Dutch twin.
      dcNeg: ["debit"],
      // Dezelfde kolom als "Saldo na mutatie" in de Nederlandse export.
      bal: ["balance after mutation", "balance"],
    },
  },
  {
    bank: "ING",
    test: (h) => h.includes("af bij") && h.includes("bedrag (eur)"),
    map: {
      date: ["datum"],
      cp: ["naam / omschrijving"],
      desc: ["mededelingen"],
      amount: ["bedrag (eur)"],
      acc: ["rekening"],
      dc: ["af bij"],
      dcNeg: ["af"],
      /* ING SCHRIJFT HET SALDO IN ELKE REGEL en dit profiel las het niet.
       * Gemeld op 24 augustus: "Positie onbekend (alleen CSV-rekeningen zonder
       * saldo)". Dat was waar en onnodig — de kolom "Saldo na mutatie" staat
       * gewoon in de export. Zonder deze regel heeft een geïmporteerde
       * ING-rekening geen saldo, en dan kan de positiegrafiek geen lijn tekenen
       * en valt de hele rekening buiten elk totaal.
       *
       * De kale "saldo" staat er als tweede omdat `pick` ook op bevatten matcht:
       * een export die de kolom anders noemt maar wel "saldo" bevat komt er zo
       * alsnog door, zonder dat we per bank een nieuwe naam moeten raden. */
      bal: ["saldo na mutatie", "saldo"],
    },
  },
  {
    bank: "Rabobank",
    test: (h) => h.includes("iban/bban") && h.includes("bedrag"),
    map: {
      date: ["datum"],
      cp: ["naam tegenpartij"],
      desc: ["omschrijving-1"],
      amount: ["bedrag"],
      acc: ["iban/bban"],
      cur: ["munt"],
      // Rabobank noemt hem "Saldo na trn". De kale "saldo" staat er als vangnet
      // achter, want `pick` matcht ook op bevatten.
      bal: ["saldo na trn", "saldo"],
    },
  },
  {
    bank: "Knab",
    test: (h) =>
      h.includes("creditdebet") || (h.includes("rekeningnummer") && h.includes("transactiedatum")),
    map: {
      date: ["transactiedatum"],
      cp: ["tegenrekeninghouder"],
      desc: ["omschrijving"],
      amount: ["bedrag"],
      acc: ["rekeningnummer"],
      dc: ["creditdebet"],
      dcNeg: ["d", "debet"],
    },
  },
  {
    // Dual-language: Revolut exports headers in the account's locale. The Dutch
    // export is "Type,Product,Startdatum,Datum voltooid,Beschrijving,Bedrag,
    // Kosten,Valuta,Status,Saldo"; the English one uses Completed Date/Amount/
    // Currency/Fee/Balance. "product" (Betaalrekening/Spaarrekening/Current/
    // Savings) is the per-row account; "saldo"/"balance" is the running balance.
    bank: "Revolut",
    test: (h) =>
      (h.includes("completed date") || h.includes("datum voltooid")) &&
      (h.includes("amount") || h.includes("bedrag")),
    map: {
      date: ["completed date", "datum voltooid"],
      cp: ["description", "beschrijving"],
      desc: ["type"], // "Type"/"type" is identical after norm in both locales
      amount: ["amount", "bedrag"],
      cur: ["currency", "valuta"],
      fee: ["fee", "kosten"],
      acc: ["product"],
      bal: ["balance", "saldo"],
    },
  },
  {
    bank: "American Express",
    test: (h) =>
      (h.includes("date") || h.includes("datum")) &&
      (h.includes("amount") || h.includes("bedrag")) &&
      (h.includes("card member") ||
        h.includes("appears on your statement as") ||
        h.includes("extended details") ||
        h.includes("vermeld op") || // NL: "Vermeld op uw rekeningoverzicht als"
        h.includes("aanvullende informatie")), // NL: "Extended Details"
    map: {
      date: ["date", "datum"],
      cp: ["description", "omschrijving"],
      desc: ["appears on your statement as", "vermeld op uw rekeningoverzicht als"],
      amount: ["amount", "bedrag"],
      // "Account #" (en) / "Rekeningnummer", "Kaartnummer" (nl): masked, e.g. "-12345".
      acc: ["account #", "rekeningnummer", "kaartnummer", "card number"],
    },
    accKey: (raw) => {
      const d = raw.replace(/\D/g, "");
      return d.length >= 4 ? "AMEX-" + d.slice(-5) : "";
    },
    flip: true,
    dateFormat: "MDY", // Amex dates are US MM/DD/YYYY in both English and Dutch exports
  },
  {
    bank: "Trading 212",
    test: (h) => h.includes("action") && h.includes("total"),
    map: {
      date: ["time"],
      cp: ["name"],
      desc: ["action"],
      amount: ["total"],
      cur: ["currency (total)"],
    },
    cashOnly: true,
  },
];

/* --- fallback column-name guesses when no profile's header signature matches
 * (best-effort "generic" CSV support), ported from parseGenericCSV's inline
 * `m` object (557-569).
 *
 * GERMAN HEADERS ARE IN HERE, and they are the difference between an import
 * and an empty screen. No German bank has its own profile, so a Sparkasse,
 * DKB, Commerzbank or Deutsche Bank export lands on this map — and with only
 * Dutch and English guesses it found neither a date nor an amount column, so
 * every row was skipped and the file reported "geen transacties gevonden".
 * N26 survived only because it exports English headers.
 *
 * Dates already worked: parseDate accepts [-/.] so 31.08.2026 parses, and DMY
 * is the default, which is right for Germany. It was the column NAMES that
 * were missing, not the formats.
 *
 * "Umsatz" is deliberately absent from `amount`: it means turnover generally
 * and some exports use it as a row label rather than the signed figure. Better
 * to miss a column than to read the wrong one as money. --- */
const GENERIC_MAP: ColumnMap = {
  date: [
    "datum",
    "date",
    "boekdatum",
    "transactiedatum",
    "valutadatum",
    "completed date",
    "started date",
    "time",
    "datum boeking",
    // German: Sparkasse/DKB post "Buchungstag", value date is "Wertstellung".
    "buchungstag",
    "wertstellung",
    "wertstellungsdatum",
    "valutadatum (wertstellung)",
    "buchungsdatum",
  ],
  amount: [
    "bedrag",
    "amount",
    "bedrag (eur)",
    "transactiebedrag",
    "total",
    "value",
    "mutatie",
    // German: signed in most exports, so `dc` below is a fallback not a need.
    "betrag",
    "betrag (eur)",
    "betrag in eur",
  ],
  cp: [
    "naam",
    "naam / beschrijving",
    "naam tegenpartij",
    "tegenrekeninghouder",
    "description",
    "merchant",
    "payee",
    "omschrijving",
    "beschrijving",
    "counterparty",
    // German: Sparkasse names the other party "Beguenstigter/Zahlungspflichtiger".
    "beguenstigter/zahlungspflichtiger",
    "begünstigter/zahlungspflichtiger",
    "auftraggeber/empfaenger",
    "auftraggeber/empfänger",
    "empfaenger",
    "empfänger",
    "auftraggeber",
    "zahlungsempfaenger",
    "zahlungsempfänger",
    "name zahlungsbeteiligter",
  ],
  desc: [
    "mededelingen",
    "omschrijving",
    "omschrijving-1",
    "description",
    "notes",
    "details",
    "extended details",
    "toelichting",
    // German: the free-text reference line every SEPA transfer carries.
    "verwendungszweck",
    "buchungstext",
    "vwz",
  ],
  acc: [
    "rekening",
    "rekeningnummer",
    "iban/bban",
    "iban",
    "account",
    "tegenrekening",
    "product",
    "kontonummer",
    "auftragskonto",
    "iban auftragskonto",
  ],
  cur: ["munt", "currency", "valuta", "valutacode", "waehrung", "währung"],
  dc: [
    "af bij",
    "af/bij",
    "creditdebet",
    "debet/credit",
    "bij/af",
    "cdtdbtind",
    "type mutatie",
    "soll/haben",
    "soll/haben-kennzeichen",
  ],
  // "s" for Soll is NOT listed: it would also match a stray single letter in a
  // Dutch column. "soll" spelled out is unambiguous, and German exports that
  // use the short form sign the Betrag anyway.
  dcNeg: ["af", "d", "debet", "debit", "db", "soll"],
};

function pick(idx: Record<string, number>, names: string[]): number {
  for (const n of names) {
    const k = norm(n);
    if (k in idx) return idx[k];
  }
  // fuzzy: header key contains the candidate name
  for (const n of names) {
    const k = norm(n);
    for (const key in idx) {
      if (key.includes(k)) return idx[key];
    }
  }
  return -1;
}

/* --- pick a delimiter by counting occurrences in the first few lines; ties
 * favour ';' > ',' > '\t' > '|' (candidate order), default ',' if none found. --- */
function sniffDelim(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const cands: Array<[string, number]> = [
    [";", 0],
    [",", 0],
    ["\t", 0],
    ["|", 0],
  ];
  for (const c of cands) c[1] = head.split(c[0]).length - 1;
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][1] > 0 ? cands[0][0] : ",";
}

/* --- ABN AMRO: TAB-delimited, no header, 8 columns. --- */
function looksLikeABN(rows: string[][]): boolean {
  if (!rows.length) return false;
  const r = rows[0];
  return (
    r.length >= 7 &&
    /^\d{9,10}$|^[A-Z]{2}\d{2}/.test(String(r[0]).trim().replace(/\s/g, "")) &&
    /^\d{8}$/.test(String(r[2]).trim())
  );
}

function parseABN(rows: string[][]): {
  accounts: Record<string, Account>;
  txs: Array<Omit<Tx, "id">>;
} {
  const accounts: Record<string, Account> = {};
  const txs: Array<Omit<Tx, "id">> = [];
  for (const r of rows) {
    const accRaw = String(r[0]).trim();
    const acc = findIban(accRaw) || accRaw;
    const cur = String(r[1] || "EUR").trim();
    const date = parseDate(r[2]);
    const close = parseAmount(r[5]);
    const amount = parseAmount(r[6]);
    const info = (r.slice(7).join(" ") || "").replace(/\s+/g, " ").trim();
    if (date == null || amount == null) continue;
    accounts[acc] = accounts[acc] || {
      key: acc,
      iban: findIban(acc) ?? "",
      name: acc,
      bank: "ABN AMRO",
      entity: "",
      currency: cur,
      balance: close,
    };
    accounts[acc].balance = close;
    // The running balance is "as of" this row's date; each row overwrites like
    // `balance` above, so the last (max-date) row wins.
    accounts[acc].balanceDate = date;
    let cp = "";
    // The two patterns below scan from every start position, so they only run on
    // a field of normal length. A bank description is a few hundred characters;
    // a longer one falls through to the plain first-segment rule.
    if (info.length <= MAX_INFO_FOR_PATTERNS) {
      const nm = info.match(
        /(?:SEPA\s+\w+\s+)?(?:Naam|NAAM)[:\s]+(\S[^\n]*?)(?:\s{2,}|IBAN|Omschrijving|Kenmerk|Machtiging|$)/i,
      );
      if (nm) cp = nm[1].trim().slice(0, 60);
      if (!cp) {
        const bea = info.match(/(?:BEA|GEA)[^,]*,[^,]*,\s*([^,]{3,40})/i);
        if (bea) cp = bea[1].trim();
      }
    }
    if (!cp) cp = info.split(/\s{2,}/)[0].slice(0, 60);
    txs.push({
      accountKey: acc,
      date,
      amount,
      currency: cur,
      counterparty: cp,
      description: info,
      category: "",
      manual: false,
    });
  }
  return { accounts, txs };
}

/* --- balance-only savings export (ING "Alle spaarrekeningen"):
 * "Datum";"Rekening";"Rekening naam";"Valuta";"Boeksaldo" — per-date balance
 * snapshots with NO transactions and no amount column. The generic engine finds
 * no amount and skips every row ("adds nothing"), so this shape gets its own
 * path: one account per Rekening, its balance set from the latest-date row's
 * Boeksaldo. Detected by the distinctive "rekening naam" + "boeksaldo" pair. --- */
function looksLikeSavingsBalance(hNorm: string): boolean {
  return (
    hNorm.includes("boeksaldo") &&
    (hNorm.includes("rekening naam") || hNorm.includes("rekeningnaam"))
  );
}

function parseSavingsBalances(
  header: string[],
  rows: string[][],
): { accounts: Account[]; txs: Array<Omit<Tx, "id">> } {
  const idx = headerIndex(header);
  const ci = {
    date: pick(idx, ["datum", "boekdatum", "date"]),
    acc: pick(idx, ["rekening", "rekeningnummer", "iban"]),
    name: pick(idx, ["rekening naam", "rekeningnaam", "naam"]),
    cur: pick(idx, ["valuta", "munt", "currency"]),
    bal: pick(idx, ["boeksaldo", "saldo", "balance"]),
  };
  // Latest-date balance per account (last row wins on a date tie — exports run
  // newest-first or oldest-first; `>=` in file order takes whichever is last).
  const latest = new Map<string, { date: string; balance: number; name: string; cur: string }>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;
    const date = parseDate(r[ci.date]);
    const bal = ci.bal > -1 ? parseAmount(r[ci.bal]) : null;
    const accRaw = ci.acc > -1 ? String(r[ci.acc] ?? "").trim() : "";
    if (date == null || bal == null || !accRaw) continue;
    const acc = findIban(accRaw) || accRaw;
    const prev = latest.get(acc);
    if (!prev || date >= prev.date) {
      latest.set(acc, {
        date,
        balance: bal,
        name: (ci.name > -1 ? String(r[ci.name] ?? "").trim() : "") || acc,
        cur: (ci.cur > -1 ? String(r[ci.cur] ?? "").trim() : "") || "EUR",
      });
    }
  }
  const accounts: Account[] = [];
  for (const [acc, v] of latest) {
    // ING's "Oranje Spaarrekening" carries no IBAN (old-style account number),
    // so derive the bank from the product name; fall back to the IBAN prefix.
    const bank = /oranje/i.test(v.name) ? "ING" : (bankFromIban(acc) ?? "");
    accounts.push({
      key: acc,
      iban: findIban(acc) ?? "",
      name: v.name,
      bank,
      entity: "",
      currency: v.cur,
      balance: v.balance,
      balanceDate: v.date,
    });
  }
  return { accounts, txs: [] };
}

/* --- Trading 212 export actions. UNVERIFIED AGAINST A REAL EXPORT: the card
 * action names come from third-party descriptions, not from a file the owner
 * supplied. Adjust this block when he supplies one. Matching is on the
 * lower-cased, trimmed Action text. --- */
const T212_CASH = /deposit|withdraw|dividend|interest|storting|opname/;
/** Card spending: always money OUT, whatever sign the file carries. */
const T212_CARD_OUT = /^card debit/;
/** Money back on the card: always money IN. */
const T212_CARD_IN = /^(card credit|card refund|spending cashback)/;
/** Trades and conversions: not account cash flow, ignored as before. */
const T212_IGNORED = /\b(buy|sell)\b|stock split|currency conversion/;
/** The ONE Trading 212 account: the card spends the cash balance, so card and
 *  cash rows share it. Stable across re-imports (never the file name, never the
 *  picked card). The value is the key the card rows already had, so rows stored
 *  before keep their ids and a re-import adds nothing. */
export const T212_ACCOUNT_KEY = "TRADING212-CARD";
/** What the account is called (also its bank). */
export const T212_ACCOUNT_NAME = "Trading 212";

/** Rows a profile saw but could not place, by Action text. */
export type UnrecognisedAction = { action: string; count: number };

export type ParseOptions = {
  /** Account key to use when the file itself names none (the card the person
   *  picked). Beats the filename, loses to an account column. */
  accountHint?: string;
};

export type ParsedBankCsv = {
  accounts: Account[];
  txs: Array<Omit<Tx, "id">>;
  profile: string;
  /** Trading 212 rows with an Action no rule knows; counted, never dropped silently. */
  unrecognised: UnrecognisedAction[];
  /** Rows with a date but an amount cell that could not be read; counted, not imported. */
  unreadable: number;
};

/** Excel day serial (1900 system) to ISO date; null when not a plausible serial. */
function excelSerialDate(v: string): string | null {
  if (!/^\d{5}(\.\d+)?$/.test(v.trim())) return null;
  const n = Math.floor(Number(v));
  if (n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Detects the bank from the CSV header signature (or, for ABN AMRO, from its
 * headerless TAB shape), maps columns, and parses every row into txs (+ any
 * accounts it can derive, e.g. by IBAN). `fallbackAccountKey` is used when a
 * row/profile has no per-row account column (e.g. Revolut/Amex/Trading 212).
 */
export function parseBankCsv(
  text: string,
  fallbackAccountKey: string,
  opts: ParseOptions = {},
): ParsedBankCsv {
  const delim = sniffDelim(text);
  const rows = splitRows(text, delim);
  if (!rows.length)
    return { accounts: [], txs: [], profile: "leeg", unrecognised: [], unreadable: 0 };

  if (delim === "\t" && looksLikeABN(rows)) {
    const { accounts, txs } = parseABN(rows);
    return {
      accounts: Object.values(accounts),
      txs,
      profile: "ABN AMRO",
      unrecognised: [],
      unreadable: 0,
    };
  }
  return parseBankRows(rows, fallbackAccountKey, opts);
}

/** The same engine over rows already split into cells (a CSV, or a spreadsheet
 *  read by the web layer). Excel date serials are accepted in the date column. */
/** Longest description the counterparty patterns are run on. */
const MAX_INFO_FOR_PATTERNS = 2000;

export function parseBankRows(
  rows: string[][],
  fallbackAccountKey: string,
  opts: ParseOptions = {},
): ParsedBankCsv {
  if (!rows.length)
    return { accounts: [], txs: [], profile: "leeg", unrecognised: [], unreadable: 0 };

  const accounts: Record<string, Account> = {};
  const txs: Array<Omit<Tx, "id">> = [];
  const header = rows[0].map((h) => String(h).replace(/^"|"$/g, "").trim());
  const hNorm = header.map(norm).join("|");

  // Balance-only savings snapshot (no transactions) — handled before profile
  // detection since it has no amount column the generic engine could use.
  if (looksLikeSavingsBalance(hNorm)) {
    const parsed = parseSavingsBalances(header, rows);
    return {
      accounts: parsed.accounts,
      txs: parsed.txs,
      profile: "Spaarrekeningen",
      unrecognised: [],
      unreadable: 0,
    };
  }

  const prof = PROFILES.find((p) => p.test(hNorm));
  const idx = headerIndex(header);
  const m: ColumnMap = prof ? prof.map : GENERIC_MAP;

  const ci = {
    date: pick(idx, m.date ?? []),
    amount: pick(idx, m.amount ?? []),
    cp: pick(idx, m.cp ?? []),
    desc: pick(idx, m.desc ?? []),
    acc: pick(idx, m.acc ?? []),
    cur: pick(idx, m.cur ?? []),
    dc: pick(idx, m.dc ?? []),
    fee: pick(idx, m.fee ?? []),
    bal: pick(idx, m.bal ?? []),
  };
  // Trading 212 card columns, only looked up when the file has them.
  const t212 = prof?.cashOnly
    ? { merchant: pick(idx, ["merchant name"]), notes: pick(idx, ["notes"]) }
    : { merchant: -1, notes: -1 };
  const unknown = new Map<string, number>();
  let unreadable = 0;
  const fallbackKey = prof?.cashOnly ? T212_ACCOUNT_KEY : opts.accountHint || fallbackAccountKey;

  // Running-balance capture (Revolut "Saldo"): remember the latest row's balance
  // per account so we can set account.balance to the current position. Rows are
  // scanned in file order; `>=` keeps the last row on a date tie (exports are
  // chronological, so the final same-date row is the most recent).
  const latestBal = new Map<string, { date: string; balance: number }>();

  const dcNeg = (m.dcNeg ?? ["af", "d", "debet", "debit"]).map(norm);
  const flip = prof?.flip ?? false;
  const cashOnly = prof?.cashOnly ?? false;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;
    const date =
      excelSerialDate(String(r[ci.date] ?? "")) ?? parseDate(r[ci.date], prof?.dateFormat ?? "DMY");
    let amount = parseAmount(r[ci.amount]);
    if (date != null && amount == null && String(r[ci.amount] ?? "").trim() !== "") unreadable += 1;
    if (date == null || amount == null) continue;
    if (ci.dc > -1) {
      const d = norm(r[ci.dc]);
      amount = Math.abs(amount) * (dcNeg.includes(d) || d.startsWith("d") ? -1 : 1);
    }
    if (ci.fee > -1) {
      const f = parseAmount(r[ci.fee]);
      if (f) amount -= Math.abs(f);
    }
    if (flip) amount = -amount;
    let cardRow: "out" | "in" | null = null;
    if (cashOnly) {
      const act = norm(r[ci.desc > -1 ? ci.desc : 0]);
      if (T212_CARD_OUT.test(act)) cardRow = "out";
      else if (T212_CARD_IN.test(act)) cardRow = "in";
      else if (T212_CASH.test(act)) cardRow = null;
      else if (T212_IGNORED.test(act)) continue;
      else {
        const label = String(r[ci.desc > -1 ? ci.desc : 0] ?? "").trim() || "(leeg)";
        unknown.set(label, (unknown.get(label) ?? 0) + 1);
        continue;
      }
      // Card rows: money out whatever the sign in the file; money back is in.
      if (cardRow === "out") amount = -Math.abs(amount);
      else if (cardRow === "in") amount = Math.abs(amount);
    }
    const accRaw = ci.acc > -1 ? String(r[ci.acc] ?? "").trim() : "";
    const fromCol = prof?.accKey ? prof.accKey(accRaw) : findIban(accRaw) || accRaw;
    // Trading 212: every kept row (card or cash) goes to the one account.
    const acc = cashOnly ? T212_ACCOUNT_KEY : fromCol || fallbackKey;
    const cur = (ci.cur > -1 ? String(r[ci.cur] ?? "").trim() : "") || "EUR";
    const bank = prof?.bank ?? bankFromIban(acc) ?? "";
    accounts[acc] = accounts[acc] || {
      key: acc,
      iban: findIban(acc) ?? "",
      name: cashOnly ? T212_ACCOUNT_NAME : acc,
      bank,
      entity: "",
      currency: cur,
      balance: null,
    };
    if (ci.bal > -1) {
      const b = parseAmount(r[ci.bal]);
      if (b != null) {
        const prevB = latestBal.get(acc);
        if (!prevB || date >= prevB.date) latestBal.set(acc, { date, balance: b });
      }
    }
    txs.push({
      accountKey: acc,
      date,
      amount,
      currency: cur,
      counterparty:
        cardRow !== null
          ? (t212.merchant > -1 ? String(r[t212.merchant] ?? "").trim() : "") ||
            (t212.notes > -1 ? String(r[t212.notes] ?? "").trim() : "") ||
            String(r[ci.desc] ?? "").trim()
          : ci.cp > -1
            ? String(r[ci.cp] ?? "").trim()
            : "",
      description: ci.desc > -1 ? String(r[ci.desc] ?? "").trim() : "",
      category: "",
      manual: false,
    });
  }

  // Apply captured running balances (anchored to the latest row's date) so the
  // account shows its current position without the user typing a saldo.
  for (const [acc, lb] of latestBal) {
    if (accounts[acc]) {
      accounts[acc].balance = lb.balance;
      accounts[acc].balanceDate = lb.date;
    }
  }

  return {
    accounts: Object.values(accounts),
    txs,
    profile: prof ? prof.bank : "generic",
    unrecognised: [...unknown].map(([action, count]) => ({ action, count })),
    unreadable,
  };
}
