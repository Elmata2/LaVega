import type { Tx } from "../model.js";
import { parseBankCsv } from "./bankCsv.js";

export { splitRows, parseDate, parseAmount, headerIndex } from "./primitives.js";

/* --- ING CSV: a thin wrapper over the profile-driven engine (./bankCsv.ts).
 * The engine derives each row's account key from the CSV's own "Rekening"
 * column (via findIban/fallback) so it can support multi-account files; this
 * wrapper preserves parseIngCsv's original, simpler contract of "every row is
 * tagged with the caller-supplied accountKey", which existing callers (e.g.
 * adapters/fileImport.ts) and tests depend on. Forcing accountKey here (not
 * just relying on the engine's own derivation, which happens to agree with it
 * in this repo's fixtures) is what makes the output byte-identical regardless
 * of what the CSV's "Rekening" column contains. --- */
export function parseIngCsv(text: string, accountKey: string): Omit<Tx, "id">[] {
  const { txs } = parseBankCsv(text, accountKey);
  return txs.map((t) => ({ ...t, accountKey }));
}
