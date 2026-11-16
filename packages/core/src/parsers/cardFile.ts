import type { Account, Tx } from "../model.js";
import { withLinkedAt } from "../model.js";
import { ingest } from "../ingest.js";
import { mergeImportedAccounts } from "../views.js";
import { bankMatchesBrand } from "../plan/connectChecklist.js";
import type { ParsedBankFile } from "./parseBankFile.js";
import { T212_CARD_ACCOUNT_KEY, type UnrecognisedAction } from "./bankCsv.js";

/* A file-fed card: an export uploaded for a card that no bank link can reach
 * (American Express, the Trading 212 card). Pure. One function prepares a file
 * (re-key to an account the vault already holds, stamp), one plans a list of
 * files against the vault, one applies them. Plan and apply share the same
 * sequential walk, so what the preview says is what gets stored. */

/** Card brands that can only be fed by a file (`FILE_ROUTE_BRANDS` lists them);
 *  ids match the wizard's brands. */
export type FileOnlyBrand = "amex" | "trading-212";

/** Which file-only brand a parser profile (`ParsedBankFile.source`) belongs to. */
export function brandOfSource(source: string): FileOnlyBrand | null {
  if (source === "American Express") return "amex";
  if (source === "Trading 212") return "trading-212";
  return null;
}

export type CardFileTarget = {
  /** The stated card's catalogue id (the account will stand in for it). */
  cardId: string;
  /** What the account is called when the parser only knew a key. */
  label: string;
  /** The wizard brand id of the card. */
  brand: string | null;
};

/** The account key to use when a file names none: stable for the picked card, never the filename. */
export const cardFileHintKey = (cardId: string): string => `FILE-${cardId}`;

/** A parsed file as the plan and the commit take it. */
export type CardFileInput = {
  result: Pick<ParsedBankFile, "accounts" | "txs" | "source"> &
    Partial<Pick<ParsedBankFile, "unrecognised" | "unreadable" | "problems">>;
  /** The card the file was chosen for; null = no card (Profiel, "other"). */
  target: CardFileTarget | null;
  /** Tie the file to `target` (false after an explicit "add anyway"). */
  link: boolean;
  /** The answer to "is this the same card as your existing account?" (undefined = not asked/answered). */
  sameCard?: boolean;
};

type Held = { accounts: readonly Account[]; txs: readonly Tx[] };

/** Mark every account of a file as file-fed, and tie ONE of them to the stated
 *  card. Trading 212: only the card account (`TRADING212-CARD`) can be tied; a
 *  file with cash rows only is not the card, so nothing is stamped. Others: the
 *  only account, else the one with the most rows. A bare parser key as name
 *  becomes the card's label. */
export function stampCardFile(
  parsed: Pick<ParsedBankFile, "accounts" | "txs">,
  target: CardFileTarget | null,
): Account[] {
  const counts = new Map<string, number>();
  for (const t of parsed.txs) counts.set(t.accountKey, (counts.get(t.accountKey) ?? 0) + 1);
  const t212 = target?.brand === "trading-212";
  if (target !== null && t212 && !parsed.accounts.some((a) => a.key === T212_CARD_ACCOUNT_KEY))
    return [...parsed.accounts];
  const lead =
    target === null
      ? null
      : t212
        ? (parsed.accounts.find((a) => a.key === T212_CARD_ACCOUNT_KEY) ?? null)
        : ([...parsed.accounts].sort(
            (a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0),
          )[0] ?? null);
  return parsed.accounts.map((a) => {
    const bare = a.name === a.key && target !== null && a.key !== T212_CARD_ACCOUNT_KEY;
    // The lead takes the card's name; a further Amex card in the same file gets it
    // plus its last digits; others keep theirs.
    const name = !bare
      ? a.name
      : a === lead
        ? target.label
        : a.key.startsWith("AMEX-")
          ? `${target.label} ${a.key.slice(-5)}`
          : a.name;
    const stamped: Account = { ...a, name, source: "file" };
    if (target !== null && a === lead) stamped.statedCardId = target.cardId;
    return stamped;
  });
}

/** The existing accounts a file may be merged into: file-fed or legacy file
 *  accounts only. A live bank link (`balanceFetchedAt`) is never one, and neither
 *  is a hand-made account (it was never imported, so it has no `linkedAt`). */
