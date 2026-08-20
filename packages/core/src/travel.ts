import type { Account, Tx } from "./model.js";
import type { LearnedFact, FactSource } from "./facts.js";
import { factNumber, factEntry } from "./facts.js";
import { AGENTS } from "./agentFacts.js";
import { analyzeInterest, type RateBenchmark, type InterestSuggestion } from "./interest.js";
import { accountType } from "./balance.js";
import type { CatalogValue } from "./catalog.js";
import { isCovered } from "./catalog.js";
import { issuerToBank, type CatalogueEntryLike } from "./catalogRates.js";
import { splitProductName, bankNameMatches } from "./bankNl.js";

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
  /** HIS cards, priced for taking out physical cash — a separate and usually
   *  much worse row in every tariff document we read (review item 6). */
  withdraw: WithdrawOption[];
  /** The one sentence about cash, in euros on one € 200 withdrawal. */
  withdrawHeadline: string;
  /** Cards from the CATALOGUE, cheapest surcharge first, each marked `held`.
   *  Answers "what could I switch to" — never "what can I pay with today".
   *  Empty when no catalogue was passed in; nothing is invented. */
  offers: CardOffer[];
  /** THE recommendation: the cheapest way to pay that we can prove, whether or
   *  not he holds it, with what it saves over the best he can already do. Null
   *  when neither side can be priced. */
  pay: PayAdvice | null;
  /** The same for cash: the cheapest PROVEN withdrawal, his own best beside it,
   *  and the cards whose withdrawal price no source states. */
  withdrawAdvice: WithdrawAdvice | null;
};

/** THE ANSWER TO "WHAT SHOULD I PAY WITH", and it is allowed to be a card he
 *  does not own yet.
 *
 *  App review 3, item 2, in his words: "I don't want 'pay today you're paying
 *  with what you have'. Say pay with Revolut, which would save you € 14 on a
 *  thousand compared to ING." So the recommendation is the cheapest thing the
 *  catalogue can PROVE — and because a card he does not carry cannot be tapped
 *  tomorrow morning, `held` and `ownProduct` both travel with it so the screen
 *  can show the difference instead of quietly advising an impossible payment. */
export type PayAdvice = {
  /** The product to pay with — a card of his, or one from the catalogue. */
  product: string;
  /** False means he has to open it first. The UI MUST mark this visibly. */
  held: boolean;
  costOnReference: number | null;
  /** The cheapest thing he can already do, and what that costs. Stays on screen
   *  because he still has to be able to pay for lunch today. */
  ownProduct: string | null;
  ownCostOnReference: number | null;
  /** Euros saved on the reference spend by switching. Null when there is nothing
   *  honest to claim — his own figure unknown, or no real gain. */
  savingOnReference: number | null;
  /** The recommendation's own caveat (a cap, a monthly free limit). */
  note: string | null;
  /** Where a catalogue recommendation was read, and when. Null for his own card,
   *  whose date the `spend` list already carries. */
  sourceUrl: string | null;
  asOf: string | null;
};

/** The cheapest way to pay, comparing HIS COMPLETE ROUTES against the market's
 *  cheapest card surcharge.
 *
 *  Two deliberate asymmetries, both leaning the same way — towards what he
 *  already has:
 *
 *  · his side is priced end to end (move it to Revolut, convert, pay), the
 *    market's side only at the card leg, because for a card he does not hold we
 *    have no idea what funding it would cost. So a market card has to be
 *    cheaper than his best FULL route to win, which is the conservative test.
 *  · a tie goes to the card he already carries. "Open this account to save
 *    nothing" is not advice, and a 0% card cannot beat a 0% route. */
export function bestPayAdvice(
  journeys: readonly Journey[],
  offers: readonly CardOffer[],
): PayAdvice | null {
  // `journeys` is already sorted cheapest-first with unknowns last, so the first
  // known one is the best he can do today.
  const own = journeys.find((j) => j.known && j.costOnReference !== null) ?? null;
  const market = offers.find((o) => !o.held) ?? null;
  const marketCost = market ? costOnReferenceSpend(market.netCostPct) : null;

  if (own && (marketCost === null || own.costOnReference! <= marketCost)) {
    return {
      product: own.provider,
      held: true,
      costOnReference: own.costOnReference,
      ownProduct: own.provider,
      ownCostOnReference: own.costOnReference,
      // Nothing to switch to, so nothing to claim. The runner-up comparison for
      // his OWN options is journeyHeadline's job and it already does it.
      savingOnReference: null,
      note: own.note,
      sourceUrl: null,
      asOf: null,
    };
  }
  if (!market) return null;
  // Measured against the best he can ALREADY do, route included — not against
  // the card he happens to tap. Pricing a switch against the dearer of his own
  // options inflates the gain and can crown a card he does not need.
  const gain = offerSwitchGain(own?.totalCostPct ?? null, offers);
  return {
    product: market.product,
    held: false,
    costOnReference: marketCost,
    ownProduct: own?.provider ?? null,
    ownCostOnReference: own?.costOnReference ?? null,
    savingOnReference: gain ? gain.savingCents / 100 : null,
    note: market.capNote,
    sourceUrl: market.sourceUrl,
    asOf: market.asOf,
  };
}

/** The one sentence the block leads with.
 *
 *  When the winner is one of his, this is `journeyHeadline` unchanged — that
 *  sentence already names the route and what it beats. When the winner is a card
 *  from the catalogue, the sentence says so in the same breath as the euros,
 *  because a recommendation he cannot act on today has to announce that. */
export function payHeadline(
  advice: PayAdvice | null,
  journeys: readonly Journey[],
  currency: string | null,
): string {
  if (currency === "EUR") return "Daar betaal je in euro's — omwisselen is niet nodig.";
  if (!advice || advice.held) return journeyHeadline(journeys, currency);

  const cost =
    advice.costOnReference === null
      ? ""
      : advice.costOnReference === 0
        ? " dat kost je niets op € 1.000"
        : ` ${euro(advice.costOnReference)} op € 1.000`;
  const versus =
    advice.savingOnReference !== null && advice.ownProduct
      ? `, ${euro(advice.savingOnReference)} minder dan met je eigen ${advice.ownProduct}`
      : "";
  return `Betaal met ${advice.product}:${cost}${versus}. Die heb je nog niet — die moet je eerst openen.`;
}

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

