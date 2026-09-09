import { AGENTS, isSafeFact, makeFact } from "@lavega/core";
import { loadAgentPrompt } from "./prompts.js";
import { factsBlock } from "./facts.js";
import type { LlmProvider } from "./provider.js";
import { createMistralProvider } from "./mistral.js";
import { checkBudget, recordUsage } from "./budget.js";
import { MISTRAL_MEDIUM } from "./models.js";

export type KnownFact = { subject: string; key: string; value: string };
export type TravelInput = {
  homeCountry: string;
  destination: string;
  currency: string;
  providers: string[];
  knownFacts: KnownFact[];
};

const MAX_PROVIDERS = 12;
const MAX_FACTS = 60;
const MAX_FIELD = 60;

/** A two-letter country code, or "" — never free text (it ends up in a search
 *  query, and a country code cannot carry personal information). */
function countryCode(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : "";
}

function shortField(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s.slice(0, MAX_FIELD);
}

/** Defence in depth for provider names. A provider is a BRAND ("Trading 212",
 *  "N26"), never an account identifier — but an account imported without a bank
 *  is named after its own number, so a caller bug could turn "A 286-41213" into
 *  a "provider" and hand an identifier to the model. Anything carrying an IBAN
 *  or a run of 4+ digits is refused here regardless of what the caller thinks.
 *  Real brands don't have that shape; account numbers always do. */
function looksLikeAccountNumber(s: string): boolean {
  return /[A-Z]{2}\d{2}[A-Z0-9]{8,}/i.test(s) || /\d{4}/.test(s);
}

/** A wire fact as the vault would store it. Travel only ever receives facts the
 *  OWNER corrected (the caller filters on that), so they are tagged `user` —
 *  which is what marks them "niet tegenspreken" in the briefing block. */
function asTravelFact(f: KnownFact) {
  return makeFact({ agent: AGENTS.travel, ...f, source: "user" as const, updatedAt: "" });
}

/** THE redaction boundary for the travel agent — the tightest in the app.
 *
 *  Only a home country, a destination, a currency, provider NAMES, and facts
 *  already known may reach Mistral. Balances, amounts, account keys, IBANs,
 *  transactions, dates and entity names are structurally unable to pass: this
 *  builds a fresh object from allowlisted, length-capped, shape-checked fields
 *  and never copies the input. The ranking that needs the money happens locally. */
export function sanitizeTravelInput(raw: unknown): TravelInput {
  if (!raw || typeof raw !== "object") throw new Error("ongeldige invoer");
  const o = raw as Record<string, unknown>;

  const destination = countryCode(o.destination);
  if (!destination) throw new Error("geen geldige bestemming");
  const homeCountry = countryCode(o.homeCountry) || "NL";
  const currency = /^[A-Z]{3}$/.test(String(o.currency ?? "").toUpperCase())
    ? String(o.currency).toUpperCase()
    : "";

  const rawProviders = Array.isArray(o.providers) ? o.providers : [];
  if (rawProviders.length > MAX_PROVIDERS) throw new Error("te veel aanbieders");
  const providers = [
    ...new Set(rawProviders.map(shortField).filter((p) => p && !looksLikeAccountNumber(p))),
  ];
  if (providers.length === 0) throw new Error("geen aanbieders");

  const rawFacts = Array.isArray(o.knownFacts) ? o.knownFacts : [];
  if (rawFacts.length > MAX_FACTS) throw new Error("te veel bekende feiten");
  const knownFacts: KnownFact[] = [];
  for (const r of rawFacts) {
    if (!r || typeof r !== "object") continue;
    const f = r as Record<string, unknown>;
    const subject = shortField(f.subject);
    const key = shortField(f.key);
    const value = shortField(f.value);
    if (!subject || !key || !value) continue;
    // Same namespace + no-personal-data guard the vault applies (core's
    // `checkFact`), so a fact echoed back by the client cannot become a way to
    // hand the model something the other three fields would never allow.
    if (!isSafeFact(asTravelFact({ subject, key, value }))) continue;
    knownFacts.push({ subject, key, value });
  }

  return { homeCountry, destination, currency, providers, knownFacts };
}

export type ProviderTerms = {
  provider: string;
  fxFeePct?: number;
  convertFeePct?: number;
  cashbackPct?: number;
  pointsPerEuro?: number;
  transferFreeViaIdeal?: number;
  note?: string;
  /** When the SOURCE says the figure was last checked (bank.nl stamps this).
   *  Absent means "as of when we fetched it". Used by the precedence ladder:
   *  a fee checked seven months ago must not overwrite one found today. */
  checkedAt?: string;
};

