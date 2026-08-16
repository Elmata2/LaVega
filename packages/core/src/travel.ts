import type { Account, Tx } from "./model.js";
import type { LearnedFact, FactSource } from "./facts.js";
import { factNumber, factEntry } from "./facts.js";
import { AGENTS } from "./agentFacts.js";
import { analyzeInterest, type RateBenchmark, type InterestSuggestion } from "./interest.js";
import { accountType } from "./balance.js";

/** Travel's slot in the agent namespace (see `agentFacts.ts` for what it may
 *  learn: fxFeePct / convertFeePct / cashbackPct / pointsPerEuro /
 *  transferFreeViaIdeal, keyed by product name). */
export const TRAVEL_AGENT = AGENTS.travel;

/** The reference spend the advice is priced against. A percentage is hard to
 *  act on; "€14 op €1.000" is not. */
export const TRAVEL_REFERENCE_SPEND = 1000;

/** What a card costs in euros on the reference spend — negative when it pays
 *  you (cashback above the surcharge). Null when the terms are unknown. */
export function costOnReferenceSpend(netCostPct: number | null): number | null {
  return netCostPct === null ? null : Math.round(netCostPct * TRAVEL_REFERENCE_SPEND) / 100;
}

/** Destination → the currency you will actually be charged in. Only the
 *  countries worth naming; an unknown country yields null and the plan says so
 *  rather than guessing a currency. Euro countries return EUR, which is what
 *  makes "no conversion needed" a real answer. */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", CH: "CHF", JP: "JPY", SE: "SEK", NO: "NOK", DK: "DKK",
  PL: "PLN", CZ: "CZK", HU: "HUF", TR: "TRY", CA: "CAD", AU: "AUD", NZ: "NZD",
  TH: "THB", ID: "IDR", SG: "SGD", AE: "AED", MA: "MAD", ZA: "ZAR", BR: "BRL",
  MX: "MXN", IN: "INR", CN: "CNY", KR: "KRW",
  NL: "EUR", BE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", PT: "EUR",
  AT: "EUR", IE: "EUR", FI: "EUR", GR: "EUR", LU: "EUR", HR: "EUR", SK: "EUR", SI: "EUR",
};

export function countryCurrency(code: string): string | null {
  return COUNTRY_CURRENCY[String(code ?? "").trim().toUpperCase()] ?? null;
}

/** One PRODUCT ranked for spending abroad — a provider, not an account: terms
 *  belong to the card product, so two accounts at one bank are one row (and one
 *  correction). `netCostPct` is what the trip actually costs you per euro spent:
 *  the conversion surcharge minus what you get back. Lower is better; negative
 *  means the card pays you to use it. */
export type SpendOption = {
  provider: string;
  accounts: Account[];
  fxFeePct: number | null;
  cashbackPct: number | null;
  /** Reward points per euro spent. Shown, never priced — see rankSpendOptions. */
  pointsPerEuro: number | null;
  netCostPct: number | null; // null when the fee is unknown — never assumed free
  known: boolean;
  why: string;
  /** Where the fee figure came from and when, so the owner can judge it. */
  feeSource: FactSource | null;
  feeUpdatedAt: string | null;
  /** The provider's own caveat (weekend surcharge, monthly free limit, …). */
  note: string | null;
};

export type ConvertStep = {
  fromProvider: string | null;
  toProvider: string | null;
  method: string | null; // e.g. "iDEAL"
  note: string;
};

export type TravelPlan = {
  destination: string;
  currency: string | null;
  /** Where the money is best kept — reuses the interest analysis. */
  store: { suggestion: InterestSuggestion | null; best: RateBenchmark | null; note: string };
  convert: ConvertStep;
  /** Every way of paying abroad, priced end to end and cheapest first. This is
   *  the comparison; `convert` and `spend` are the legs it is built from. */
  journeys: Journey[];
  /** The one sentence to lead with, in euros. The backlog's actual requirement
   *  was one recommendation instead of three sections to reconcile. */
  headline: string;
  spend: SpendOption[];
  /** The points-vs-cash trade-off, when the cheapest card earns none and a
   *  dearer one does. Stated as a choice, not resolved — only the owner knows
   *  what his points are worth to him. */
  spendNote: string | null;
  /** Providers we have no terms for yet — what an agent refresh should look up. */
  unknownProviders: string[];
  /** Payment accounts we can't attribute to a bank, so they can't be ranked or
   *  looked up. Reported so the owner can fix them, never silently dropped. */
  unidentifiedCount: number;
};