/** Can you actually pay with this? Cards and payment accounts at a known bank
 *  qualify; savings and investment accounts are not payment instruments, and an
 *  account with no bank can't be looked up (see `providerOf`).
 *
 *  Exported because `productOf` calls everything that is not a credit card a
 *  "betaalpas": without this predicate a Spaarrekening inherits its bank's card
 *  terms and can be crowned the thing to pay with, which is advice that cannot
 *  be followed in the state it appears in. Anything ranking products by
 *  `productOf` needs the same filter. */
export function isSpendable(a: Account): boolean {
  const t = accountType(a);
  return (t === "Creditcard" || t === "Betaalrekening") && providerOf(a) !== "";
}

/** Products you could actually pay with abroad. */
function spendableAccounts(accounts: Account[]): Account[] {
  return accounts.filter(isSpendable);
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

/** Euros the Dutch way — "€ 5,00", matching what the UI's own formatter prints
 *  next to it. Done by hand rather than with Intl so core stays deterministic
 *  across environments. */
function euro(n: number): string {
  return `€ ${n.toFixed(2).replace(".", ",")}`;
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
  /** The provider's own caveat about the card leg — a monthly free allowance, a
   *  weekend surcharge, a fair-usage cap.
   *
   *  Carried onto the journey because the recommendation is where it matters.
   *  Revolut is the case that proved it: its 0% holds only inside a €1.000
   *  monthly limit, after which it is 1%. LaVega ranked it first on an
   *  unconditional 0% and said "dat kost je niets" — a conditional rate stated
   *  as absolute, which is the most damaging way to be wrong. */
  note: string | null;
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
      note: s.note,
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
      note: s.note,
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
        : ` Dat kost ${euro(best.costOnReference)} op € 1.000.`;
  const versus = versusNote(saving, runnerUp);
  return `${head}${cost}${versus}`;
}

/** " …€14 goedkoper dan direct met ING." Only when there is a real difference
 *  to name; a saving of zero is not worth a clause. */
function versusNote(saving: number | null, runnerUp: Journey | undefined): string {
  if (saving === null || !runnerUp || saving <= 0) return "";
  return ` Dat is ${euro(saving)} goedkoper dan ${runnerUp.via === null ? `direct met ${runnerUp.provider}` : `via ${runnerUp.via}`}.`;
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
  /** The product catalogue, passed in because core does no I/O. Optional: with
   *  no catalogue there are no market offers and no withdrawal prices, and the
   *  plan says so rather than inventing either. */
  catalogue?: readonly CatalogueEntryLike[];
}): TravelPlan {
  const { accounts, txs, rates, facts, destination, asOf } = input;
  const catalogue = input.catalogue ?? [];
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

  // Cash, and the rest of the market. Both read the catalogue that was passed
  // in; with none, both come back empty rather than guessed.
  const withdraw = currency === "EUR" ? [] : rankWithdrawOptions(spend, catalogue);
  // The whole market, priced for cash. His ING betaalpas is 4,9% on € 100 and he
  // is right that it is not the answer; the answer is a proven zero he does not
  // hold yet, and the cards we have NO withdrawal figure for get named rather
  // than dropped (review 3, item 3).
  const cashOffers = currency === "EUR" ? [] : marketWithdrawOptions(catalogue, spend);
  // Only cards he does NOT hold. `marketCardOffers` marks the held ones so this
  // filter is possible at all; dropping them here means the block physically
  // cannot present a card he already carries as something to go and open, nor
  // one he does not carry as something to pay with today.
  const offers =
    currency === "EUR"
      ? []
      : cheapestPerIssuer(marketCardOffers(catalogue, spend).filter((o) => !o.held));
  const pay = currency === "EUR" ? null : bestPayAdvice(journeys, offers);

  return {
    destination,
    currency,
    store,
    convert,
    journeys,
    headline: payHeadline(pay, journeys, currency),
    spend,
    spendNote,
    unknownProviders: [...new Set(spend.filter((s) => !s.known).map((s) => s.provider).filter(Boolean))],
    unidentifiedCount,
    withdraw,
    withdrawHeadline: withdrawalHeadline(withdraw, currency, cashOffers),
    offers,
    pay,
    withdrawAdvice: currency === "EUR" ? null : bestWithdrawAdvice(withdraw, cashOffers),
  };
}

/* ═══════════════════════════════════════════ CASH, AND THE WHOLE MARKET
 *
 * App review, 20 August, items 6/7/8. Three complaints with one cause: the
 * travel agent only ever asked half the question. It priced card PAYMENTS from
 * cards the owner HOLDS, and the catalogue already holds the other halves —
 * every tariff document prices a withdrawal as its own, usually much worse row,
 * and 73 covered surcharges say what the rest of the market charges.
 *
 * Nothing below fetches anything. The catalogue is passed in, as `asOf` is.
 */

/** One ATM visit, as the withdrawal advice is priced. Percentages hide the
 *  thing that actually bites — a flat € 3,50 is 1,75% on € 200 and 7% on € 50 —
 *  so the euros are quoted on a realistic single withdrawal, and the small one
 *  is quoted beside it precisely to show the difference. */
export const TRAVEL_REFERENCE_WITHDRAWAL = 200;
export const TRAVEL_SMALL_WITHDRAWAL = 50;

/** A withdrawal price has TWO SHAPES and a single percentage cannot express it.
 *  ING's betaalpas is "€ 3,50 + 1,40%"; its creditcard is "4,00% van het
 *  opgenomen bedrag met minimum € 4,50 + 2,00% koersopslag" — a percentage with
 *  its own floor, stacked on a second percentage. Collapsing either to one
 *  number understates small withdrawals, which is the case that hurts. So the
 *  price is kept as the components the document states, and the euros are
 *  computed per amount. */
export type WithdrawalComponent =
  | { kind: "pct"; pct: number; minEur: number | null }
  | { kind: "fixed"; eur: number };

