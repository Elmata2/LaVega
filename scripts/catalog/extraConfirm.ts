/* THE DECISIONS of the per-figure pass for a stored fee, points or cashback figure, as pure functions:
 * the sweep reads documents and calls the model, these say what the facts mean. */
import {
  expectedExtraFieldsFor,
  NO_ROUTE_PREFIX,
  TOO_LARGE_PREFIX,
  type CatalogField,
  type ConfirmedBy,
  type ExtraField,
  type FeePeriod,
} from "@lavega/core";
import {
  documentNamesProduct,
  isZeroByAbsence,
  sameDocument,
  sameValue,
  storedCheckOf,
  type ConfirmOutcome,
} from "./catalogConfirm.js";

/** The figure is not checked: what the coverage records (`fetched`, `reason`) and the note kept in state. */
export type ExtraStop = { fetched: boolean; reason: string; note: string };

/** A stored absence (a zero without a programme) needs a document at least this long. */
export const MIN_ABSENCE_DOC_CHARS = 1_000;

const isWebAddress = (u: string) => /^https?:\/\//i.test(u.trim());

/** Before any document is read: no model, or no web source. */
export function stopBeforeRead(input: {
  label: string;
  useAgent: boolean;
  sourceUrl: string;
}): ExtraStop | null {
  if (!input.useAgent) {
    return {
      fetched: false,
      reason: `${NO_ROUTE_PREFIX} (model off)`,
      note: `${input.label}: not checked, model off`,
    };
  }
  if (!isWebAddress(input.sourceUrl)) {
    return {
      fetched: false,
      reason: "no source: stored source is not a web address",
      note: `${input.label}: no web source`,
    };
  }
  return null;
}

/** After the stored document was read: is it a document the question can be asked on? A zero that
 *  rests on absence counts only on a document that is long enough and names the product. */
export function judgeDocument(input: {
  label: string;
  field: CatalogField;
  value: number;
  product: string;
  issuer?: string;
  siblings?: readonly string[];
  text: string;
  maxChars: number;
}): { stop: ExtraStop | null; zeroByAbsence: boolean } {
  const zeroByAbsence = isZeroByAbsence(input.field, input.value);
  const size = Math.round(input.text.length / 1000);
  if (input.text.length > input.maxChars) {
    return {
      zeroByAbsence,
      stop: {
        fetched: true,
        reason: `${TOO_LARGE_PREFIX}: ${size}k chars`,
        note: `${input.label}: document too large (${size}k chars)`,
      },
    };
  }
  if (!zeroByAbsence) return { stop: null, zeroByAbsence };
  if (input.text.trim().length < MIN_ABSENCE_DOC_CHARS) {
    return {
      zeroByAbsence,
      stop: {
        fetched: false,
        reason: "fetch failed: document too short to show an absence",
        note: `${input.label}: document too short to show an absence`,
      },
    };
  }
  if (!documentNamesProduct(input.text, input.product, input.issuer, input.siblings)) {
    return {
      zeroByAbsence,
      stop: {
        fetched: true,
        reason: "document does not name the product",
        note: `${input.label}: document does not name the product`,
      },
    };
  }
  return { stop: null, zeroByAbsence };
}

/** Before the open question is asked for a figure the catalogue does not hold: the document must be
 *  small enough and must name the product, or a first figure could belong to a neighbour. */
export function judgeMissingDocument(input: {
  label: string;
  product: string;
  issuer?: string;
  siblings?: readonly string[];
  text: string;
  maxChars: number;
}): ExtraStop | null {
  const { label, text } = input;
  if (text.length > input.maxChars) {
    const size = Math.round(text.length / 1000);
    return {
      fetched: true,
      reason: `${TOO_LARGE_PREFIX}: ${size}k chars`,
      note: `${label}: document too large (${size}k chars)`,
    };
  }
  if (!documentNamesProduct(text, input.product, input.issuer, input.siblings)) {
    return {
      fetched: true,
      reason: "document does not name the product",
      note: `${label}: document does not name the product`,
    };
  }
  return null;
}

export type ExtraDecision =
  | { kind: "confirmed"; by: ConfirmedBy; note: string }
  | { kind: "not-checked"; note: string };

/** What the answer of the confirm call means for the figure. Only a still_stated reply or a
 *  none_stated reply (the parser lets it through only for a zero by absence) confirms; the
 *  rest leave the figure unchecked, with the reason. */