/** The product a card's terms belong to: the BANK, and only the bank.
 *
 *  Never falls back to the account name or key. Those are the owner's own
 *  labels, and for an account imported without a bank they are literally the
 *  account NUMBER ("A 286-41213") — useless to rank, and an identifier that
 *  would be handed to an agent as if it were a product name. An account we
 *  can't attribute to a bank is reported as unidentified instead. */
export function providerOf(a: Account): string {
  return String(a.bank ?? "").trim();
}

/** The PRODUCT whose terms we rank — the bank plus the kind of card, because
 *  those are different products with different tariffs. Measured on real data:
 *  ING's betaalpas charges 1.4% while ABN AMRO's creditcard charges 2%, and the
 *  agent's own note said ABN's betaalpas is nearer 1%. Ranking on the bank alone
 *  put a debit card against a credit card and crowned the wrong one — which
 *  would hand someone the wrong card abroad, the exact mistake this exists to
 *  prevent. Also reads better: "ING betaalpas", not "ING". */
export function productOf(a: Account): string {
  const bank = providerOf(a);
  if (!bank) return "";
  return `${bank} ${accountType(a) === "Creditcard" ? "creditcard" : "betaalpas"}`;
}

/** How to NAME an account in text shown to the owner. Unlike `providerOf` this
 *  may fall back to his own label (which can be the account number) — that is
 *  fine on his own screen, where Rekeningen already shows it, and it is never
 *  what gets sent to an agent. Keep the two apart: `providerOf` for anything
 *  leaving the device or keying a fact, `accountLabel` for display only. */
export function accountLabel(a: Account): string {
  return String(a.bank || a.name || a.key || "deze rekening").trim();
}

/** Products you could actually pay with abroad: cards and payment accounts at a
 *  known bank. Savings and investment accounts are not payment instruments, and
 *  an account with no bank can't be looked up (see `providerOf`). */
function spendableAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => {
    const t = accountType(a);
    return (t === "Creditcard" || t === "Betaalrekening") && providerOf(a) !== "";
  });
}

/** Rank what to pay with. Known terms sort by net cost (cheapest first); cards
 *  with unknown terms always sort last — an unknown fee is a risk, not a zero,
 *  and silently ranking it first is exactly how you get burned abroad. */
export function rankSpendOptions(accounts: Account[], facts: readonly LearnedFact[]): SpendOption[] {
  // Collapse to one entry per provider: the terms are the product's, so several
  // accounts at one bank must not become several identical rows (correcting one
  // of them would silently move the others anyway).
  const byProvider = new Map<string, Account[]>();
  for (const a of spendableAccounts(accounts)) {
    const p = productOf(a);
    const list = byProvider.get(p);
    if (list) list.push(a);
    else byProvider.set(p, [a]);
  }

  const options = [...byProvider.entries()].map(([provider, group]): SpendOption => {
    const fxFeePct = factNumber(facts, TRAVEL_AGENT, provider, "fxFeePct");
    const cashbackPct = factNumber(facts, TRAVEL_AGENT, provider, "cashbackPct");
    const pointsPerEuro = factNumber(facts, TRAVEL_AGENT, provider, "pointsPerEuro");
    const entry = factEntry(facts, TRAVEL_AGENT, provider, "fxFeePct");
    const known = fxFeePct !== null;
    // Ranking is on HARD CASH only: fee minus cashback. Points are shown but
    // never folded in, because that needs a value per point that nobody can
    // state honestly (a Membership Rewards point is worth anything from ~0.5
    // to ~2 cent depending on how it's redeemed). Inventing one would be the
    // same fake precision the "indicatief" tables were dropped for.
    const netCostPct = known ? fxFeePct - (cashbackPct ?? 0) : null;
    return {
      provider, accounts: group, fxFeePct, cashbackPct, pointsPerEuro, netCostPct, known,
      why: known
        ? `${fxFeePct}% wisselkosten${cashbackPct ? ` − ${cashbackPct}% cashback` : ""}${pointsPerEuro ? ` + ${pointsPerEuro} punt${pointsPerEuro === 1 ? "" : "en"} per euro` : ""}`
        : "voorwaarden nog onbekend",
      feeSource: entry?.source ?? null,
      feeUpdatedAt: entry?.updatedAt ?? null,
      note: entry?.note ?? null,
    };
  });
  return options.sort((a, b) => {
    if (a.netCostPct === null && b.netCostPct === null) return a.provider.localeCompare(b.provider);
    if (a.netCostPct === null) return 1; // unknown always last
    if (b.netCostPct === null) return -1;
    return a.netCostPct - b.netCostPct || a.provider.localeCompare(b.provider);
  });
}

