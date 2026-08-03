import type { Account, Tx } from "../model.js";
import { norm } from "../hash.js";
import { splitRows, parseDate, parseAmount, headerIndex, findIban, bankFromIban } from "./primitives.js";

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
    },
  },
  {
    bank: "Knab",
    test: (h) => h.includes("creditdebet") || (h.includes("rekeningnummer") && h.includes("transactiedatum")),
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
    test: (h) => (h.includes("completed date") || h.includes("datum voltooid")) && (h.includes("amount") || h.includes("bedrag")),
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
 * `m` object (557-569). --- */
const GENERIC_MAP: ColumnMap = {
  date: ["datum", "date", "boekdatum", "transactiedatum", "valutadatum", "completed date", "started date", "time", "datum boeking"],
  amount: ["bedrag", "amount", "bedrag (eur)", "transactiebedrag", "total", "value", "mutatie"],
  cp: ["naam", "naam / beschrijving", "naam tegenpartij", "tegenrekeninghouder", "description", "merchant", "payee", "omschrijving", "beschrijving", "counterparty"],
  desc: ["mededelingen", "omschrijving", "omschrijving-1", "description", "notes", "details", "extended details", "toelichting"],
  acc: ["rekening", "rekeningnummer", "iban/bban", "iban", "account", "tegenrekening", "product"],
  cur: ["munt", "currency", "valuta", "valutacode"],
  dc: ["af bij", "af/bij", "creditdebet", "debet/credit", "bij/af", "cdtdbtind", "type mutatie"],
  dcNeg: ["af", "d", "debet", "debit", "db"],
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
  const cands: Array<[string, number]> = [[";", 0], [",", 0], ["\t", 0], ["|", 0]];
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

function parseABN(rows: string[][]): { accounts: Record<string, Account>; txs: Array<Omit<Tx, "id">> } {
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
      key: acc, iban: findIban(acc) ?? "", name: acc, bank: "ABN AMRO", entity: "", currency: cur, balance: close,
    };
    accounts[acc].balance = close;
    // The running balance is "as of" this row's date; each row overwrites like
    // `balance` above, so the last (max-date) row wins.
    accounts[acc].balanceDate = date;
    let cp = "";
    const nm = info.match(/(?:SEPA\s+\w+\s+)?(?:Naam|NAAM)[:\s]+([^\n]+?)(?:\s{2,}|IBAN|Omschrijving|Kenmerk|Machtiging|$)/i);
    if (nm) cp = nm[1].trim().slice(0, 60);
    if (!cp) {
      const bea = info.match(/(?:BEA|GEA)[^,]*,[^,]*,\s*([^,]{3,40})/i);
      if (bea) cp = bea[1].trim();
    }
    if (!cp) cp = info.split(/\s{2,}/)[0].slice(0, 60);
    txs.push({ accountKey: acc, date, amount, currency: cur, counterparty: cp, description: info, category: "", manual: false });
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
  return hNorm.includes("boeksaldo") && (hNorm.includes("rekening naam") || hNorm.includes("rekeningnaam"));
}

function parseSavingsBalances(header: string[], rows: string[][]): { accounts: Account[]; txs: Array<Omit<Tx, "id">> } {
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
    const bank = /oranje/i.test(v.name) ? "ING" : bankFromIban(acc) ?? "";
    accounts.push({ key: acc, iban: findIban(acc) ?? "", name: v.name, bank, entity: "", currency: v.cur, balance: v.balance, balanceDate: v.date });
  }
  return { accounts, txs: [] };
}

export type ParsedBankCsv = { accounts: Account[]; txs: Array<Omit<Tx, "id">>; profile: string };

/**
 * Detects the bank from the CSV header signature (or, for ABN AMRO, from its
 * headerless TAB shape), maps columns, and parses every row into txs (+ any
 * accounts it can derive, e.g. by IBAN). `fallbackAccountKey` is used when a
 * row/profile has no per-row account column (e.g. Revolut/Amex/Trading 212).
 */
export function parseBankCsv(text: string, fallbackAccountKey: string): ParsedBankCsv {
  const delim = sniffDelim(text);
  const rows = splitRows(text, delim);
  if (!rows.length) return { accounts: [], txs: [], profile: "leeg" };

  if (delim === "\t" && looksLikeABN(rows)) {
    const { accounts, txs } = parseABN(rows);
    return { accounts: Object.values(accounts), txs, profile: "ABN AMRO" };
  }

  const accounts: Record<string, Account> = {};
  const txs: Array<Omit<Tx, "id">> = [];
  const header = rows[0].map((h) => String(h).replace(/^"|"$/g, "").trim());
  const hNorm = header.map(norm).join("|");

  // Balance-only savings snapshot (no transactions) — handled before profile
  // detection since it has no amount column the generic engine could use.
  if (looksLikeSavingsBalance(hNorm)) {
    const parsed = parseSavingsBalances(header, rows);
    return { accounts: parsed.accounts, txs: parsed.txs, profile: "Spaarrekeningen" };
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
    const date = parseDate(r[ci.date], prof?.dateFormat ?? "DMY");
    let amount = parseAmount(r[ci.amount]);
    if (date == null || amount == null) continue;
    if (ci.dc > -1) {
      const d = norm(r[ci.dc]);
      amount = Math.abs(amount) * (dcNeg.includes(d) || /^d/.test(d) ? -1 : 1);
    }
    if (ci.fee > -1) {
      const f = parseAmount(r[ci.fee]);
      if (f) amount -= Math.abs(f);
    }
    if (flip) amount = -amount;
    if (cashOnly) {
      const act = norm(r[ci.desc > -1 ? ci.desc : 0]);
      if (!/deposit|withdraw|dividend|interest|storting|opname/.test(act)) continue;
    }
    const accRaw = ci.acc > -1 ? String(r[ci.acc] ?? "").trim() : "";
    const acc = findIban(accRaw) || accRaw || fallbackAccountKey;
    const cur = (ci.cur > -1 ? String(r[ci.cur] ?? "").trim() : "") || "EUR";
    const bank = prof?.bank ?? bankFromIban(acc) ?? "";
    accounts[acc] = accounts[acc] || { key: acc, iban: findIban(acc) ?? "", name: acc, bank, entity: "", currency: cur, balance: null };
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
      counterparty: ci.cp > -1 ? String(r[ci.cp] ?? "").trim() : "",
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

  return { accounts: Object.values(accounts), txs, profile: prof ? prof.bank : "generic" };
}