const isFileCandidate = (a: Account): boolean =>
  bankMatchesBrand(a.bank, "amex") &&
  a.balanceFetchedAt === undefined &&
  (a.source === "file" || a.linkedAt !== undefined);

export type ExistingQuestion = { accountKey: string; accountName: string };

/** Where the rows of an Amex file go, without ever merging two cards on a guess.
 *  A wrong merge cannot be undone; a wrong split can be merged by hand. Re-key
 *  onto an existing account ONLY when:
 *   (a) it is stamped with the SAME `statedCardId` as the target card;
 *   (b) the keys are equal: the parser keys an account column as `AMEX-<last 5
 *       digits>`, so an equal key is the same card and needs no re-key. A key that
 *       only ends in the same digits, or a 4-digit filename year, is no evidence;
 *   (c) the one existing account is an UNSTAMPED legacy file account and the user
 *       answered "same card" (`sameCard: true`). Until answered, `question` is set
 *       and the file is not written; `false` imports it as a separate account.
 *  An account stamped for a different card is never a target. */
export function alignToExisting(
  parsed: { accounts: Account[]; txs: Array<Omit<Tx, "id">> },
  held: Held,
  opts: { cardId: string | null; sameCard?: boolean } = { cardId: null },
): {
  accounts: Account[];
  txs: Array<Omit<Tx, "id">>;
  unmatched: boolean;
  question: ExistingQuestion | null;
} {
  const candidates = held.accounts.filter(isFileCandidate);
  if (candidates.length === 0) return { ...parsed, unmatched: false, question: null };
  const rekey = new Map<string, Account>();
  let question: ExistingQuestion | null = null;
  let unmatched = false;
  // A file with several cards is never folded: with more than one parsed account
  // there is no telling which one an existing account belongs to, so each keeps
  // its own key and the preview says the existing data could not be matched.
  const single = parsed.accounts.length === 1;
  for (const p of parsed.accounts) {
    if (candidates.some((e) => e.key === p.key)) continue; // already the same key
    const sameStamp =
      single && opts.cardId !== null
        ? candidates.find((e) => e.statedCardId === opts.cardId)
        : undefined;
    if (sameStamp !== undefined) {
      rekey.set(p.key, sameStamp);
      continue;
    }
    const legacy = candidates.filter((e) => e.statedCardId === undefined);
    if (single && legacy.length === 1) {
      if (opts.sameCard === true) rekey.set(p.key, legacy[0]!);
      else if (opts.sameCard === undefined)
        question = { accountKey: legacy[0]!.key, accountName: legacy[0]!.name };
    } else if (
      legacy.length > 0 ||
      (opts.cardId !== null && candidates.some((e) => e.statedCardId === opts.cardId))
    )
      unmatched = true;
  }
  if (rekey.size === 0) return { ...parsed, unmatched, question };
  const accounts = parsed.accounts.map((a) => {
    const to = rekey.get(a.key);
    return to === undefined ? a : { ...a, key: to.key, name: to.name, iban: to.iban || a.iban };
  });
  const txs = parsed.txs.map((t) => {
    const to = rekey.get(t.accountKey);
    return to === undefined ? t : { ...t, accountKey: to.key };
  });
  return { accounts, txs, unmatched, question };
}

/** One file ready to merge: re-keyed to what the vault holds, stamped, and the
 *  two facts a preview must say out loud. */
export function prepareCardFile(
  file: CardFileInput,
  held: Held,
): {
  accounts: Account[];
  txs: Array<Omit<Tx, "id">>;
  noCardPayments: boolean;
  unmatchedExisting: boolean;
  question: ExistingQuestion | null;
} {
  const brand = file.target?.brand ?? null;
  const detected = brandOfSource(file.result.source);
  const aligned =
    detected === "amex" && (brand === "amex" || file.target === null)
      ? alignToExisting({ accounts: [...file.result.accounts], txs: [...file.result.txs] }, held, {
          cardId: file.target?.cardId ?? null,
          ...(file.sameCard === undefined ? {} : { sameCard: file.sameCard }),
        })
      : {
          accounts: [...file.result.accounts],
          txs: [...file.result.txs],
          unmatched: false,
          question: null,
        };
  const noCardPayments =
    file.target !== null &&
    file.link &&
    brand === "trading-212" &&
    !aligned.accounts.some((a) => a.key === T212_CARD_ACCOUNT_KEY);
  const accounts =
    file.target !== null && file.link ? stampCardFile(aligned, file.target) : aligned.accounts;
  return {
    accounts,
    txs: aligned.txs,
    noCardPayments,
    unmatchedExisting: aligned.unmatched,
    question: aligned.question,
  };
}

