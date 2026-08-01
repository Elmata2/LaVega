import type { Account, Tx } from "../model.js";
import { parseDate, parseAmount, findIban, bankFromIban, bankFromBic } from "./primitives.js";

/* Ported from Kasoverzicht.html's parseMT940 (398-442): splits the statement
 * into per-account blocks on ":20:", merges MT940 continuation lines, reads
 * the account IBAN from ":25:" and the closing balance from ":60F/M:" or
 * ":62F/M:", then walks each ":61:" transaction line (paired with the
 * following ":86:" info line) into a tx. Pure string parsing — no I/O.
 * `.STA` is just MT940 by another extension; content-based format detection
 * (dispatching text to this parser) is out of scope here. */

export function parseMt940(text: string): { accounts: Account[]; txs: Array<Omit<Tx, "id">> } {
  const accounts: Record<string, Account> = {};
  const txs: Array<Omit<Tx, "id">> = [];
  // The statement header (before the first :20:) carries the account's own BIC
  // (e.g. ABN's ".STA" starts with "ABNANL2A"). We read the bank from it only
  // for accounts whose :25: is an old-style account number, not an IBAN. Scoped
  // to the header so a counterparty BIC inside a :86: line can't mislabel it.
  const i20 = text.indexOf(":20:");
  const headerBic = (i20 > 0 ? text.slice(0, i20) : "").match(/\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/)?.[0] ?? null;
  const blocks = text.split(/(?=:20:)/).filter((b) => /:61:/.test(b) || /:25:/.test(b));
  for (const b of blocks) {
    const lines = b.split(/\r?\n/);
    // continuatieregels samenvoegen
    const flat: string[] = [];
    for (const ln of lines) {
      if (/^:\d{2}[A-Z]?:/.test(ln)) flat.push(ln);
      else if (flat.length) flat[flat.length - 1] += "\n" + ln;
    }
    let acc: string | null = null;
    let cur = "EUR";
    let close: number | null = null;
    for (const f of flat) {
      if (f.startsWith(":25:")) acc = findIban(f.slice(4)) || f.slice(4).trim();
      const mb = f.match(/^:6[02][FM]:([CD])(\d{6})([A-Z]{3})([\d.,]+)/);
      if (mb) {
        cur = mb[3];
        const v = parseAmount(mb[4]);
        if (v != null) close = mb[1] === "D" ? -v : v;
      }
    }
    if (!acc) continue;
    accounts[acc] = accounts[acc] || {
      key: acc, iban: findIban(acc) ?? "", name: acc,
      bank: bankFromIban(acc) ?? bankFromBic(headerBic) ?? "", entity: "", currency: cur, balance: close,
    };
    if (close != null) accounts[acc].balance = close;
    for (let i = 0; i < flat.length; i++) {
      const m = flat[i].match(/^:61:(\d{6})(\d{4})?(C|D|RC|RD)([A-Z])?([\d.,]+)/);
      if (!m) continue;
      const date = parseDate(m[1]);
      const sign = /D/.test(m[3]) ? -1 : 1;
      const val = parseAmount(m[5]);
      if (date == null || val == null) continue;
      let info = "";
      if (flat[i + 1] && flat[i + 1].startsWith(":86:")) info = flat[i + 1].slice(4);
      const ref = (flat[i].split(/\n/)[0] || "").slice(-40);
      const clean = info.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      // NL-banken gebruiken /NAME/ /REMI/ tags
      let cp = "";
      let desc = clean;
      const nm = clean.match(/\/(?:NAME|NAAM|BENM\/NM|ORDP\/NM)\/([^/]+)/i);
      const rm = clean.match(/\/(?:REMI|EREF|PREF)\/([^/]+)/i);
      if (nm) cp = nm[1].trim();
      if (rm) desc = rm[1].trim();
      if (!cp) {
        const parts = clean.split(/\s{2,}/);
        cp = (parts[0] || "").slice(0, 60);
      }
      txs.push({
        accountKey: acc, date, amount: sign * Math.abs(val), currency: cur,
        counterparty: cp, description: desc || ref, category: "", manual: false,
      });
    }
  }
  return { accounts: Object.values(accounts), txs };
}