/** Which account to move spending money OUT of, and into which provider, to pay
 *  cheaply abroad. Deliberately conservative: it only ever proposes accounts he
 *  already has, and LaVega never moves anything itself (no PIS) — this is a
 *  step for him to take. */
function planConversion(accounts: Account[], best: SpendOption | null, facts: readonly LearnedFact[]): ConvertStep {
  if (!best || !best.known) {
    return { fromProvider: null, toProvider: null, method: null, note: "Nog geen kaart met bekende voorwaarden — ververs eerst de voorwaarden." };
  }
  // Fund the winning product from the payment account holding the most money —
  // at a DIFFERENT bank, else the advice is "move it to where it already is".
  // Compared on BANK, not product: moving from your ING betaalpas to your ING
  // creditcard is not a conversion route.
  const winningBank = best.accounts[0] ? providerOf(best.accounts[0]) : "";
  const funding = accounts
    .filter((a) => accountType(a) === "Betaalrekening" && providerOf(a) !== "" && providerOf(a) !== winningBank)
    .sort((x, y) => (y.balance ?? 0) - (x.balance ?? 0))[0] ?? null;
  const method = factNumber(facts, TRAVEL_AGENT, best.provider, "transferFreeViaIdeal") === 1 ? "iDEAL" : null;
  if (!funding) {
    return { fromProvider: null, toProvider: best.provider, method, note: `Je betaalt het voordeligst vanaf ${best.provider}.` };
  }
  return {
    fromProvider: providerOf(funding),
    toProvider: best.provider,
    method,
    note: method
      ? `Zet je reisbudget van ${providerOf(funding)} naar ${best.provider} via ${method} — dat is gratis — en betaal daar.`
      : `Zet je reisbudget van ${providerOf(funding)} naar ${best.provider} en betaal daar.`,
  };
}

/** One complete way to get €1.000 from where it sits now into a payment in the
 *  destination currency. Ranking JOURNEYS instead of cards is the whole point:
 *  ranking cards prices only the last leg, so "move it to Revolut first" always
 *  looked free and paying directly always looked expensive. That is not a
 *  comparison, it is two different questions answered side by side. */
export type Journey = {
  /** The product you finally pay with. */
  provider: string;
  /** Where the euros are converted; null means you pay directly and the card
   *  does the conversion for you. */
  via: string | null;
  /** The bank the money leaves, when a move is involved. */
  fundedFrom: string | null;
  method: string | null; // "iDEAL" when the transfer leg is free
  transferPct: number | null;
  convertPct: number | null;
  /** The card leg. Paying direct costs the card's FX surcharge minus cashback;
   *  on a via-route you already hold the currency, so only cashback is left. */
  spendPct: number | null;
  totalCostPct: number | null;
  costOnReference: number | null;
  known: boolean;
  why: string;
};

