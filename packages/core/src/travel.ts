import type { Account, Tx } from "./model.js";
import type { LearnedFact } from "./facts.js";
import { factNumber } from "./facts.js";
import { analyzeInterest, type RateBenchmark, type InterestSuggestion } from "./interest.js";
import { accountType } from "./balance.js";

export const TRAVEL_AGENT = "travel";

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

/** One card ranked for spending abroad. `netCostPct` is what the trip actually
 *  costs you per euro spent: the conversion surcharge minus what you get back.
 *  Lower is better; a negative value means the card pays you to use it. */
export type SpendOption = {
  account: Account;
  provider: string;
  fxFeePct: number | null;
  cashbackPct: number | null;
  netCostPct: number | null; // null when the fee is unknown — never assumed free
  known: boolean;
  why: string;
};

export type ConvertStep = {
  from: Account | null;
  to: Account | null;
  method: string | null; // e.g. "iDEAL"
  note: string;
};

export type TravelPlan = {
  destination: string;
  currency: string | null;
  /** Where the money is best kept — reuses the interest analysis. */
  store: { suggestion: InterestSuggestion | null; best: RateBenchmark | null; note: string };
  convert: ConvertStep;
  spend: SpendOption[];
  /** Providers we have no terms for yet — what an agent refresh should look up. */
  unknownProviders: string[];
};

/** The provider name a card's terms are stored under. The bank is the product
 *  ("Trading 212"); the account name is his own label and would fragment facts. */
function providerOf(a: Account): string {
  return (a.bank || a.name || a.key || "").trim();
}

/** Cards + payment accounts he could actually pay with abroad. */
function spendableAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => {
    const t = accountType(a);
    return t === "Creditcard" || t === "Betaalrekening";
  });
}

/** Rank what to pay with. Known terms sort by net cost (cheapest first); cards
 *  with unknown terms always sort last — an unknown fee is a risk, not a zero,
 *  and silently ranking it first is exactly how you get burned abroad. */
export function rankSpendOptions(accounts: Account[], facts: readonly LearnedFact[]): SpendOption[] {
  const options = spendableAccounts(accounts).map((account): SpendOption => {
    const provider = providerOf(account);
    const fxFeePct = factNumber(facts, TRAVEL_AGENT, provider, "fxFeePct");
    const cashbackPct = factNumber(facts, TRAVEL_AGENT, provider, "cashbackPct");
    const known = fxFeePct !== null;
    const netCostPct = known ? fxFeePct - (cashbackPct ?? 0) : null;
    return {
      account, provider, fxFeePct, cashbackPct, netCostPct, known,
      why: known
        ? `${fxFeePct}% wisselkosten${cashbackPct ? ` − ${cashbackPct}% cashback` : ""}`
        : "voorwaarden nog onbekend",
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
    return { from: null, to: null, method: null, note: "Nog geen kaart met bekende voorwaarden — ververs eerst de voorwaarden." };
  }
  // Fund the winning card from the payment account holding the most money.
  const funding = accounts
    .filter((a) => accountType(a) === "Betaalrekening" && a.key !== best.account.key)
    .sort((x, y) => (y.balance ?? 0) - (x.balance ?? 0))[0] ?? null;
  const method = factNumber(facts, TRAVEL_AGENT, best.provider, "transferFreeViaIdeal") === 1 ? "iDEAL" : null;
  if (!funding) {
    return { from: null, to: best.account, method, note: `Je betaalt het voordeligst vanaf ${best.provider}.` };
  }
  return {
    from: funding,
    to: best.account,
    method,
    note: method
      ? `Zet je reisbudget van ${providerOf(funding)} naar ${best.provider} via ${method} — dat is gratis — en betaal daar.`
      : `Zet je reisbudget van ${providerOf(funding)} naar ${best.provider} en betaal daar.`,
  };
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
      ? `Je laat rente liggen op ${providerOf(topSuggestion.account)}${interest.best ? ` — ${interest.best.bank} geeft ${interest.best.ratePct}%` : ""}.`
      : "Je spaargeld staat al op de beste plek die we kennen.",
  };

  const spend = rankSpendOptions(accounts, facts);
  const bestSpend = spend.find((s) => s.known) ?? null;
  const convert =
    currency === "EUR"
      ? { from: null, to: null, method: null, note: "Daar betaal je in euro's — omwisselen is niet nodig." }
      : planConversion(accounts, bestSpend, facts);

  return {
    destination,
    currency,
    store,
    convert,
    spend,
    unknownProviders: [...new Set(spend.filter((s) => !s.known).map((s) => s.provider).filter(Boolean))],
  };
}