export type WithdrawalFee = {
  /** Empty when the price could not be established. Never a zero. */
  components: WithdrawalComponent[];
  known: boolean;
  /** The sentence we read it out of, so he can check us and correct us. Null
   *  when the document said nothing about cash at all. */
  quoted: string | null;
  /** Why there is no price. Names the real cause — "a separate tariff table we
   *  cannot see" and "the document is silent" are different problems with
   *  different fixes. Null when known. */
  why: string | null;
  /** The document prices withdrawal MORE THAN ONCE and the other row carries a
   *  limit or a region. Crypto.com is the case: 0,2% inside the EU, and free up
   *  to € 400 a month then 2% outside it — and a traveller is by definition
   *  outside it. The figure is still the one the document states first, but it
   *  cannot be shown bare, so the caveat travels with it. */
  caveat: string | null;
};

const NOT_KNOWN = (why: string, quoted: string | null): WithdrawalFee =>
  ({ components: [], known: false, quoted, why, caveat: null });

/** Sentences that price CASH rather than a card payment. Deliberately literal:
 *  these are the phrasings the Dutch tariff documents actually use, and the
 *  catalogue's own conditions text is the corpus. */
const WITHDRAWAL_TERM =
  /geldopname|geldopnem|geld opnemen|geldopnames|opname van contant|contant geld opnem|contante opname|opgenomen bedrag|opname van geld|geldautomaat|cash withdraw|withdrawal|\bATM\b/i;

/** A row whose price depends on something the document does not resolve into
 *  one figure: a free allowance, a tier, a cap, or a branch ("uit positief
 *  saldo, anders 4%"). Refused rather than flattened — a rate that holds only
 *  inside a monthly limit, served as absolute, is the most damaging way to be
 *  wrong, and the Revolut 0% incident is the proof. */
const WITHDRAWAL_CONDITIONAL =
  /gratis|\bfree\b|vrijstelling|staffel|tariefklassen|\banders\b|positief saldo|maximum|maximaal|max\.|per maand|per kalendermaand|per calendar month|monthly|per week|weekly|\bboven\b|\bonder\b|\babove\b|\bbelow\b|eerste \d|first \d|fair.?us|limiet|\blimit\b|afhankelijk van|in plaats van/i;

/** The document points at a rule it does not quote — "artikel 13.3", "een
 *  aparte regel met eigen tariefklassen". There is a price; we simply do not
 *  have it, and saying so is the only honest answer. */
/** A withdrawal priced at nothing, said in words. Dutch and English, because the
 *  catalogue holds both. */
const WITHDRAWAL_FREE = /\b(?:gratis|kosteloos|geen kosten|zonder kosten|free of charge|free|no fee|fee-free)\b/i;

/** ...and the allowance that makes "free" conditional. Five withdrawals a month,
 *  EUR 200 a month, the first EUR 100 — every one of these means the price
 *  depends on how much he takes out, so the row cannot be read as simply free. */
const WITHDRAWAL_ALLOWANCE =
  /\b(?:tot|boven|daarna|thereafter|after the first|up to|per maand|per month|per kalenderjaar|per calendar|first \d|\d+\s*(?:free\s*)?(?:withdrawals?|opnames?))\b/i;

const WITHDRAWAL_CROSSREF = /artikel\s*\d|aparte regel|aparte post|aparte kosten in rekening/i;

const PCT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;
const EUR_RE = /€\s*(\d+(?:[.,]\d+)?)/g;

/** These documents mix Dutch and English number formats in the same field —
 *  "€ 1.000" is a thousand and "1.7%" is one and seven tenths. Stripping every
 *  period read N26's 1.7% as 17% and priced a € 200 withdrawal at € 68, which
 *  is the kind of wrong that discredits the whole screen. So a period is a
 *  thousands separator only where it is followed by exactly three digits; a
 *  comma is always the decimal. */
const num = (s: string): number =>
  Number(s.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));

/** Split conditions into the sentences a human would read them as. Sentence
 *  ends and semicolons both separate rows in these documents; "artikel 12.3"
 *  and "€ 1.000" survive because neither has whitespace after the dot. */