function numeric(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

const lower = (s: string) => s.trim().toLowerCase();

/** Decide which asked-for provider a reported row is about, returning the name
 *  WE asked with (so facts key consistently). Callers look ONE provider up per
 *  request, and then any row can only be about that one — so it is pinned.
 *  Demanding an exact string match there silently threw away real answers: a
 *  model asked about "American Express" may reply "Amex" or "American Express
 *  Nederland". Only the first row is taken, so a model that volunteers extra
 *  products still can't inject one. With several providers asked, fall back to
 *  exact, then containment, then refuse. */
function attribute(reported: string, asked: string[], alreadyTaken: number): string | null {
  if (asked.length === 1) return alreadyTaken === 0 ? asked[0] : null;
  const r = lower(reported);
  if (!r) return null;
  return (
    asked.find((a) => lower(a) === r) ??
    asked.find((a) => r.includes(lower(a)) || lower(a).includes(r)) ??
    null
  );
}

/** Look up current product terms via Mistral + web search (fees change, so a
 *  bundled table would go stale — that is why the indicative tables were
 *  dropped). The ONLY place the Mistral provider is touched for travel, and it
 *  only ever sees the sanitized input. Results are filtered back to the
 *  providers we asked about, so the model can't introduce products the user
 *  doesn't hold. */
export async function lookupProviderTerms(
  input: TravelInput,
  apiKey: string,
  deps: { provider?: LlmProvider } = {},
): Promise<ProviderTerms[]> {
  const provider = deps.provider ?? createMistralProvider(apiKey, MISTRAL_MEDIUM);
  // `_base.md` + `travel.md`, and what the owner has already corrected — the
  // same composition and the same "WAT LAVEGA AL WEET" block the other three
  // agents get, so the learning contract is explained once for all of them.
  const system =
    loadAgentPrompt("travel") + factsBlock(input.knownFacts.map(asTravelFact), AGENTS.travel);
  const userMessage =
    `Thuisland: ${input.homeCountry}. Bestemming: ${input.destination}` +
    (input.currency ? ` (${input.currency})` : "") +
    `.\nAanbieders: ${input.providers.join(", ")}.`;

  // `/api/agent/travel-facts` only gates its OWN entry (see agent-routes.ts) —
  // one request can fan out into up to MAX_PROVIDERS backgrounded calls here
  // (cardTerms.ts's startLookup, one per stale/gap provider), so that single
  // route-entry check does nothing to cap the fan-out. This is the one place
  // that actually spends, so it is the one place that has to check again,
  // right before spending, for every one of those calls.
  //
  // Throws rather than returning [] — cardTerms.ts's startLookup only marks a
  // provider `agentTried` (no retry for the rest of the TTL) on the path AFTER
  // this resolves; a thrown error is treated the same as any other failed
  // lookup, so the provider stays eligible for retry once the budget resets
  // instead of being wrongly recorded as "asked, and the model had nothing".
  const budget = await checkBudget();
  if (!budget.ok) throw new Error(`agent/travel: AI-limiet bereikt (${budget.scope})`);

  const { text, usage } = await provider.chatWithSearch({
    system,
    messages: [{ role: "user", content: userMessage }],
    onDelta: () => {},
  });
  // The one place the actual model call happens for travel, and the only
  // caller path there is — `/api/agent/travel-facts` never awaits this (it's
  // backgrounded past the route's return, see cardTerms.ts), so the route
  // can't record it; this has to. `usage` is optional here defensively: a
  // test double built before Part 2 can still omit it.
  recordUsage({
    route: "travel",
    model: MISTRAL_MEDIUM,
    inputTokens: usage?.input,
    outputTokens: usage?.output,
    searches: 1,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const rows = (parsed as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(rows)) return [];

  const out: ProviderTerms[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const asked = attribute(String(o.provider ?? ""), input.providers, out.length);
    if (!asked) continue;
    out.push({
      provider: asked,
      fxFeePct: numeric(o.fxFeePct),
      convertFeePct: numeric(o.convertFeePct),
      cashbackPct: numeric(o.cashbackPct),
      pointsPerEuro: numeric(o.pointsPerEuro),
      transferFreeViaIdeal:
        o.transferFreeViaIdeal === 1 ? 1 : o.transferFreeViaIdeal === 0 ? 0 : undefined,
      // Roomy enough for the caveats that actually matter (weekend surcharge,
      // free-withdrawal limit, "credit card differs from debit"). 400 chopped
      // real sentences mid-word in the UI.
      note: typeof o.note === "string" ? o.note.slice(0, 900) : undefined,
    });
  }
  return out;
}