export type CardFilePlan = {
  source: string;
  brand: FileOnlyBrand | null;
  /** First and last transaction date (ISO), null when the file held none. */
  period: { from: string; to: string } | null;
  txCount: number;
  /** Rows already in the vault or in an earlier file of the same list. */
  duplicateCount: number;
  newCount: number;
  accountKeys: string[];
  unrecognised: UnrecognisedAction[];
  unreadable: number;
  problems: NonNullable<CardFileInput["result"]["problems"]>;
  /** A Trading 212 file with no card payments: imported, not tied to the card. */
  noCardPayments: boolean;
  /** Amex data already in the vault could not be matched to this file. */
  unmatchedExisting: boolean;
  /** Set while the user has not said whether this is the same card as an existing
   *  unstamped account. The file is not written until answered. */
  question: ExistingQuestion | null;
  /** Where the rows go: an account the vault already holds, or a new one. */
  destination: { existing: boolean; name: string } | null;
};

/** Walk the files in order, each against the vault PLUS the earlier files. */
function walk(held: Held, files: readonly CardFileInput[], asOf: string) {
  let txs: Tx[] = [...held.txs];
  let accounts: Account[] = [...held.accounts];
  const touched = new Map<string, Account>();
  const plans: CardFilePlan[] = [];
  for (const f of files) {
    const prep = prepareCardFile(f, { accounts, txs });
    // A file with an open question is not written (and nothing later depends on it).
    const write = prep.question === null;
    const merged = write ? ingest(txs, prep.txs) : txs;
    const counts = new Map<string, number>();
    for (const t of prep.txs) counts.set(t.accountKey, (counts.get(t.accountKey) ?? 0) + 1);
    const lead = [...prep.accounts].sort(
      (x, y) => (counts.get(y.key) ?? 0) - (counts.get(x.key) ?? 0),
    )[0];
    const existing = lead === undefined ? undefined : accounts.find((a) => a.key === lead.key);
    const newCount = merged.length - txs.length;
    const dates = prep.txs.map((t) => t.date).sort();
    plans.push({
      source: f.result.source,
      brand: brandOfSource(f.result.source),
      period: dates.length > 0 ? { from: dates[0]!, to: dates[dates.length - 1]! } : null,
      txCount: prep.txs.length,
      duplicateCount: Math.max(0, prep.txs.length - newCount),
      newCount,
      accountKeys: prep.accounts.map((a) => a.key),
      unrecognised: f.result.unrecognised ?? [],
      unreadable: f.result.unreadable ?? 0,
      problems: f.result.problems ?? [],
      noCardPayments: prep.noCardPayments,
      unmatchedExisting: prep.unmatchedExisting,
      question: prep.question,
      destination:
        lead === undefined
          ? null
          : { existing: existing !== undefined, name: existing?.name ?? lead.name },
    });
    txs = merged;
    if (write && (prep.txs.length > 0 || prep.accounts.length > 0)) {
      const stamped = withLinkedAt(accounts, mergeImportedAccounts(accounts, prep.accounts), asOf);
      for (const a of stamped) touched.set(a.key, a);
      const keys = new Set(stamped.map((a) => a.key));
      accounts = [...accounts.filter((a) => !keys.has(a.key)), ...stamped];
    }
  }
  return { plans, txs, accounts, put: [...touched.values()] };
}

/** What a commit WOULD do, file by file. Writes nothing. */
export function planCardFiles(
  held: Held,
  files: readonly CardFileInput[],
  asOf: string,
): CardFilePlan[] {
  return walk(held, files, asOf).plans;
}

/** The merged result of committing the files in order: the transactions to
 *  store, the accounts to upsert, and how many rows were new. */
export function applyCardFiles(
  held: Held,
  files: readonly CardFileInput[],
  asOf: string,
): { txs: Tx[]; accounts: Account[]; added: number } {
  const r = walk(held, files, asOf);
  return { txs: r.txs, accounts: r.put, added: r.txs.length - held.txs.length };
}