export function decideExtra(input: {
  label: string;
  outcome: ConfirmOutcome;
  why: string;
}): ExtraDecision {
  const { label, outcome, why } = input;
  if (outcome.kind !== "reply") return { kind: "not-checked", note: `${label}: confirm: ${why}` };
  const { reply } = outcome;
  switch (reply.status) {
    case "still_stated":
      return { kind: "confirmed", by: "quote-check", note: `${label}: confirm: still stated` };
    case "none_stated":
      return {
        kind: "confirmed",
        by: "no-programme-found",
        note: `${label}: confirm: no programme found`,
      };
    case "changed":
      return {
        kind: "not-checked",
        note: `${label}: confirm: changed to ${reply.newValue} (not published)`,
      };
    case "not_on_page":
      return { kind: "not-checked", note: `${label}: confirm: not on page` };
  }
}

/** The confirm said the stored figure is not what the document shows (changed) or not there at all:
 *  only then is the open question asked, on the same document. */
export function wantsOpenQuestion(outcome: ConfirmOutcome): boolean {
  return (
    outcome.kind === "reply" &&
    (outcome.reply.status === "changed" || outcome.reply.status === "not_on_page")
  );
}

export type OpenDecision =
  | { kind: "not-checked"; note: string }
  | {
      kind: "read";
      /** The cross-check handed to the guard; null when the read is not a covered, different figure. */
      storedCheck: "gone" | "unresolved" | null;
      confirmedBy: ConfirmedBy | null;
      note: string;
    };

/** What the open answer means, given the confirm outcome that triggered it. The confirm is reused as
 *  the cross-check (it was asked on the stored document); no second call is made. */
export function decideOpen(input: {
  label: string;
  field: CatalogField;
  stored: { value: number; period?: FeePeriod };
  outcome: ConfirmOutcome;
  found: { value: number; period?: FeePeriod; covered: boolean } | null;
}): OpenDecision {
  const { label, field, stored, outcome, found } = input;
  const confirmSaid =
    outcome.kind === "reply" && outcome.reply.status === "changed"
      ? `changed to ${outcome.reply.newValue}`
      : "not on page";
  if (!found) {
    if (field === "accountFee" && confirmSaid === "changed to 0") {
      return {
        kind: "not-checked",
        note: `${label}: confirm: changed to 0; a zero fee needs a person`,
      };
    }
    return {
      kind: "not-checked",
      note: `${label}: confirm: ${confirmSaid}, open question found no figure`,
    };
  }
  const equal =
    sameValue(found.value, stored.value) &&
    (field !== "accountFee" || found.period === stored.period);
  if (equal) {
    // Two model reads that disagree must not refresh the figure. After not_on_page only a covered
    // read of the stored figure confirms it: the closed question could not find it here.
    if (outcome.kind === "reply" && outcome.reply.status === "changed") {
      return {
        kind: "not-checked",
        note: `${label}: conflicting reads: confirm said ${confirmSaid}, open read found the stored figure`,
      };
    }
    if (!found.covered) {
      return {
        kind: "not-checked",
        note: `${label}: confirm: not on page, open read of the stored figure has no known conditions`,
      };
    }
    return {
      kind: "read",
      storedCheck: null,
      confirmedBy: "read-again",
      note: `${label}: open question read the stored figure again`,
    };
  }
  if (!found.covered) {
    return {
      kind: "read",
      storedCheck: null,
      confirmedBy: null,
      note: `${label}: open question read ${found.value}, conditions not known`,
    };
  }
  const check = storedCheckOf(outcome, found.value, true);
  const storedCheck = check === "gone" ? "gone" : "unresolved";
  return {
    kind: "read",
    storedCheck,
    confirmedBy: null,
    note:
      storedCheck === "gone"
        ? `${label}: open question read ${found.value}, stored figure not on page, change left to the guard`
        : `${label}: open question read ${found.value}, confirm said ${confirmSaid}, cross-check unresolved, change held`,
  };
}

/** A stored fee of 0 is never confirmed from a quote, so it gets no closed question. */
export const isHeldZeroFee = (field: CatalogField, value: number): boolean =>
  field === "accountFee" && value === 0;

export type ZeroFeeDecision =
  | { kind: "not-checked"; zeroFeeNeedsPerson: true; note: string }
  | { kind: "read"; storedCheck: "gone"; confirmedBy: null; note: string };

/** The open answer for a stored fee of 0, asked once for a non-zero fee. Only a covered fee with a period
 *  goes to the guard, as a change from 0 (the stored 0 is not on the page as held, so the cross-check is
 *  `gone`); the guard parks it in pending until a second weekly read. Anything else needs a person. */
