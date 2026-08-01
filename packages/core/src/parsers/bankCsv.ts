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
};

type Profile = {
  bank: string;
  test: (headerNorm: string) => boolean;
  map: ColumnMap;
  flip?: boolean;
  cashOnly?: boolean;
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
    bank: "Revolut",
    test: (h) => h.includes("completed date") && h.includes("amount"),
    map: {
      date: ["completed date"],
      cp: ["description"],
      desc: ["type"],
      amount: ["amount"],
      cur: ["currency"],
      fee: ["fee"],
      acc: ["product"],
    },
  },
  {
    bank: "American Express",
    test: (h) =>
      (h.includes("date") || h.includes("datum")) &&
      h.includes("amount") &&
      (h.includes("card member") || h.includes("appears on your statement as") || h.includes("extended details")),
    map: {
      date: ["date"],
      cp: ["description"],
      desc: ["appears on your statement as"],
      amount: ["amount"],
    },
    flip: true,
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
  };

  const dcNeg = (m.dcNeg ?? ["af", "d", "debet", "debit"]).map(norm);
  const flip = prof?.flip ?? false;
  const cashOnly = prof?.cashOnly ?? false;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;
    const date = parseDate(r[ci.date]);
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

  return { accounts: Object.values(accounts), txs, profile: prof ? prof.bank : "generic" };
}