function sentences(text: string): string[] {
  return text
    .split(/(?:\.\s+|;\s*|\n+)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** What ONE tariff row says a cash withdrawal costs.
 *
 *  Walks the withdrawal sentences in document order and stops at the first one
 *  that contains a figure — that sentence is the row being priced, and any
 *  later mention is commentary. A sentence with a figure it cannot reduce is a
 *  refusal, not a reason to keep looking for a friendlier one: choosing the
 *  sentence that happens to parse is how you end up quoting an allowance as a
 *  price. */
export function parseWithdrawalFee(conditions: string | null | undefined): WithdrawalFee {
  const text = String(conditions ?? "").trim();
  if (!text) return NOT_KNOWN("De bron zegt niets over geld opnemen.", null);

  const all = sentences(text);
  const rows = all.filter((s) => WITHDRAWAL_TERM.test(s));
  if (rows.length === 0) return NOT_KNOWN("De bron zegt niets over geld opnemen.", null);

  for (const row of rows) {
    const hasFigure = /\d/.test(row) && (row.includes("%") || row.includes("€"));
    if (!hasFigure) continue;
    if (WITHDRAWAL_CROSSREF.test(row)) {
      return NOT_KNOWN("De bron verwijst voor opnemen naar een aparte regel of artikel en noemt het tarief daar niet.", row);
    }
    // "Cash withdrawal in a foreign currency is NOT free on this plan" states a
    // price; the bare word would have refused it. Only the negation is removed
    // — everything else the sentence says still has to pass.
    const claim = row.replace(/\b(?:not|niet)\s+(?:free|gratis)\b/gi, "");
    if (WITHDRAWAL_CONDITIONAL.test(claim)) {
      return NOT_KNOWN("Het opnametarief hangt aan een vrijstelling, staffel of voorwaarde die de bron niet in één bedrag uitdrukt.", row);
    }
    const components = componentsOf(row);
    if (components.length === 0) continue;
    // Does the same document price withdrawal differently somewhere else? Keep
    // the figure, but never let it be shown as the only price there is. Every
    // OTHER priced sentence counts, not only the ones that name cash:
    // Crypto.com's withdrawal row reads "purchases and ATM transactions within
    // the EU & UK 0.2%" and the clause that tiers it — "outside the EU & UK no
    // fee up to EUR 400 per calendar month, 2.0% thereafter" — never says "ATM"
    // again, so a cash-only scan misses the one limit a traveller is guaranteed
    // to hit.
    const others = all.filter((r) => r !== row && /\d/.test(r) && (r.includes("%") || r.includes("€")));
    const conflicting = others.some((r) => WITHDRAWAL_CONDITIONAL.test(r));
    return {
      components,
      known: true,
      quoted: row,
      why: null,
      caveat: conflicting
        ? "Dit document prijst opnemen ook nog anders — met een vrije ruimte, een limiet of per regio. Lees de voorwaarden voordat je erop rekent."
        : null,
    };
  }

  // A STATED FREE WITHDRAWAL IS A KNOWN PRICE, NOT A MISSING ONE. N26 Go and
  // Metal say foreign-currency ATM withdrawals are free, in words, and the search
  // above looks for a numeral — so both fell through to "the source mentions
  // withdrawing but names no rate" and dropped out of a ranking they would have
  // won. Same mistake as reading a cashback of "No fee" as unknown: a percentage
  // test is the wrong instrument for a stated absence.
  //
  // GUARDED, because free-with-a-cap is the common shape and is NOT free: Zeal
  // allows five withdrawals or EUR 200 a month and charges after, Crypto.com has a
  // monthly free limit, Bybit's first EUR 100 is free. If the same row carries an
  // allowance, the price depends on how much he takes out and this stays unknown
  // rather than becoming a zero he would rely on.
  const freeRow = rows.find((r) => WITHDRAWAL_FREE.test(r) && !WITHDRAWAL_ALLOWANCE.test(r));
  if (freeRow) {
    return { components: [], known: true, quoted: freeRow, why: null, caveat: null };
  }

  // Cash IS mentioned, but never with a price on it.
  const named = rows.find((r) => WITHDRAWAL_CROSSREF.test(r));
  return named
    ? NOT_KNOWN("De bron verwijst voor opnemen naar een aparte regel of artikel en noemt het tarief daar niet.", named)
    : NOT_KNOWN("De bron noemt opnemen wel, maar zonder tarief.", rows[0]);
}

/** Read the row's figures in the order they are written. A euro amount counts
 *  as a per-withdrawal fee UNLESS the words just before it make it a floor on
 *  the percentage it follows ("4,00% ... met minimum € 4,50"), which is a
 *  different price at every amount. */
function componentsOf(row: string): WithdrawalComponent[] {
  type Hit = { at: number; comp: WithdrawalComponent; minimumFor?: true };
  const hits: Hit[] = [];

  PCT_RE.lastIndex = 0;
  for (let m = PCT_RE.exec(row); m; m = PCT_RE.exec(row)) {
    hits.push({ at: m.index, comp: { kind: "pct", pct: num(m[1]), minEur: null } });
  }
  EUR_RE.lastIndex = 0;
  for (let m = EUR_RE.exec(row); m; m = EUR_RE.exec(row)) {
    const before = row.slice(Math.max(0, m.index - 24), m.index);
    const isFloor = /minimum|minimaal|ten minste|\bmin\.\s*$/i.test(before);
    hits.push({ at: m.index, comp: { kind: "fixed", eur: num(m[1]) }, ...(isFloor ? { minimumFor: true as const } : {}) });
  }
  hits.sort((a, b) => a.at - b.at);

  const out: WithdrawalComponent[] = [];
  /** The same figure written twice in one sentence is ONE price quoted twice,
   *  not two charges. The catalogue's conditions are written as notes that name
   *  a figure and then quote the table row it came from — N26 does exactly that
   *  ("withdrawals cost 1.7% ... 'N26 Smart 1.7% of amount drawn'"), and adding
   *  them made a 1,7% withdrawal read as 3,4%. Genuinely stacked charges differ
   *  from each other (ING's "4% ... + 2% koersopslag"), so they survive this. */
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.minimumFor) {
      // Attach to the percentage it qualifies. With no percentage before it the
      // word "minimum" has nothing to floor, so it is a flat fee after all.
      const last = out[out.length - 1];
      if (last && last.kind === "pct" && last.minEur === null && h.comp.kind === "fixed") {
        last.minEur = h.comp.eur;
        continue;
      }
    }
    const fingerprint = h.comp.kind === "fixed" ? `f${h.comp.eur}` : `p${h.comp.pct}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(h.comp);
  }
  return out;
}

/** Euros for one withdrawal of `amount`. Null is UNKNOWN and must never be
 *  rendered as free. */
export function withdrawalCost(fee: WithdrawalFee, amount: number): number | null {
  if (!fee.known) return null;
  // KNOWN WITH NO COMPONENTS IS FREE, not unknown. `known` used to imply at least
  // one priced component, so the two conditions were interchangeable; since a
  // stated "gratis"/"free" now sets known with nothing to add up, they are not.
  // Reading it as unknown kept N26 Go and Metal out of a withdrawal ranking they
  // win outright.
  if (fee.components.length === 0) return 0;
  let total = 0;
  for (const c of fee.components) {
    total += c.kind === "fixed" ? c.eur : Math.max((c.pct * amount) / 100, c.minEur ?? 0);
  }
  return Math.round(total * 100) / 100;
}

/** What that costs as a percentage of the withdrawal — the number that shows a
 *  flat fee for what it is. */
export function withdrawalEffectivePct(fee: WithdrawalFee, amount: number): number | null {
  const cost = withdrawalCost(fee, amount);
  if (cost === null || amount <= 0) return null;
  return Math.round((cost / amount) * 10_000) / 100;
}

/** The price in words, in Dutch, as the document states it. */
export function describeWithdrawalFee(fee: WithdrawalFee): string {
  if (!fee.known) return fee.why ?? "onbekend";
  return fee.components
    .map((c) =>
      c.kind === "fixed"
        ? `${euro(c.eur)} per opname`
        : c.minEur === null
          ? `${pctNL(c.pct)} over het opgenomen bedrag`
          : `${pctNL(c.pct)} over het opgenomen bedrag, minimaal ${euro(c.minEur)}`,
    )
    .join(" + ");
}

/* ---------- matching a card he holds to the product in the catalogue ---------- */

/** Covered only. An uncovered figure is one whose conditions were never
 *  settled, and the catalogue exists so those never reach a comparison. */
function coveredField(e: CatalogueEntryLike, field: string): CatalogValue | null {
  const v = e.fields?.[field];
  return isCovered(v) && v ? v : null;
}

/** Does this catalogue row belong to the bank he typed?
 *
 *  TWO ways in, and the second one is not a nicety. The catalogue keys a row by
 *  its LEGAL ISSUER while he types the brand, and for cards those differ more
 *  often than not: ING's own creditcard is issued by "International Card
 *  Services (ICS)", so an issuer-only match found ING's debit card and missed
 *  both of its credit cards — the identical mismatch the review reports for the
 *  savings table (items 1 and 5). The product NAME is the way through, because
 *  the catalogue writes it the way he would say it: "ING Platinumcard". */
function entryIsFromBank(e: CatalogueEntryLike, bank: string): boolean {
  if (e.issuer && bankNameMatches(issuerToBank(e.issuer), bank)) return true;
  return bankNameMatches(e.product, bank);
}

/** Catalogue products that could be the card he holds: same kind of card, same
 *  bank. `bankNameMatches` does the work because `account.bank` is free text he
 *  types himself — "ABN" and "ABN AMRO Bank N.V." are the same bank. */
export function catalogueCandidates(entries: readonly CatalogueEntryLike[], product: string): CatalogueEntryLike[] {
  const want = splitProductName(product);
  if (!want) return [];
  return entries.filter((e) => e.kind === want.card && entryIsFromBank(e, want.bank));
}

/** The ONE catalogue product behind a card he holds, or the reason we cannot
 *  tell. ING sells a creditcard and a PlatinumCard; both are "ING creditcard"
 *  to LaVega, and they charge differently. The surcharge we ALREADY know for
 *  his card is what separates them — which is the whole theme of this review:
 *  the data is here, it was simply never wired together. Where it still cannot
 *  be narrowed the answer is to ask, not to average. */
export function catalogueProductFor(
  entries: readonly CatalogueEntryLike[],
  product: string,
  fxFeePct: number | null,
): { entry: CatalogueEntryLike | null; ambiguous: CatalogueEntryLike[] } {
  const all = catalogueCandidates(entries, product);
  if (all.length <= 1) return { entry: all[0] ?? null, ambiguous: [] };
  if (fxFeePct !== null) {
    const narrowed = all.filter((e) => {
      const v = coveredField(e, "fxFeePct");
      return v !== null && Math.abs(v.value - fxFeePct) < 0.005;
    });
    if (narrowed.length === 1) return { entry: narrowed[0], ambiguous: [] };
    if (narrowed.length > 1) return { entry: null, ambiguous: narrowed };
  }
  return { entry: null, ambiguous: all };
}

/** Name a few and count the rest. American Express alone has thirteen cards in
 *  the catalogue; printing all thirteen inside a sentence is a wall, not an
 *  answer, and the sentence is asking him a question. */
function nameSome(names: readonly string[], limit = 3): string {
  if (names.length > limit) return `${names.slice(0, limit).join(", ")} en ${names.length - limit} andere`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`;
}

/** One of HIS cards, priced for cash. */
export type WithdrawOption = {
  /** The product name as the rest of the block names it — "ING betaalpas". */
  provider: string;
  fee: WithdrawalFee;
  /** Euros on one € 200 withdrawal, and what that is as a percentage. */
  costOnReference: number | null;
  effectivePct: number | null;
  /** The same on € 50, because that is where a flat fee shows its teeth. */
  costOnSmall: number | null;
  smallEffectivePct: number | null;
  /** True when a flat fee or a floor makes small withdrawals disproportionately
   *  expensive — the one piece of advice this whole section exists to give. */
  penalisesSmall: boolean;
  /** The catalogue product it was read from, so the figure is checkable. */
  catalogueProduct: string | null;
  sourceUrl: string | null;
  asOf: string | null;
};

/** Rank HIS cards for taking out cash. Same rules as every other ranking here:
 *  cheapest first on the reference withdrawal, unknown always last, and an
 *  unknown is never a zero. */
export function rankWithdrawOptions(
  spend: readonly SpendOption[],
  entries: readonly CatalogueEntryLike[],
): WithdrawOption[] {
  const options = spend.map((s): WithdrawOption => {
    const { entry, ambiguous } = catalogueProductFor(entries, s.provider, s.fxFeePct);
    const value = entry ? coveredField(entry, "fxFeePct") : null;
    const fee: WithdrawalFee =
      ambiguous.length > 1
        ? NOT_KNOWN(
            `De catalogus kent meer dan één ${s.provider} (${nameSome(ambiguous.map((e) => e.product))}) en die rekenen niet hetzelfde. Zeg welke je hebt, of vul de wisselkosten in — dan weten we het.`,
            null,
          )
        : entry === null
          ? NOT_KNOWN("Dit product staat nog niet in de catalogus, dus we weten niet wat opnemen kost.", null)
          : parseWithdrawalFee(value?.conditions ?? null);
    return {
      provider: s.provider,
      fee,
      costOnReference: withdrawalCost(fee, TRAVEL_REFERENCE_WITHDRAWAL),
      effectivePct: withdrawalEffectivePct(fee, TRAVEL_REFERENCE_WITHDRAWAL),
      costOnSmall: withdrawalCost(fee, TRAVEL_SMALL_WITHDRAWAL),
      smallEffectivePct: withdrawalEffectivePct(fee, TRAVEL_SMALL_WITHDRAWAL),
      penalisesSmall: fee.known && fee.components.some((c) => c.kind === "fixed" || c.minEur !== null),
      catalogueProduct: entry?.product ?? null,
      sourceUrl: value?.sourceUrl ?? null,
      asOf: value?.checkedAt ?? null,
    };
  });
  return options.sort((a, b) => {
    if (a.costOnReference === null && b.costOnReference === null) return a.provider.localeCompare(b.provider);
    if (a.costOnReference === null) return 1;
    if (b.costOnReference === null) return -1;
    return a.costOnReference - b.costOnReference || a.provider.localeCompare(b.provider);
  });
}

/* ---------- what the rest of the market charges ---------- */

/** A card from the catalogue, whether or not he holds it. `held` is the field
 *  that keeps the two questions apart on screen: "what should I pay with today"
 *  may only ever be answered with a card he has. */
export type CardOffer = {
  productId: string;
  product: string;
  bank: string;
  kind: string;
  fxFeePct: number;
  /** The ranking, and it is the surcharge ALONE — see `cashbackNote`. */
  netCostPct: number;
  cashbackPct: number | null;
  /** Why the cashback is shown and not subtracted. Every cashback figure in the
   *  catalogue today is paid in a token (CRO, GNO, WXT) and gated behind a
   *  stake or a subscription, so folding it into euros would be the same fake
   *  precision that keeps reward points out of the ranking. Null when the
   *  figure carries no such gate. */
  cashbackNote: string | null;
  /** What one € 200 withdrawal costs on this card, when its document says. */
  withdrawal: WithdrawalFee;
  withdrawalOnReference: number | null;
  /** The surcharge holds only inside a cap, a tier or a monthly allowance. Such
   *  a figure NEVER outranks an unconditional one at the same value — ING's
   *  PlatinumCard is 0% up to € 1.000 a month and 2% above it, and putting that
   *  above a card that is simply 0% would repeat the Revolut mistake: a
   *  conditional rate presented as absolute. */
  conditional: boolean;
  /** That condition in one Dutch line, from the source's own words. */
  capNote: string | null;
  conditions: string | null;
  sourceUrl: string;
  asOf: string;
  held: boolean;
};

/** The catalogue's own words, reduced to the caveats that decide whether a
 *  cashback figure is money. Each clause is only claimed when the source text
 *  says it — this reads the conditions, it does not guess at them. */
export function cashbackCaveat(conditions: string | null | undefined): string | null {
  const c = String(conditions ?? "");
  if (!c) return null;
  const parts: string[] = [];
  if (/paid in cro|paid in gno|paid in crypto|in CRO\b|in GNO\b|Cryptoback|not euro|niet in euro/i.test(c)) {
    parts.push("wordt in crypto uitbetaald, niet in euro's");
  }
  if (/staking|stake|WXT locked|GNO in|tier gate|subscription|abonnement/i.test(c)) {
    parts.push("vereist een abonnement of vastgezette tokens");
  }
  if (/\bcap\b|cap:|cap of|spending cap|weekly spend|per month|per calendar month|maandlimiet/i.test(c)) {
    parts.push("geldt tot een maand- of weeklimiet");
  }
  if (/active until|until \d|temporary|tijdelijk|promo/i.test(c)) {
    parts.push("is een tijdelijke actie");
  }
  return parts.length === 0 ? null : `Deze cashback ${parts.join(", ")}.`;
}

/** The card kinds you can actually pay with. Savings and investment accounts
 *  carry a rate, not a surcharge, and have no business in this comparison. */
const SPENDABLE_KINDS = new Set(["betaalpas", "creditcard", "prepaid", "crypto"]);

/** Every covered card surcharge in the catalogue, cheapest first, each marked
 *  with whether he already holds it.
 *
 *  This is the answer to "it shows Revolut for the US, but Trading 212 is
 *  cheaper" (review item 8). The travel agent was right about his own cards and
 *  blind to everything else: `rankSpendOptions` iterates his accounts, so a
 *  card he does not hold could not appear however cheap. Both questions matter
 *  and they are not the same question, so both are answered — separately. */
/** His products, WITH the surcharge we already know for each. The fee is what
 *  tells his ING creditcard from an ING PlatinumCard: without it every ING
 *  credit card counts as possibly-his and the PlatinumCard's 0% — a real
 *  recommendation for an ING customer — is hidden by caution. */
export type HeldProduct = { provider: string; fxFeePct: number | null };

/** Catalogue rows that might be one of his. Shared by every market ranking, so
 *  "what could I open" means the same thing for a payment and for cash. */
function heldCatalogueIds(
  entries: readonly CatalogueEntryLike[],
  heldProducts: readonly HeldProduct[],
): Set<string> {
  const held = new Set<string>();
  for (const p of heldProducts) {
    const { entry, ambiguous } = catalogueProductFor(entries, p.provider, p.fxFeePct);
    if (entry) {
      held.add(entry.id);
      continue;
    }
    // Nothing to narrow with: every candidate might be his, and the
    // conservative reading is the right one — never offer a card he may already
    // carry as something to go and open.
    for (const e of ambiguous) held.add(e.id);
  }
  return held;
}

export function marketCardOffers(
  entries: readonly CatalogueEntryLike[],
  heldProducts: readonly HeldProduct[],
): CardOffer[] {
  const held = heldCatalogueIds(entries, heldProducts);

  const offers: CardOffer[] = [];
  for (const e of entries) {
    if (!SPENDABLE_KINDS.has(String(e.kind ?? ""))) continue;
    const fx = coveredField(e, "fxFeePct");
    if (!fx) continue;
    const cashback = coveredField(e, "cashbackPct");
    const withdrawal = parseWithdrawalFee(fx.conditions);
    offers.push({
      productId: e.id,
      product: e.product,
      bank: e.issuer ? issuerToBank(e.issuer) : "",
      kind: String(e.kind ?? ""),
      fxFeePct: fx.value,
      netCostPct: fx.value,
      cashbackPct: cashback?.value ?? null,
      cashbackNote: cashback ? cashbackCaveat(cashback.conditions) : null,
      withdrawal,
      withdrawalOnReference: withdrawalCost(withdrawal, TRAVEL_REFERENCE_WITHDRAWAL),
      conditional: FX_CONDITIONAL.test(fx.conditions ?? ""),
      capNote: fxCaveat(fx.conditions),
      conditions: fx.conditions,
      sourceUrl: fx.sourceUrl,
      asOf: fx.checkedAt,
      held: held.has(e.id),
    });
  }
  // Cheapest first. Dan, bij dezelfde prijs, in deze orde:
  //
  //  1. HET GOEDKOOPSTE ZONDER VOORWAARDEN. Een 0% die op € 1.000 per maand
  //     afloopt is geen 0% voor wie meer besteedt.
  //  2. EEN KAART DIE HIJ AL HEEFT. Zijn beslissing van 20 augustus, en het is de
  //     juiste: op de echte catalogus staan Trade Republic, 212 Card, N26 Standard
  //     en ING Platinum allemaal op 0%, en dan iemand naar een nieuwe kaart sturen
  //     voor exact hetzelfde tarief is advies dat niets oplevert en werk kost.
  //     Alleen als een ANDERE kaart echt goedkoper is, is overstappen het waard.
  //  3. Daarna de catalogusvolgorde, zodat de lijst niet herschikt tussen renders.
  return offers.sort(
    (a, b) =>
      a.netCostPct - b.netCostPct ||
      Number(a.conditional) - Number(b.conditional) ||
      Number(b.held) - Number(a.held),
  );
}

/** A surcharge that only holds inside a limit. The vocabulary is the
 *  catalogue's own: "tot € 1.000 per maandelijkse incassoperiode", "buiten de
 *  maandelijkse vrije ruimte", "fair usage", "above the monthly free limit". */
const FX_CONDITIONAL =
  /tot\s*€|boven\s*€|daarna|per maand|per kalender|maandelijk|vrije ruimte|fair.?us|limiet|limit|cap|above|allowance|monthly|per calendar/i;

/** The condition in one line, so a capped rate can never be shown bare. */
export function fxCaveat(conditions: string | null | undefined): string | null {
  const c = String(conditions ?? "");
  if (!c || !FX_CONDITIONAL.test(c)) return null;
  const cap = c.match(/tot\s*€\s*[\d.,]+[^.;]*|above the monthly[^.;]*|buiten de maandelijkse[^.;]*/i);
  return cap
    ? `Dit tarief geldt maar tot een grens: ${cap[0].trim()}.`
    : "Dit tarief geldt maar binnen een limiet of pakket — lees de voorwaarden voordat je overstapt.";
}

/** What a switch would actually save on the reference spend, or null when there
 *  is nothing honest to claim: his own figure unknown, or the market's best no
 *  better than what he already carries. A zero-euro "saving" is noise. */
export function offerSwitchGain(
  heldPct: number | null,
  offers: readonly CardOffer[],
): { best: CardOffer; savingCents: number } | null {
  if (heldPct === null) return null;
  const best = offers.find((o) => !o.held);
  if (!best) return null;
  const delta = heldPct - best.netCostPct;
  if (delta <= 0) return null;
  const savingCents = Math.round((TRAVEL_REFERENCE_SPEND * 100 * delta) / 100);
  return savingCents > 0 ? { best, savingCents } : null;
}

/* ---------- cash, across the whole market ---------- */

/** One catalogue product priced for CASH, whether or not he holds it.
 *
 *  Only rows whose withdrawal price the source actually STATES get in. An
 *  unproven price is not an offer — and the ones left out are reported by name
 *  through `WithdrawAdvice.unpricedOwn`, because a figure nobody mentions reads
 *  as "there is no charge". */
export type CashOffer = {
  productId: string;
  product: string;
  bank: string;
  fee: WithdrawalFee;
  costOnReference: number | null;
  effectivePct: number | null;
  sourceUrl: string;
  asOf: string;
  held: boolean;
};

/** Rank the catalogue on what one € 200 withdrawal costs, cheapest first.
 *
 *  This is review 3 item 3, and he is half right in a way worth keeping on
 *  screen: his ING betaalpas costs 4,9% on € 100 (€ 3,50 flat is most of it), so
 *  ING is indeed not the answer — but the answer we can PROVE is N26 Go or N26
 *  Metal at 0%, not Revolut, whose fee page prices no withdrawal at all. */
export function marketWithdrawOptions(
  entries: readonly CatalogueEntryLike[],
  heldProducts: readonly HeldProduct[],
): CashOffer[] {
  const held = heldCatalogueIds(entries, heldProducts);
  const out: CashOffer[] = [];
  for (const e of entries) {
    if (!SPENDABLE_KINDS.has(String(e.kind ?? ""))) continue;
    // The withdrawal price lives inside the surcharge row's conditions, so an
    // uncovered surcharge means an unread document — same gate as the payment
    // ranking, for the same reason.
    const fx = coveredField(e, "fxFeePct");
    if (!fx) continue;
    const fee = parseWithdrawalFee(fx.conditions);
    const costOnReference = withdrawalCost(fee, TRAVEL_REFERENCE_WITHDRAWAL);
    if (!fee.known || costOnReference === null) continue;
    out.push({
      productId: e.id,
      product: e.product,
      bank: e.issuer ? issuerToBank(e.issuer) : "",
      fee,
      costOnReference,
      effectivePct: withdrawalEffectivePct(fee, TRAVEL_REFERENCE_WITHDRAWAL),
      sourceUrl: fx.sourceUrl,
      asOf: fx.checkedAt,
      held: held.has(e.id),
    });
  }
  // Cheapest first; at the same price the row with no second, conditional
  // withdrawal clause wins, and ties beyond that keep catalogue order.
  return out.sort(
    (a, b) => a.costOnReference! - b.costOnReference! || Number(a.fee.caveat !== null) - Number(b.fee.caveat !== null),
  );
}

/** THE ANSWER TO "WHICH CARD DO I PULL CASH OUT WITH". Same shape and the same
 *  rules as `PayAdvice`: a tie goes to the card he already carries, and the
 *  cards we cannot price are named rather than left out. */
export type WithdrawAdvice = {
  product: string;
  held: boolean;
  costOnReference: number | null;
  effectivePct: number | null;
  /** His own cheapest PROVEN card, for the comparison. */
  ownProduct: string | null;
  ownCostOnReference: number | null;
  savingOnReference: number | null;
  /** HIS cards whose withdrawal price no source states. He believes Revolut wins
   *  here; we cannot prove it either way, and silence would read as agreement. */
  unpricedOwn: string[];
  caveat: string | null;
  sourceUrl: string | null;
  asOf: string | null;
};

export function bestWithdrawAdvice(
  own: readonly WithdrawOption[],
  market: readonly CashOffer[],
): WithdrawAdvice | null {
  const ownBest = own.find((o) => o.fee.known && o.costOnReference !== null) ?? null;
  const marketBest = market.find((o) => !o.held) ?? null;
  const unpricedOwn = own.filter((o) => !o.fee.known).map((o) => o.provider);
  if (!ownBest && !marketBest) return null;

  if (ownBest && (!marketBest || ownBest.costOnReference! <= marketBest.costOnReference!)) {
    return {
      product: ownBest.provider,
      held: true,
      costOnReference: ownBest.costOnReference,
      effectivePct: ownBest.effectivePct,
      ownProduct: ownBest.provider,
      ownCostOnReference: ownBest.costOnReference,
      savingOnReference: null,
      unpricedOwn,
      caveat: ownBest.fee.caveat,
      sourceUrl: ownBest.sourceUrl,
      asOf: ownBest.asOf,
    };
  }
  const best = marketBest!;
  const saving =
    ownBest && ownBest.costOnReference! > best.costOnReference!
      ? Math.round((ownBest.costOnReference! - best.costOnReference!) * 100) / 100
      : null;
  return {
    product: best.product,
    held: false,
    costOnReference: best.costOnReference,
    effectivePct: best.effectivePct,
    ownProduct: ownBest?.provider ?? null,
    ownCostOnReference: ownBest?.costOnReference ?? null,
    savingOnReference: saving,
    unpricedOwn,
    caveat: best.fee.caveat,
    sourceUrl: best.sourceUrl,
    asOf: best.asOf,
  };
}

/** The one sentence about cash. Leads with the card and the euros, and names
 *  the small-withdrawal penalty when there is one — that penalty IS the advice:
 *  a flat € 3,50 is 1,75% on € 200 and 7% on € 50, so "pin minder vaak, meer
 *  per keer" is worth more than any card choice on this screen. */
export function withdrawalHeadline(
  options: readonly WithdrawOption[],
  currency: string | null,
  /** The rest of the market, priced for cash. With none, this is the same
   *  sentence about his own cards it always was. */
  market: readonly CashOffer[] = [],
): string {
  // Every figure these tariffs state is a FOREIGN-currency withdrawal charge.
  // In euroland they simply do not apply, and quoting € 6,30 for a € 200
  // withdrawal in Spain would be advice that cannot be right where it appears.
  if (currency === "EUR") {
    return "Daar pin je in euro's, dus de opslagen voor vreemde valuta gelden niet. Wat je eigen bank in euroland voor een opname rekent, staat niet in onze bronnen.";
  }
  if (options.length === 0 && market.length === 0) return "Nog geen kaart of betaalrekening om mee te pinnen.";

  const advice = bestWithdrawAdvice(options, market);
  if (!advice) {
    return `Van geen enkele kaart weten we wat geld pinnen in het buitenland kost — dat is een aparte prijs, meestal hoger dan betalen.${missingCashNote(options)}`;
  }

  // "€ 0,00 voor € 200,00 (0%)" says the same thing twice; the percentage only
  // earns its place where it reveals something the euros hide.
  const price = `${euro(advice.costOnReference!)} voor ${euro(TRAVEL_REFERENCE_WITHDRAWAL)}${advice.effectivePct === null || advice.effectivePct === 0 ? "" : ` (${pctNL(advice.effectivePct)})`}`;

  // The flat-fee warning is about HIS card and stays on screen whoever wins the
  // ranking: "pin less often, more per time" is worth more than any card choice
  // here, and it would be lost if it only ever hung off the winner.
  const ownBest = options.find((o) => o.fee.known && o.costOnReference !== null) ?? null;
  const small =
    ownBest && ownBest.penalisesSmall && ownBest.smallEffectivePct !== null
      ? ` Er zit bij ${ownBest.provider} een vast bedrag per opname bij, dus ${euro(TRAVEL_SMALL_WITHDRAWAL)} pinnen kost je ${pctNL(ownBest.smallEffectivePct)} — neem in één keer meer op.`
      : "";

  if (advice.held) {
    return `Het voordeligst pin je met ${advice.product}: ${price}.${small}${missingCashNote(options)}`;
  }
  // The cheapest PROVEN withdrawal is a card he does not carry. Say that in the
  // same breath as the euros, and keep what he CAN pin with on screen — the
  // point of the sentence is the difference between the two.
  const own =
    advice.ownProduct === null
      ? " Van je eigen kaarten kennen we geen opnametarief."
      // The "X duurder" clause only earns its place when it is a DIFFERENT number
      // from the one just quoted; against a proven zero it repeats itself.
      : ` Van jouw kaarten is ${advice.ownProduct} de goedkoopste die we kunnen aantonen: ${euro(advice.ownCostOnReference!)}${advice.savingOnReference === null || advice.costOnReference === 0 ? "" : `, dus ${euro(advice.savingOnReference)} duurder`}.`;
  return `Het voordeligst pin je met ${advice.product}: ${price}. Die heb je nog niet.${own}${small}${missingCashNote(options)}`;
}

/** The cards whose withdrawal price no source states, named.
 *
 *  He thinks Revolut is the cheapest way to pin abroad. Revolut's fee page
 *  prices no withdrawal at all, and neither does Amex's — so we can neither
 *  confirm nor deny it. Leaving them out of the ranking without a word would
 *  read as "they charge nothing", which is the one reading that is certainly
 *  wrong. Deliberately avoids the word "gratis": nothing here is free. */
function missingCashNote(options: readonly WithdrawOption[]): string {
  const missing = options.filter((o) => !o.fee.known).map((o) => o.provider);
  if (missing.length === 0) return "";
  const says = missing.length === 1 ? "zegt onze bron" : "zeggen onze bronnen";
  return ` Van ${nameSome(missing)} ${says} niets over opnemen — dat is geen nul, dat is een gat.`;
}

/** A percentage the Dutch way, with the comma and without a trailing zero it
 *  did not earn. */
function pctNL(n: number): string {
  return `${String(Math.round(n * 100) / 100).replace(".", ",")}%`;
}

/** One row per issuer, the cheapest it offers.
 *
 *  Four N26 plans and thirteen Amex cards would otherwise fill the list with
 *  near-identical rows, which is the same complaint as the duplicate bank rows
 *  in Valuta (review item 5): "just show one ING". The input is already sorted
 *  cheapest-first with unconditional figures ahead of capped ones, so keeping
 *  the first per issuer keeps the best one — and keeps it stable between
 *  renders. Rows with no issuer keep their own identity rather than piling into
 *  one nameless group. */
export function cheapestPerIssuer(offers: readonly CardOffer[]): CardOffer[] {
  const seen = new Set<string>();
  const out: CardOffer[] = [];
  for (const o of offers) {
    const key = o.bank || o.productId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}
