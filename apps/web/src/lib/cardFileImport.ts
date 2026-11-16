import { createFileImport, type BankResult } from "@lavega/adapters";
import {
  bankMatchesBrand,
  cardFileHintKey,
  spreadsheetKind,
  type CardFileInput,
  type CardFilePlan,
} from "@lavega/core";
import { formatDate } from "../format.js";
import type { Locale } from "../locale.js";
import { xlsxToRows } from "../xlsx.js";

/* The read half of "add a card by file". Reading writes nothing. Planning (what
 * would be new, what is a duplicate) is core's `planCardFiles`, run over the
 * whole list so each file is counted against the vault plus the earlier files. */

/** A not-connected card the file is for; `brand` is the wizard brand id. */
export type CardTarget = {
  id: string;
  name: string;
  brand: string | null;
  kind: "credit" | "debit";
};

export type FilePreview = {
  /** Unique within one dialog session (a name can repeat). */
  id: string;
  name: string;
  /** Null when the file could not be read at all. */
  result: BankResult | null;
  /** Why there is no result. Never a raw exception text. */
  reason: "xls" | "unreadable" | null;
  /** The file's accounts belong to the chosen card's bank (true with no card). */
  matchesCard: boolean;
};

async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsArrayBuffer(blob);
  });
}

/** Read one file. Never throws: any failure becomes a `reason`. */
export async function previewCardFile(
  file: File,
  o: { id: string; entity: string; card: CardTarget | null },
): Promise<FilePreview> {
  const base = { id: o.id, name: file.name, matchesCard: true };
  // The old binary Excel format has no reader here; say so instead of trying.
  if (/\.xls$/i.test(file.name)) return { ...base, result: null, reason: "xls" };
  try {
    const bytes = await readBytes(file);
    const text = new TextDecoder().decode(bytes);
    const hint = o.card ? cardFileHintKey(o.card.id) : undefined;
    const sheet = spreadsheetKind(file.name, text.slice(0, 4));
    const result = await createFileImport().load({
      filename: file.name,
      text,
      entity: o.entity,
      ...(hint ? { accountHint: hint } : {}),
      ...(sheet ? { sheet: { format: sheet, rows: await xlsxToRows(bytes) } } : {}),
    });
    const brand = o.card?.brand ?? null;
    const matchesCard =
      brand === null || result.accounts.some((a) => bankMatchesBrand(a.bank, brand));
    return { ...base, result, reason: null, matchesCard };
  } catch {
    return { ...base, result: null, reason: "unreadable" };
  }
}

/** The input core plans and commits: the card link holds only for a file that
 *  belongs to the card, or after an explicit "add anyway" (then without it). */
export function toInput(
  p: FilePreview,
  card: CardTarget | null,
  overridden: boolean,
  sameCard?: boolean,
): CardFileInput | null {
  if (p.result === null) return null;
  return {
    result: p.result,
    target: card ? { cardId: card.id, label: card.name, brand: card.brand } : null,
    link: card !== null && p.matchesCard && !overridden,
    ...(sameCard === undefined ? {} : { sameCard }),
  };
}

/** Whether a file can be added as it stands. */
export const isCommittable = (p: FilePreview, plan: CardFilePlan | undefined, overridden: boolean) =>
  p.result !== null &&
  plan !== undefined &&
  plan.problems.length === 0 &&
  plan.txCount > 0 &&
  (p.matchesCard || overridden);

/** "3 nov – 9 nov 2026": the first year is left out when both dates share it. */
export function formatPeriod(locale: Locale, from: string, to: string): string {
  const a = formatDate(locale, from);
  const b = formatDate(locale, to);
  const year = (s: string) => s.slice(0, 4);
  if (year(from) === year(to)) return `${a.replace(/ \d{4}$/, "")} – ${b}`;
  return `${a} – ${b}`;
}