export function decideZeroFee(input: {
  label: string;
  found: { value: number; period?: FeePeriod; covered: boolean } | null;
}): ZeroFeeDecision {
  const { label, found } = input;
  if (!found || found.value === 0 || !found.period || !found.covered) {
    return {
      kind: "not-checked",
      zeroFeeNeedsPerson: true,
      note: `${label}: zero fee needs a person`,
    };
  }
  return {
    kind: "read",
    storedCheck: "gone",
    confirmedBy: null,
    note: `${label}: stored 0, open question read ${found.value} per ${found.period}, change left to the guard`,
  };
}

export type MissingDecision =
  | { kind: "first"; note: string }
  | { kind: "not-checked"; note: string };

/** The open answer for a figure the catalogue does not hold yet. Only a covered answer becomes a
 *  first figure (a fee also needs its period). Silence is never a zero: with no answer the figure
 *  stays unknown and the coverage says no-figure-yet. */
export function decideMissing(input: {
  label: string;
  field: CatalogField;
  found: { value: number; period?: FeePeriod; covered: boolean } | null;
}): MissingDecision {
  const { label, field, found } = input;
  if (!found) {
    return { kind: "not-checked", note: `${label}: no figure on file, open question found none` };
  }
  if (field === "accountFee" && !found.period) {
    return {
      kind: "not-checked",
      note: `${label}: read ${found.value} without a period, not used`,
    };
  }
  if (!found.covered) {
    return {
      kind: "not-checked",
      note: `${label}: read ${found.value}, conditions not known, not used as a first figure`,
    };
  }
  return {
    kind: "first",
    note: `${label}: first figure ${found.value}${found.period ? ` per ${found.period}` : ""} read`,
  };
}

type RecordUrls = {
  docUrl?: string | null;
  pdfUrl?: string | null;
  foundUrl?: string | null;
  termsUrl?: string | null;
};

/** The document-of-record addresses of a product, in the order they are tried. */
export function recordUrls(p: RecordUrls): string[] {
  return [p.docUrl, p.pdfUrl, p.foundUrl, p.termsUrl].filter((u): u is string => !!u);
}

/** The other products that list the same document of record. */
export function siblingsOnRecord(
  id: string,
  url: string,
  products: Readonly<Record<string, RecordUrls & { product: string }>>,
): string[] {
  return Object.entries(products)
    .filter(([otherId, p]) => otherId !== id && recordUrls(p).some((u) => sameDocument(u, url)))
    .map(([, p]) => p.product);
}

const GENERIC_WORDS = new Set([
  "bv",
  "nv",
  "ua",
  "ag",
  "as",
  "uab",
  "sa",
  "gmbh",
  "ltd",
  "limited",
  "plc",
  "inc",
  "llc",
  "sia",
  "ab",
  "bank",
  "nederland",
  "europe",
  "holding",
  "group",
  "coöperatieve",
  "cooperatieve",
]);

/** The issuer as a comparison key: the text before a bracket, a semicolon or a " — " remark, in lower
 *  case, without legal and generic words (bank, n.v., nederland, europe, ...). "ABN AMRO Bank N.V. — Dutch DGS" and "ABN AMRO Bank N.V." are one issuer. */
export function issuerKey(issuer: string | undefined): string {
  const head = (issuer ?? "").split(/\s[—–-]\s|[(;,]/)[0] ?? "";
  return head
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/\./g, ""))
    .filter((w) => w && !GENERIC_WORDS.has(w))
    .join(" ");
}

export type IssuerProduct = { product: string; kind?: string; holds?: readonly string[] };

/** The other catalogue products of the same issuer, whatever their source document. */
export function otherIssuerProducts(
  id: string,
  products: Readonly<Record<string, { product: string; issuer?: string; kind?: string }>>,
  heldBy: (id: string) => readonly string[] = () => [],
): IssuerProduct[] {
  const key = issuerKey(products[id]?.issuer);
  if (!key) return [];
  return Object.entries(products)
    .filter(([otherId, p]) => otherId !== id && issuerKey(p.issuer) === key)
    .map(([otherId, p]) => ({ product: p.product, kind: p.kind, holds: heldBy(otherId) }));
}

/** A first figure has no stored figure to compare with, so its quote must name the product itself
 *  whenever the issuer has another product that can hold the same field. */
export function firstFigureNeedsName(field: ExtraField, others: readonly IssuerProduct[]): boolean {
  return others.some(
    (o) => expectedExtraFieldsFor(o.kind).includes(field) || (o.holds ?? []).includes(field),
  );
}