/** Rank every way of paying abroad, cheapest first, in hard cash only.
 *
 *  Rules carried over from `rankSpendOptions`, because they are why it can be
 *  trusted: an unknown leg makes the WHOLE journey unknown and sorts it last —
 *  never assume a missing fee is zero, that is how someone ends up abroad with
 *  the wrong card. Points stay out of the total for the reason documented
 *  there. And only providers he already holds appear; LaVega proposes no
 *  account he does not have and moves nothing itself. */
export function rankJourneys(
  accounts: Account[],
  facts: readonly LearnedFact[],
  spendOptions?: SpendOption[],
): Journey[] {
  const spend = spendOptions ?? rankSpendOptions(accounts, facts);
  const journeys: Journey[] = [];

  for (const s of spend) {
    // Paying straight from the card: one leg, the one already priced today.
    journeys.push({
      provider: s.provider,
      via: null,
      fundedFrom: null,
      method: null,
      transferPct: null,
      convertPct: null,
      spendPct: s.netCostPct,
      totalCostPct: s.netCostPct,
      costOnReference: costOnReferenceSpend(s.netCostPct),
      known: s.known,
      why: s.known ? `direct betalen: ${s.why}` : "voorwaarden nog onbekend",
    });

    // Moving first only exists as a choice when there is somewhere to move FROM
    // — another bank holding money. Funding a product from its own bank is not
    // a conversion route, it is the same money standing still.
    const bank = s.accounts[0] ? providerOf(s.accounts[0]) : "";
    const funding = accounts
      .filter((a) => accountType(a) === "Betaalrekening" && providerOf(a) !== "" && providerOf(a) !== bank)
      .sort((x, y) => (y.balance ?? 0) - (x.balance ?? 0))[0];
    if (!funding) continue;

    const free = factNumber(facts, TRAVEL_AGENT, s.provider, "transferFreeViaIdeal") === 1;
    const transferPct = free ? 0 : null; // unknown until an agent or the owner says so
    const convertPct = factNumber(facts, TRAVEL_AGENT, s.provider, "convertFeePct");
    // You already hold the currency by the time you pay, so the card's FX
    // surcharge does not apply a second time — only its cashback still does.
    const spendPct = -(s.cashbackPct ?? 0);
    const known = transferPct !== null && convertPct !== null;
    const totalCostPct = known ? transferPct + convertPct + spendPct : null;

    journeys.push({
      provider: s.provider,
      via: s.provider,
      fundedFrom: providerOf(funding),
      method: free ? "iDEAL" : null,
      transferPct,
      convertPct,
      spendPct,
      totalCostPct,
      costOnReference: costOnReferenceSpend(totalCostPct),
      known,
      why: known
        ? `overzetten${free ? " via iDEAL (gratis)" : ""} en daar wisselen: ${convertPct}% wisselkosten${s.cashbackPct ? ` − ${s.cashbackPct}% cashback` : ""}`
        : convertPct === null
          ? "wisselkosten nog onbekend"
          : "overboekkosten nog onbekend",
    });
  }

  return journeys.sort((a, b) => {
    if (a.totalCostPct === null && b.totalCostPct === null) return a.provider.localeCompare(b.provider);
    if (a.totalCostPct === null) return 1;
    if (b.totalCostPct === null) return -1;
    return a.totalCostPct - b.totalCostPct || a.provider.localeCompare(b.provider);
  });
}

/** The one sentence the block leads with. Built from the winning journey and the
 *  runner-up, so the answer carries its own justification in euros: a percentage
 *  is hard to act on, "€14 goedkoper op €1.000" is not. */
