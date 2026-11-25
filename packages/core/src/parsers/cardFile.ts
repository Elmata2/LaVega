import type { Account, Tx } from "../model.js";
import { hasStatedCatalogueCard, withLinkedAt } from "../model.js";
import { ingest } from "../ingest.js";
import { mergeImportedAccounts } from "../views.js";
import { mergeAccounts } from "../accounts.js";
import { accountTypeKind } from "../balance.js";
import { txBase, txId } from "../hash.js";
import { isInvestmentAccount } from "../transfers.js";
import { bankMatchesBrand } from "../plan/connectChecklist.js";
import type { ParsedBankFile } from "./parseBankFile.js";
import { T212_ACCOUNT_KEY, T212_ACCOUNT_NAME, type UnrecognisedAction } from "./bankCsv.js";

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
 *  card: the only account, else the one with the most rows. Trading 212 has one
 *  account for card and cash, so a file for its card always ties it, also when
 *  that export holds cash rows only. A bare parser key as name becomes the card's
 *  label. */
export function stampCardFile(
  parsed: Pick<ParsedBankFile, "accounts" | "txs">,
  target: CardFileTarget | null,
): Account[] {
  const counts = new Map<string, number>();
  for (const t of parsed.txs) counts.set(t.accountKey, (counts.get(t.accountKey) ?? 0) + 1);
  const lead =
    target === null
      ? null
      : ([...parsed.accounts].sort(
          (a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0),
        )[0] ?? null);
  return parsed.accounts.map((a) => {
    const bare = a.name === a.key && target !== null;
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

/** The bank name the Trading 212 parser writes. Whole-name match: "Trading 212 ISA"
 *  or "Trading 212 beleggen" are other products and never fold. */
const isT212Bank = (bank: string): boolean => /^trading ?212$/i.test(bank.trim());

/** Soort that can never be a Trading 212 cash/card account. */
const isNonCashType = (a: Account): boolean =>
  isInvestmentAccount(a) || accountTypeKind(a) === "savings";

/** Earlier versions kept Trading 212 card rows and cash rows in two accounts (the
 *  cash one keyed by the file name). Only an account the card-file path made is a
 *  fold candidate: bank exactly Trading 212, no live link, file-fed (`source`
 *  "file", a `statedCardId`, or a key that is a Trading 212 export file name; a
 *  bare `linkedAt` proves nothing, every import path stamps it), no hand-typed rows, no investing or savings type. Entity, currency
 *  and type must then agree with the surviving account (see `foldTrading212`). */
/** A Trading 212 export is named `from_<date>_to_<date>_<id>`, and the old parser
 *  used that file name as the cash account's key. A key of this shape is as good
 *  as a file stamp: nothing else produces it. It covers an import made with no
 *  card picked, which never stamped `source`. */
const isT212ExportKey = (key: string): boolean =>
  /^from_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}/.test(key);

const isFoldCandidateT212 = (a: Account, txs: readonly Tx[]): boolean =>
  a.key !== T212_ACCOUNT_KEY &&
  isT212Bank(a.bank) &&
  a.balanceFetchedAt === undefined &&
  (a.source === "file" || hasStatedCatalogueCard(a) || isT212ExportKey(a.key)) &&
  !isNonCashType(a) &&
  !txs.some((t) => t.accountKey === a.key && t.manual);

export type AccountFold = { survivorKey: string; duplicateKey: string };

/** Fold every earlier Trading 212 account into the one account, with the SAME core
 *  merge as the "samenvoegen" button (`mergeAccounts`): rows move to the one key,
 *  ids are re-derived, a row held under both keys stays once. A candidate whose
 *  entity or currency differs from the survivor's, or whose `type` is set and
 *  differs, stays untouched. With no survivor yet the candidates must share ONE
 *  entity, else nothing folds (`blocked`). Balance: the surviving account's own
 *  wins; a balance only the folded account had moves over with its date.
 *  `txIdRemap` maps an absorbed row to the survivor's identical row (never null),
 *  so a retry after a half-finished commit still finds where a record's row went.
 *  Pure. */
export function foldTrading212(held: Held): {
  accounts: Account[];
  txs: Tx[];
  folds: AccountFold[];
  txIdRemap: Map<string, string | null>;
  blocked: boolean;
} {
  let accounts = held.accounts.map((a) =>
    a.key === T212_ACCOUNT_KEY && !a.renamed && a.name !== T212_ACCOUNT_NAME
      ? { ...a, name: T212_ACCOUNT_NAME }
      : a,
  );
  let txs = [...held.txs];
  const folds: AccountFold[] = [];
  const txIdRemap = new Map<string, string | null>();
  const none = { accounts, txs, folds, txIdRemap, blocked: false };
  const survivor0 = accounts.find((a) => a.key === T212_ACCOUNT_KEY);
  if (survivor0 !== undefined && isNonCashType(survivor0)) return none;
  const pool = accounts.filter((a) => isFoldCandidateT212(a, txs));
  const ref = survivor0 ?? pool[0];
  if (ref === undefined) return none;
  if (survivor0 === undefined && new Set(pool.map((a) => a.entity)).size > 1)
    return { ...none, blocked: true };
  const typeOf = (a: Account) => a.type ?? "";
  const refType = survivor0 !== undefined ? typeOf(survivor0) : typeOf(ref);
  const dups = pool.filter(
    (a) =>
      a.entity === ref.entity &&
      a.currency === ref.currency &&
      (typeOf(a) === "" || typeOf(a) === refType),
  );
  for (const dup of dups) {
    if (!accounts.some((a) => a.key === T212_ACCOUNT_KEY))
      accounts = [
        ...accounts,
        { ...dup, key: T212_ACCOUNT_KEY, ...(dup.renamed ? {} : { name: T212_ACCOUNT_NAME }) },
      ];
    const dupTxs = txs.filter((t) => t.accountKey === dup.key);
    const r = mergeAccounts(accounts, txs, T212_ACCOUNT_KEY, dup.key);
    accounts = r.accounts.map((a) =>
      a.key !== T212_ACCOUNT_KEY
        ? a
        : {
            ...a,
            ...(a.balance === null && dup.balance !== null
              ? {
                  balance: dup.balance,
                  ...(dup.balanceDate !== undefined ? { balanceDate: dup.balanceDate } : {}),
                }
              : {}),
            ...(a.statedCardId === undefined && dup.statedCardId !== undefined
              ? { statedCardId: dup.statedCardId }
              : {}),
            ...(a.source === undefined && dup.source !== undefined ? { source: dup.source } : {}),
            ...(a.linkedAt === undefined && dup.linkedAt !== undefined
              ? { linkedAt: dup.linkedAt }
              : {}),
          },
    );
    txs = r.txs;
    // An absorbed row (null) is the same movement the survivor already holds:
    // point at that row (same base, same occurrence) rather than at nothing.
    const seen = new Map<string, number>();
    for (const t of dupTxs) {
      const base = txBase({ ...t, accountKey: T212_ACCOUNT_KEY });
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      const to = r.txIdRemap.get(t.id);
      txIdRemap.set(t.id, to === null || to === undefined ? txId(base, k) : to);
    }
    folds.push({ survivorKey: T212_ACCOUNT_KEY, duplicateKey: dup.key });
  }
  return { accounts, txs, folds, txIdRemap, blocked: false };
}

/** One file ready to merge: re-keyed to what the vault holds, stamped, and the
 *  facts a preview must say out loud. */
export function prepareCardFile(
  file: CardFileInput,
  held: Held,
): {
  accounts: Account[];
  txs: Array<Omit<Tx, "id">>;
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
  const accounts =
    file.target !== null && file.link ? stampCardFile(aligned, file.target) : aligned.accounts;
  return {
    accounts,
    txs: aligned.txs,
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
  /** Importing this file merges earlier Trading 212 accounts into the one account. */
  foldsExisting: boolean;
  /** Earlier Trading 212 accounts sit in different entities, so none is merged. */
  foldBlocked: boolean;
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
  const folds: AccountFold[] = [];
  const txIdRemap = new Map<string, string | null>();
  let added = 0;
  for (const f of files) {
    // A Trading 212 file with rows folds the earlier Trading 212 accounts first.
    const folding =
      brandOfSource(f.result.source) === "trading-212" &&
      (f.result.txs.length > 0 || f.result.accounts.length > 0)
        ? foldTrading212({ accounts, txs })
        : null;
    const base = folding ?? { accounts, txs, folds: [] as AccountFold[] };
    const prep = prepareCardFile(f, { accounts: base.accounts, txs: base.txs });
    // A file with an open question is not written (and nothing later depends on it).
    const write = prep.question === null;
    const merged = write ? ingest(base.txs, prep.txs) : base.txs;
    const counts = new Map<string, number>();
    for (const t of prep.txs) counts.set(t.accountKey, (counts.get(t.accountKey) ?? 0) + 1);
    const lead = [...prep.accounts].sort(
      (x, y) => (counts.get(y.key) ?? 0) - (counts.get(x.key) ?? 0),
    )[0];
    const existing = lead === undefined ? undefined : base.accounts.find((a) => a.key === lead.key);
    const newCount = merged.length - base.txs.length;
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
      foldsExisting: base.folds.length > 0,
      foldBlocked: folding?.blocked ?? false,
      unmatchedExisting: prep.unmatchedExisting,
      question: prep.question,
      destination:
        lead === undefined
          ? null
          : { existing: existing !== undefined, name: existing?.name ?? lead.name },
    });
    if (write) {
      accounts = base.accounts;
      txs = merged;
      added += newCount;
      folds.push(...base.folds);
      if (folding) for (const [from, to] of folding.txIdRemap) txIdRemap.set(from, to);
      for (const x of base.folds) touched.delete(x.duplicateKey);
    }
    if (write && (prep.txs.length > 0 || prep.accounts.length > 0)) {
      const stamped = withLinkedAt(accounts, mergeImportedAccounts(accounts, prep.accounts), asOf);
      for (const a of stamped) touched.set(a.key, a);
      const keys = new Set(stamped.map((a) => a.key));
      accounts = [...accounts.filter((a) => !keys.has(a.key)), ...stamped];
    }
  }
  return { plans, txs, accounts, put: [...touched.values()], folds, txIdRemap, added };
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
 *  store, the accounts to upsert, how many rows were new, and what a Trading 212
 *  fold removed (account keys, tx ids) plus the id remap for records that point
 *  at transactions (transfer pairs). */
export function applyCardFiles(
  held: Held,
  files: readonly CardFileInput[],
  asOf: string,
): {
  txs: Tx[];
  accounts: Account[];
  added: number;
  removedAccountKeys: string[];
  removedTxIds: string[];
  folds: AccountFold[];
  txIdRemap: Map<string, string | null>;
} {
  const r = walk(held, files, asOf);
  const kept = new Set(r.txs.map((t) => t.id));
  return {
    txs: r.txs,
    accounts: r.put,
    added: r.added,
    removedAccountKeys: r.folds.map((x) => x.duplicateKey),
    removedTxIds: held.txs.filter((t) => !kept.has(t.id)).map((t) => t.id),
    folds: r.folds,
    txIdRemap: r.txIdRemap,
  };
}