export function journeyHeadline(journeys: readonly Journey[], currency: string | null): string {
  if (currency === "EUR") return "Daar betaal je in euro's — omwisselen is niet nodig.";
  const best = journeys.find((j) => j.known);
  if (!best) return "Nog geen route met bekende voorwaarden — ververs eerst de voorwaarden.";

  const runnerUp = journeys.find((j) => j.known && j !== best && j.totalCostPct !== best.totalCostPct);
  const saving =
    runnerUp && runnerUp.costOnReference !== null && best.costOnReference !== null
      ? runnerUp.costOnReference - best.costOnReference
      : null;

  const head =
    best.via === null
      ? `Betaal direct met ${best.provider}.`
      : `Zet je reisbudget van ${best.fundedFrom} naar ${best.via}${best.method ? ` via ${best.method} (gratis)` : ""} en betaal daar.`;
  const cost =
    best.costOnReference === null
      ? ""
      : best.costOnReference === 0
        ? " Dat kost je niets op €1.000."
        : ` Dat kost €${best.costOnReference.toFixed(2)} op €1.000.`;
  const versus = versusNote(saving, runnerUp);
  return `${head}${cost}${versus}`;
}

/** " …€14 goedkoper dan direct met ING." Only when there is a real difference
 *  to name; a saving of zero is not worth a clause. */
function versusNote(saving: number | null, runnerUp: Journey | undefined): string {
  if (saving === null || !runnerUp || saving <= 0) return "";
  return ` Dat is €${saving.toFixed(2)} goedkoper dan ${runnerUp.via === null ? `direct met ${runnerUp.provider}` : `via ${runnerUp.via}`}.`;
}

/** The single combined answer: where to keep it, where to convert it, what to
 *  pay with. Pure — every input is passed in, nothing is fetched or clocked. */
export function planTravel(input: {
  accounts: Account[];
  txs: Tx[];
  rates: readonly RateBenchmark[];
  facts: readonly LearnedFact[];
  destination: string;
  asOf: string;
}): TravelPlan {
  const { accounts, txs, rates, facts, destination, asOf } = input;
  const currency = countryCurrency(destination);

  const interest = analyzeInterest(accounts, txs, rates, asOf);
  const topSuggestion = interest.suggestions[0] ?? null;
  const store = {
    suggestion: topSuggestion,
    best: interest.best,
    note: topSuggestion
      ? `Je laat rente liggen op ${accountLabel(topSuggestion.account)}${interest.best ? ` — ${interest.best.bank} geeft ${interest.best.ratePct}%` : ""}.`
      : "Je spaargeld staat al op de beste plek die we kennen.",
  };

  const spend = rankSpendOptions(accounts, facts);
  const bestSpend = spend.find((s) => s.known) ?? null;

  // Cash is ranked; points are a judgement call. If the cheapest card earns
  // none and a pricier one does, name the difference and let him decide.
  const pointsCard = spend.find((s) => s.known && (s.pointsPerEuro ?? 0) > 0);
  const spendNote =
    bestSpend && pointsCard && pointsCard.provider !== bestSpend.provider && bestSpend.netCostPct !== null && pointsCard.netCostPct !== null
      ? `${pointsCard.provider} kost ${(pointsCard.netCostPct - bestSpend.netCostPct).toFixed(2)}% meer, maar levert ${pointsCard.pointsPerEuro} punt${pointsCard.pointsPerEuro === 1 ? "" : "en"} per euro. Of dat loont hangt af van wat jij met die punten doet.`
      : null;
  const convert: ConvertStep =
    currency === "EUR"
      ? { fromProvider: null, toProvider: null, method: null, note: "Daar betaal je in euro's — omwisselen is niet nodig." }
      : planConversion(accounts, bestSpend, facts);

  // Payment accounts with no bank: countable, but never rankable or lookupable.
  const unidentifiedCount = accounts.filter((a) => {
    const t = accountType(a);
    return (t === "Creditcard" || t === "Betaalrekening") && providerOf(a) === "";
  }).length;

  const journeys = currency === "EUR" ? [] : rankJourneys(accounts, facts, spend);

  return {
    destination,
    currency,
    store,
    convert,
    journeys,
    headline: journeyHeadline(journeys, currency),
    spend,
    spendNote,
    unknownProviders: [...new Set(spend.filter((s) => !s.known).map((s) => s.provider).filter(Boolean))],
    unidentifiedCount,
  };
}
