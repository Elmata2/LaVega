import { useEffect, useRef, useState } from "react";
import type {
  Account, Tx, LearnedFact, RateBenchmark, TravelPlan, Journey, CatalogueEntryLike,
  WithdrawOption, CardOffer,
} from "@lavega/core";
import {
  planTravel, makeFact, costOnReferenceSpend, TRAVEL_AGENT, TRAVEL_REFERENCE_SPEND,
  describeWithdrawalFee, TRAVEL_REFERENCE_WITHDRAWAL, TRAVEL_SMALL_WITHDRAWAL,
} from "@lavega/core";
import catalogueFile from "../../../../../docs/catalog/catalog.json";
import { formatEuro } from "../../format.js";
import { dayLabelYearNL } from "./dates.js";
import Module from "../Module.js";

/* A self-contained block: everything it needs arrives as props and it owns only
 * its own draft state. That made it the first MODULAR block, and it is now one
 * module among the rest on the homescreen grid.
 *
 * It leads with ONE answer — `plan.headline`, priced in euros — because three
 * sections (Bewaren / Wisselen / Betalen) were three answers the owner had to
 * reconcile himself. The ranked JOURNEYS and those three sections are still all
 * here; they just sit behind "waarom", as the reasoning under the answer. */

/* THE PRODUCT CATALOGUE, BUNDLED AT BUILD TIME.
 *
 * Same bargain as the savings rates in `catalogue-rates.ts`, and for the same
 * reason: nothing visual and nothing factual is ever fetched at runtime,
 * because a request tells the server on the other end who is asking. The
 * figures are as fresh as the last deploy, and every one carries the date its
 * own document states, so the screen can show how old a number is. */
const BUNDLED_CATALOGUE = ((catalogueFile as { entries?: CatalogueEntryLike[] }).entries ?? []);

export type TravelBlockProps = {
  accounts: Account[];
  txs: Tx[];
  rates: readonly RateBenchmark[];
  facts: LearnedFact[];
  asOf: string;
  /** The product catalogue. Defaults to the bundled artifact; injectable so a
   *  test can pin behaviour without the whole 122-product file. */
  catalogue?: readonly CatalogueEntryLike[];
  homeCountry: string;
  busy: boolean;
  /** Whether the server has an API key — hides the refresh action when not. */
  aiAvailable: boolean;
  /** Providers the server said it is still looking up, from the last reply. */
  pendingTerms?: readonly string[];
  /** How many providers the ask covered, so progress can count UP. */
  termsAsked?: number;
  /** The lookups ran out of time. Better said than left spinning. */
  termsGaveUp?: boolean;
  onRecheckAi: () => void;
  /** Look up current terms for the providers with unknown terms. */
  onRefreshTerms: (destination: string) => void;
  /** Persist a corrected fact. The correction outlives every later refresh. */
  onCorrectFact: (fact: LearnedFact) => void;
};

const COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "Verenigde Staten" },
  { code: "GB", name: "Verenigd Koninkrijk" },
  { code: "CH", name: "Zwitserland" },
  { code: "JP", name: "Japan" },
  { code: "TH", name: "Thailand" },
  { code: "TR", name: "Turkije" },
  { code: "SE", name: "Zweden" },
  { code: "DK", name: "Denemarken" },
  { code: "NO", name: "Noorwegen" },
  { code: "PL", name: "Polen" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australië" },
  { code: "AE", name: "Verenigde Arabische Emiraten" },
  { code: "MA", name: "Marokko" },
  { code: "ID", name: "Indonesië" },
  { code: "ES", name: "Spanje" },
  { code: "DE", name: "Duitsland" },
  { code: "FR", name: "Frankrijk" },
  { code: "IT", name: "Italië" },
];

/** Inline correction of one learned number. Correcting is the whole point: it
 *  writes a `user` fact, which no later agent run may overwrite. The same
 *  component serves every learnable number — fxFeePct, convertFeePct — so a new
 *  leg is correctable the day it is priced, not a release later. */
function FactCorrection({ provider, factKey, label, value, busy, onCorrect }: {
  provider: string;
  factKey: string;
  label: string;
  value: number | null;
  busy: boolean;
  onCorrect: (fact: LearnedFact) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  if (!editing) {
    return (
      <button type="button" className="card-link" onClick={() => setEditing(true)} disabled={busy}>
        {label} aanpassen
      </button>
    );
  }
  return (
    <span className="confirm-inline">
      <input
        className="saldo-input"
        inputMode="decimal"
        aria-label={`${label} van ${provider}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
      />
      <button
        type="button"
        className="card-link"
        disabled={busy}
        onClick={() => {
          const trimmed = draft.trim().replace(",", ".").replace("%", "");
          if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
            onCorrect(makeFact({
              agent: TRAVEL_AGENT, subject: provider, key: factKey,
              value: trimmed, source: "user", updatedAt: new Date().toISOString().slice(0, 10),
            }));
          }
          setEditing(false);
        }}
      >
        Bewaar
      </button>
      <button type="button" className="card-link" onClick={() => setEditing(false)} disabled={busy}>
        Annuleer
      </button>
    </span>
  );
}

function pct(n: number | null): string {
  return n === null ? "onbekend" : `${n}%`;
}

/** A leg's price on the reference spend. `null` is UNKNOWN and must never read
 *  as free — that rule is why the ranking can be trusted at all. A leg that does
 *  not exist on this route (no transfer when you pay directly) is not a price,
 *  so it renders as "n.v.t." rather than as a zero. */
function legCost(costPct: number | null): string {
  if (costPct === null) return "onbekend";
  const euros = costOnReferenceSpend(costPct);
  if (euros === null) return "onbekend";
  // `-0` is a real outcome here (a leg with no cashback prices at minus nothing)
  // and formats as "€ -0,00", which reads like a rounding error. It is zero.
  if (euros === 0) return formatEuro(0);
  if (euros < 0) return `${formatEuro(Math.abs(euros))} terug`;
  return formatEuro(euros);
}

type Leg = { name: string; detail: string; cost: string };

/** The three legs of a route, in the order the money travels: overzetten →
 *  wisselen → betalen. Named after the sections they replace, so the detail the
 *  owner already knows how to read is still there — now inside one route
 *  instead of standing next to it as a rival answer. */
function legsOf(j: Journey): Leg[] {
  if (j.via === null) {
    return [
      { name: "Overzetten", detail: "niet nodig — je betaalt direct", cost: "n.v.t." },
      { name: "Wisselen", detail: "de kaart wisselt bij betaling", cost: "n.v.t." },
      { name: "Betalen", detail: j.provider, cost: legCost(j.spendPct) },
    ];
  }
  return [
    {
      name: "Overzetten",
      detail: `${j.fundedFrom ?? "je betaalrekening"} → ${j.via}${j.method ? ` via ${j.method}` : ""}`,
      cost: legCost(j.transferPct),
    },
    { name: "Wisselen", detail: `bij ${j.via}`, cost: legCost(j.convertPct) },
    { name: "Betalen", detail: j.provider, cost: legCost(j.spendPct) },
  ];
}

function journeyTitle(j: Journey): string {
  return j.via === null
    ? `Direct betalen met ${j.provider}`
    : `Via ${j.via}${j.fundedFrom ? ` (vanaf ${j.fundedFrom})` : ""}`;
}

function journeyKey(j: Journey): string {
  return `${j.provider}|${j.via ?? "direct"}`;
}

/* ---------- Why there is no priced route, and what actually unlocks one ----------
 *
 * Core's own fallback sentence is "ververs eerst de voorwaarden". On a server
 * with no ANTHROPIC_API_KEY that is advice that cannot work: /api/agent/status
 * answers `{"configured":false}` and the lookup answers 503, so the refresh the
 * sentence asks for is a no-op. It cost Alexander an afternoon hunting a bug
 * that did not exist.
 *
 * So the block never prints that sentence. It works out WHICH of four different
 * situations it is in and names that one — the block already receives
 * `aiAvailable`, it simply was not used for anything but hiding a button:
 *
 *   no-products     nothing to compare: no card or payment account with a bank
 *   no-key          this server cannot look anything up — refreshing is futile
 *   never-searched  it has simply never been asked; the ask is one click away
 *   searching       the server is still looking; asking again shortly will help
 *   searched-empty  it WAS asked in this session and nothing usable came back
 *
 * The last two are the split core cannot make for us: a lookup that finds
 * nothing writes no fact, so after a reload "asked and nothing found" and
 * "never asked" are byte-identical in the vault. We can only tell them apart by
 * having watched the request go out, so `searched` is session state and the
 * copy claims no more than that. */
export type TermsState =
  | { kind: "euro" }
  | { kind: "no-products" }
  /** `unknown` = cards with no exchange fee at all. `unpriced` = cards whose
   *  DIRECT leg is priced but whose move-it-first route still is not, because
   *  its conversion fee was never learned. Two different gaps: core's
   *  `unknownProviders` only reports the first, and calling the second "bekend"
   *  would claim a route is priced when the block prints "onbekend" next to it. */
  | { kind: "known"; unknown: string[]; unpriced: { provider: string; why: string }[]; lastUpdated: string | null }
  | { kind: "no-key"; unknown: string[] }
  | { kind: "never-searched"; unknown: string[] }
  /** The server accepted the ask and is looking in the background. This is NOT
   *  "nothing came back": conflating the two told the owner his search had
   *  failed while a banner two lines up said it was still running, and the fee
   *  he was told did not exist appeared moments later. A lookup takes 40s to a
   *  few minutes; saying so is the whole difference between patience and a bug
   *  report. */
  | { kind: "searching"; pending: string[] }
  | { kind: "searched-empty"; unknown: string[] };

export function termsState(plan: TravelPlan, aiAvailable: boolean, searched: boolean, pending: readonly string[] = []): TermsState {
  if (plan.currency === "EUR") return { kind: "euro" };
  if (plan.spend.length === 0) return { kind: "no-products" };
  const unknown = plan.unknownProviders;
  if (plan.journeys.some((j) => j.known)) {
    // Newest agent lookup we have any evidence of, so "laatst opgezocht" is a
    // date we actually hold rather than a reassuring guess.
    const dates = plan.spend
      .map((s) => (s.feeSource === "agent" ? s.feeUpdatedAt : null))
      .filter((d): d is string => d !== null)
      .sort();
    // Which leg is missing is core's own answer (`journey.why` — "wisselkosten
    // nog onbekend" vs "overboekkosten nog onbekend"), so the notice repeats it
    // instead of guessing which of the two it was.
    const unpriced = plan.journeys
      .filter((j) => !j.known && !unknown.includes(j.provider))
      .map((j) => ({ provider: j.provider, why: j.why }));
    return {
      kind: "known",
      unknown,
      unpriced,
      lastUpdated: dates.length > 0 ? dates[dates.length - 1] : null,
    };
  }
  if (!aiAvailable) return { kind: "no-key", unknown };
  // Still running beats "found nothing". The server told us which providers it
  // is working on; repeating that is honest, and it is also the answer.
  const stillGoing = unknown.filter((p) => pending.includes(p));
  if (stillGoing.length > 0) return { kind: "searching", pending: stillGoing };
  return searched ? { kind: "searched-empty", unknown } : { kind: "never-searched", unknown };
}

/** The one line that replaces core's headline when there is no priced route.
 *  Core's version advises a refresh; these name the cause instead. */
function termsHeadline(state: TermsState): string | null {
  switch (state.kind) {
    case "no-products":
      return "Nog geen betaalpas of creditcard met een bank erbij — er valt nog niets te vergelijken.";
    case "searching":
      return "LaVega zoekt de voorwaarden nu op — dat duurt een minuut of twee.";
    case "no-key":
      return "LaVega kan de voorwaarden hier niet opzoeken: deze server heeft geen AI-sleutel.";
    case "never-searched":
      return "De voorwaarden van je kaarten zijn nog niet opgezocht.";
    case "searched-empty":
      return "Opgezocht, maar er kwam geen bruikbaar tarief terug.";
    default:
      return null; // "known" and "euro" keep core's own answer
  }
}

function nameList(providers: string[]): string {
  return providers.join(", ");
}

/** The block's one visible control for the terms, sitting directly under the
 *  answer it explains.
 *
 *  It used to live in the module's "…" slot, where Alexander could not find it
 *  (B3) — a card-link in a header corner, next to nothing that said why you
 *  would press it. Here it sits inside the sentence that states the problem, so
 *  the explanation and the fix are one thing. Where nothing a click can fix
 *  (no cards) there is deliberately NO button: an action that cannot work is
 *  worse than none. The no-key state is the exception, and it took a real
 *  report to see why: LaVega asks the server about its key only at page load,
 *  so a tab that opened first keeps saying "no key" after one is set. Without a
 *  control there, the only cure was knowing to reload — so it gets one. */
export function TermsNotice({
  state, busy, aiAvailable, termsAsked, termsGaveUp, onSearch, onRecheckAi,
}: {
  state: TermsState;
  busy: boolean;
  aiAvailable: boolean;
  termsAsked: number;
  termsGaveUp: boolean;
  onSearch: () => void;
  onRecheckAi: () => void;
}) {
  if (state.kind === "euro") return null;

  const searchButton = (primary: boolean, label: string) => (
    <button
      type="button"
      className={primary ? "btn btn-primary travel-terms-action" : "btn travel-terms-action"}
      onClick={onSearch}
      disabled={busy}
    >
      {busy ? "Bezig met zoeken…" : label}
    </button>
  );

  // A control, not only a sentence. LaVega asks the server whether it has a key
  // ONCE, when the page loads, so a tab opened before the key was set repeats
  // "no key" for the rest of its life — a true sentence about a stale fact, and
  // from the outside indistinguishable from a broken feature. Without this
  // button there is nothing to press in exactly the state that needs pressing,
  // and the only cure is knowing to reload.
  const noKeyLine = (
    <>
      <p className="cell-sub">
        Deze server heeft geen AI-sleutel (<code>ANTHROPIC_API_KEY</code>) ingesteld, dus opzoeken kan hier niet —
        verversen zou niets doen. Zet die sleutel in de serveromgeving, of vul de percentages zelf in onder
        “Waarom?”. Wat jij invult wordt nooit door een agent overschreven.
      </p>
      <button type="button" className="card-link" onClick={onRecheckAi} disabled={busy}>
        Sleutel net ingesteld? Opnieuw controleren
      </button>
    </>
  );

  if (state.kind === "no-products") {
    return (
      <div className="travel-terms" role="status">
        <p className="cell-sub">
          Vul bij Rekeningen de bank in bij je betaalrekeningen en creditcards. Zonder bank weten we niet welk
          product het is, en dus ook niet welke voorwaarden erbij horen.
        </p>
      </div>
    );
  }

  if (state.kind === "known") {
    const gaps = state.unknown.length + state.unpriced.length;
    return (
      <div className="travel-terms" role="status">
        {state.unknown.length > 0 && (
          <p className="cell-sub">
            Van {state.unknown.length} kaart{state.unknown.length === 1 ? "" : "en"} kennen we de wisselkosten nog niet
            ({nameList(state.unknown)}). Die staan onderaan zonder bedrag — onbekend is niet gratis, dus ze doen niet
            mee in de rangschikking.
          </p>
        )}
        {state.unpriced.length > 0 && (
          <p className="cell-sub">
            Nog niet elke route is te beprijzen:{" "}
            {state.unpriced.map((u) => `${u.provider} — ${u.why}`).join("; ")}. Die routes staan zonder bedrag.
          </p>
        )}
        {gaps === 0 && <p className="cell-sub">Alle routes zijn beprijsd.</p>}
        {/* Only ever a date we actually hold: a fee the owner typed himself
            carries no lookup date, and no date is printed for it.
            "Opgezocht" used to claim LaVega did the looking on that date — but
            a bank.nl figure was checked by bank.nl and merely fetched by us. A
            neutral verb is true of both sources. */}
        {state.lastUpdated && (
          <p className="cell-sub">Cijfers laatst gecontroleerd op {dayLabelYearNL(state.lastUpdated)}.</p>
        )}
        {aiAvailable
          ? searchButton(false, gaps > 0 ? `Zoek voorwaarden (${gaps})` : "Ververs voorwaarden")
          : noKeyLine}
      </div>
    );
  }

  if (state.kind === "no-key") {
    return (
      <div className="travel-terms travel-terms-blocked" role="status">
        <p className="cell-sub">Nog onbekend: {nameList(state.unknown)}.</p>
        {noKeyLine}
      </div>
    );
  }

  if (state.kind === "searching") {
    // The HTTP call finished in a fraction of a second; the LOOKUP has not.
    // Showing the request's progress left the screen still while the work ran,
    // so this shows the work: a count that moves as each one lands.
    const found = Math.max(0, termsAsked - state.pending.length);
    return (
      <div className="travel-terms" role="status" aria-live="polite">
        <p className="cell-sub travel-searching">
          <span className="spinner" aria-hidden="true" />
          <span>
            LaVega zoekt de voorwaarden op van {nameList(state.pending)}
            {termsAsked > 0 && <> — {found} van {termsAsked} gevonden</>}. Dat duurt een minuut of twee; dit
            scherm werkt zichzelf bij.
          </span>
        </p>
        {termsGaveUp && (
          <p className="cell-sub text-warn">
            Er kwam niets meer binnen. Probeer het opnieuw, of vul de percentages zelf in onder “Waarom?” —
            wat jij invult wordt nooit overschreven.
          </p>
        )}
        {searchButton(false, "Nu opnieuw kijken")}
      </div>
    );
  }

  if (state.kind === "never-searched") {
    return (
      <div className="travel-terms" role="status">
        <p className="cell-sub">
          Deze zijn nog nooit opgezocht: {nameList(state.unknown)}. Eén klik en LaVega haalt de tarieven van de
          aanbieders zelf op.
        </p>
        {searchButton(true, `Zoek voorwaarden (${state.unknown.length})`)}
      </div>
    );
  }

  return (
    <div className="travel-terms travel-terms-blocked" role="status">
      <p className="cell-sub">
        We hebben gezocht, maar voor {nameList(state.unknown)} kwam er geen bruikbaar tarief terug. Vul de
        wisselkosten zelf in onder “Waarom?” — jouw invoer blijft staan en wordt nooit overschreven. Zoeken kan
        opnieuw; de server haalt sommige tarieven op de achtergrond op.
      </p>
      {searchButton(false, "Opnieuw zoeken")}
    </div>
  );
}

/* ---------- CASH, and the rest of the market ----------
 *
 * Two questions the block used to leave out, both answerable from data already
 * on disk (app review, 20 August, items 6/7/8).
 *
 * TAKING MONEY OUT is a different price from paying, and almost always worse:
 * every tariff document we hold prices it on its own row, usually as a
 * percentage PLUS a flat fee. The flat fee is the part that matters and the
 * part a percentage cannot express — ING's € 3,50 is 1,75% on € 200 and 7% on
 * € 50 — so the euros are quoted on one realistic withdrawal and the small one
 * is quoted beside it.
 *
 * WHAT HE COULD SWITCH TO is a separate question from what he can pay with
 * today, and the block used to answer only the second: `rankSpendOptions`
 * iterates his own accounts, so a cheaper card he does not hold could not
 * appear however cheap. That is why Revolut looked like the best shot for the
 * US while the 212 Card sat in the catalogue at a provable 0%. Both questions
 * are on screen now, and they are kept apart by construction: `plan.offers`
 * contains only cards he does NOT hold, and every place it renders says so. */

function pctNL(n: number): string {
  return `${String(Math.round(n * 100) / 100).replace(".", ",")}%`;
}

/** What one withdrawal costs, or "onbekend". Never a zero — a missing price is
 *  not a free one, and abroad that difference is real money. */
function cashCost(euros: number | null): string {
  return euros === null ? "onbekend" : formatEuro(euros);
}

/** His own cards, priced for pulling out cash. The reason a row has no price is
 *  printed with the row: "the document points at article 13.3" and "we do not
 *  know which ING creditcard you have" need different things from him, and one
 *  of them he can fix in a click. */
export function CashSection({ options, asOf }: { options: readonly WithdrawOption[]; asOf: string }) {
  return (
    <div className="travel-step travel-cash">
      <h3 className="travel-step-title">Geld pinnen</h3>
      <p className="cell-sub">
        Pinnen is een aparte prijs, en bijna altijd hoger dan betalen. Bedragen gelden op één opname van{" "}
        {formatEuro(TRAVEL_REFERENCE_WITHDRAWAL)}.
      </p>
      {options.length === 0 ? (
        <p className="cell-sub">Nog geen kaarten of betaalrekeningen bekend.</p>
      ) : (
        <ul className="travel-legs">
          {options.map((o) => (
            <li key={o.provider} className="travel-leg">
              <span className="travel-leg-name">
                {o.provider}
                {o.fee.known && <span className="eyebrow"> · {describeWithdrawalFee(o.fee)}</span>}
                {o.asOf && <span className="eyebrow"> · {figureAge(o.asOf, asOf)}</span>}
              </span>
              <span className="travel-leg-cost">{cashCost(o.costOnReference)}</span>
            </li>
          ))}
        </ul>
      )}
      {options.map((o) =>
        o.fee.known ? (
          <div key={`why-${o.provider}`}>
            {o.penalisesSmall && o.smallEffectivePct !== null && (
              <p className="cell-sub travel-note">
                {o.provider}: er zit een vast bedrag per opname bij, dus {formatEuro(TRAVEL_SMALL_WITHDRAWAL)} pinnen
                kost {pctNL(o.smallEffectivePct)} in plaats van {pctNL(o.effectivePct ?? 0)}. Neem in één keer meer op.
              </p>
            )}
            {o.fee.caveat && (
              <p className="cell-sub travel-note">
                <strong>Let op:</strong> {o.provider} — {o.fee.caveat}
              </p>
            )}
          </div>
        ) : (
          <p key={`why-${o.provider}`} className="cell-sub travel-note">
            {o.provider}: {o.fee.why}
          </p>
        ),
      )}
    </div>
  );
}

/** The catalogue's cheapest cards that he does NOT hold.
 *
 *  Everything here is phrased as something to open, never as something to pay
 *  with, because that is the whole risk of putting it on this screen. Cashback
 *  is shown and never subtracted: every cashback figure the catalogue holds
 *  today is paid in a token behind a stake or a subscription, so pricing it in
 *  euros would be the same fake precision that keeps reward points out of the
 *  ranking. */
export function OffersSection({ offers, asOf, shown = 6 }: { offers: readonly CardOffer[]; asOf: string; shown?: number }) {
  if (offers.length === 0) return null;
  const top = offers.slice(0, shown);
  return (
    <div className="travel-step travel-offers">
      <h3 className="travel-step-title">Wat je zou kunnen openen</h3>
      <p className="cell-sub">
        Kaarten uit de catalogus, geen kaarten van jou — voor zover wij kunnen zien heb je ze niet, en betalen doe je
        vandaag met wat er onder “Betalen” staat. Eén kaart per aanbieder: de voordeligste waarvan we de bron en de
        datum hebben.
      </p>
      <ul className="travel-journeys">
        {top.map((o) => (
          <li key={o.productId} className="travel-journey">
            <div className="travel-journey-head">
              <span className="travel-journey-name">{o.product}</span>
              <span className="travel-journey-cost">
                {formatEuro(costOnReferenceSpend(o.netCostPct) ?? 0)} op {formatEuro(TRAVEL_REFERENCE_SPEND)}
              </span>
            </div>
            <p className="cell-sub travel-note">
              {pctNL(o.fxFeePct)} wisselkosten
              {o.cashbackPct !== null && ` · ${pctNL(o.cashbackPct)} cashback`}
              {o.withdrawalOnReference !== null
                ? ` · pinnen ${formatEuro(o.withdrawalOnReference)} per ${formatEuro(TRAVEL_REFERENCE_WITHDRAWAL)}`
                : " · pinnen onbekend"}
              {" · "}
              {figureAge(o.asOf, asOf)}
            </p>
            {o.capNote && (
              <p className="cell-sub travel-note">
                <strong>Let op:</strong> {o.capNote}
              </p>
            )}
            {o.cashbackNote && <p className="cell-sub travel-note">{o.cashbackNote} Daarom rekenen we die niet mee.</p>}
          </li>
        ))}
      </ul>
      {offers.length > top.length && (
        <p className="cell-sub">
          Nog {offers.length - top.length} kaarten in de catalogus met een onderbouwd tarief, allemaal duurder dan deze.
        </p>
      )}
    </div>
  );
}

/** How old a figure is, in words, because a bare date does not tell you whether
 *  to trust it. "vandaag opgezocht" and "gecontroleerd 15 jan" are different
 *  claims, and a koersopslag from seven months ago should look seven months old
 *  on screen rather than hide behind a formatted date. */
export function figureAge(updatedAt: string, asOf: string): string {
  const days = Math.round((Date.parse(asOf) - Date.parse(updatedAt)) / 86_400_000);
  if (!Number.isFinite(days)) return `opgezocht ${updatedAt}`;
  if (days <= 0) return "vandaag opgezocht";
  if (days === 1) return "gisteren opgezocht";
  if (days < 14) return `${days} dagen geleden opgezocht`;
  if (days < 60) return `${Math.round(days / 7)} weken geleden gecontroleerd`;
  return `${Math.round(days / 30)} maanden geleden gecontroleerd`;
}

export default function TravelBlock({
  accounts, txs, rates, facts, asOf, homeCountry, busy, aiAvailable, pendingTerms = [], termsAsked = 0, termsGaveUp = false, onRefreshTerms, onRecheckAi, onCorrectFact,
  catalogue = BUNDLED_CATALOGUE,
}: TravelBlockProps) {
  const [destination, setDestination] = useState("");
  // One disclosure for the whole block. The answer is the product; everything
  // that argues for it is a click away, not a wall of caveats next to it.
  const [showWhy, setShowWhy] = useState(false);

  // Destinations a lookup actually WENT OUT for in this session. The only way
  // to tell "asked and found nothing" from "never asked": a fruitless lookup
  // stores no fact, so the vault records the two identically. Session-scoped on
  // purpose — after a reload we no longer know, and the copy falls back to the
  // weaker, true claim ("nog niet opgezocht").
  const [searched, setSearched] = useState<string[]>([]);
  const pending = useRef<string | null>(null);
  const sawBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      sawBusy.current = true;
      return;
    }
    if (!sawBusy.current || pending.current === null) return;
    const done = pending.current;
    pending.current = null;
    sawBusy.current = false;
    setSearched((prev) => (prev.includes(done) ? prev : [...prev, done]));
  }, [busy]);

  function search() {
    pending.current = destination;
    onRefreshTerms(destination);
  }

  const plan: TravelPlan | null = destination
    ? planTravel({ accounts, txs, rates, facts, destination, asOf, catalogue })
    : null;

  const bestJourney = plan?.journeys.find((j) => j.known) ?? null;
  const terms = plan ? termsState(plan, aiAvailable, searched.includes(destination), pendingTerms) : null;
  // Core's headline advises a refresh whenever no route is priced; when the
  // refresh cannot work, or was never the missing piece, we say what is.
  const headline = (terms && termsHeadline(terms)) ?? plan?.headline ?? "";

  return (
    <Module title="Op reis" span={3} height="tall">
      <div className="travel-controls">
        <label>
          <span className="eyebrow">Ik reis vanuit {homeCountry} naar</span>
          <select value={destination} onChange={(e) => setDestination(e.target.value)} disabled={busy}>
            <option value="">— kies een land —</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </label>
        {plan?.currency && <span className="eyebrow">je betaalt daar in {plan.currency}</span>}
      </div>

      {!plan ? (
        <p className="block-empty">Kies een land en LaVega zegt waar je je geld het best bewaart, wisselt en uitgeeft.</p>
      ) : (
        <>
          {/* THE ANSWER. One sentence, in euros, on the reference spend — or,
              when nothing can be priced, the reason nothing can be. */}
          <div className={`travel-winner${bestJourney ? "" : " travel-winner-unpriced"}`}>
            <div className="travel-winner-name">{headline}</div>
            {/* The winner's own caveat, next to the answer rather than behind a
                disclosure. Revolut is why: its 0% holds only inside a €1.000
                monthly limit, and "dat kost je niets op € 1.000" was being said
                without it — a conditional rate stated as absolute. If a provider
                attached a condition to its rate, the recommendation carries it. */}
            {bestJourney?.note && (
              <p className="cell-sub travel-winner-caveat">
                <strong>Let op:</strong> {bestJourney.note}
              </p>
            )}
            {/* CASH. He asked for it in so many words — "also include taking
                money, physical cash. Which card can you take out money?" — and
                it is a different, worse price than paying, so it gets its own
                sentence rather than a footnote under the card advice. */}
            <p className="cell-sub travel-winner-cash">
              <strong>Pinnen:</strong> {plan.withdrawHeadline}
            </p>
            {/* And the other question: what is cheaper out there. Marked as not
                his, in the same breath as the number, because the one thing
                this must never become is advice to pay with a card he does not
                carry. */}
            {plan.switchGain && (
              <p className="cell-sub travel-winner-switch">
                <strong>Nog niet van jou:</strong> {plan.switchGain.best.product} rekent{" "}
                {pctNL(plan.switchGain.best.fxFeePct)} en zou je {formatEuro(plan.switchGain.savingCents / 100)} schelen
                op {formatEuro(TRAVEL_REFERENCE_SPEND)}. Die moet je eerst openen — vandaag betaal je met wat je hebt.
              </p>
            )}
            {bestJourney && (
              <div className="cell-sub">
                Alle bedragen gelden op {formatEuro(TRAVEL_REFERENCE_SPEND)} die je daar uitgeeft. LaVega verplaatst
                zelf niets — dit is een stap die jij zet.
              </div>
            )}
          </div>

          {/* Why, and the one control that changes it — under the answer, not
              hidden in the header. */}
          {terms && <TermsNotice state={terms} busy={busy} aiAvailable={aiAvailable} termsAsked={termsAsked} termsGaveUp={termsGaveUp} onSearch={search} onRecheckAi={onRecheckAi} />}

          <button
            type="button"
            className="card-link"
            aria-expanded={showWhy}
            onClick={() => setShowWhy(!showWhy)}
          >
            {showWhy ? "Verberg waarom" : "Waarom?"}
          </button>

          {showWhy && (
            <div className="travel-why">
              <h3 className="travel-step-title">Alle routes</h3>
              {plan.journeys.length === 0 ? (
                <p className="cell-sub">
                  {plan.currency === "EUR"
                    ? "Geen route nodig — daar reken je gewoon in euro's af."
                    : "Nog geen kaarten of betaalrekeningen bekend."}
                </p>
              ) : (
                <ul className="travel-journeys">
                  {plan.journeys.map((j) => (
                    <li
                      key={journeyKey(j)}
                      className={`travel-journey${j === bestJourney ? " travel-journey-best" : ""}${j.known ? "" : " travel-journey-unknown"}`}
                    >
                      <div className="travel-journey-head">
                        <span className="travel-journey-name">{journeyTitle(j)}</span>
                        <span className="travel-journey-cost">
                          {j.known ? legCost(j.totalCostPct) : "onbekend"}
                        </span>
                      </div>

                      <ul className="travel-legs">
                        {legsOf(j).map((leg) => (
                          <li key={leg.name} className="travel-leg">
                            <span className="travel-leg-name">
                              {leg.name} · {leg.detail}
                            </span>
                            <span className="travel-leg-cost">{leg.cost}</span>
                          </li>
                        ))}
                      </ul>

                      <p className="cell-sub travel-note">
                        {j.known
                          ? j.why
                          : `Niet elke stap van deze route is bekend (${j.why}) — daarom staat er geen bedrag. Onbekend is niet gratis.`}
                      </p>

                      {j.via === null ? (
                        <FactCorrection
                          provider={j.provider}
                          factKey="fxFeePct"
                          label={`wisselkosten (${pct(plan.spend.find((s) => s.provider === j.provider)?.fxFeePct ?? null)})`}
                          value={plan.spend.find((s) => s.provider === j.provider)?.fxFeePct ?? null}
                          busy={busy}
                          onCorrect={onCorrectFact}
                        />
                      ) : (
                        <FactCorrection
                          provider={j.provider}
                          factKey="convertFeePct"
                          label={`omwisselkosten (${pct(j.convertPct)})`}
                          value={j.convertPct}
                          busy={busy}
                          onCorrect={onCorrectFact}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* The three original sections, kept — as the detail under the
                  answer rather than three answers standing beside it. */}
              <div className="travel-plan">
                <div className="travel-step">
                  <h3 className="travel-step-title">Bewaren</h3>
                  <p className="travel-step-line">{plan.store.note}</p>
                  {plan.store.suggestion && (
                    <p className="cell-sub">
                      Scheelt {formatEuro(plan.store.suggestion.extraPerYearCents / 100)} per jaar.
                    </p>
                  )}
                </div>

                <div className="travel-step">
                  <h3 className="travel-step-title">Wisselen</h3>
                  {/* Core's convert note carries the same "ververs eerst de
                      voorwaarden" advice as its headline, and it is wrong for
                      the same reason. When no card is priced, point at the
                      notice that names the real cause instead of repeating an
                      instruction that may be impossible to follow. */}
                  <p className="travel-step-line">
                    {bestJourney
                      ? plan.convert.note
                      : "Nog geen kaart met bekende voorwaarden — zie de reden boven aan dit blok."}
                  </p>
                </div>

                <div className="travel-step">
                  <h3 className="travel-step-title">Betalen</h3>
                  {plan.spend.length === 0 ? (
                    <p className="cell-sub">Nog geen kaarten of betaalrekeningen bekend.</p>
                  ) : (
                    <ul className="travel-legs">
                      {plan.spend.map((option) => {
                        const cost = costOnReferenceSpend(option.netCostPct);
                        return (
                          <li key={option.provider} className="travel-leg">
                            <span className="travel-leg-name">
                              {option.provider}
                              {(option.pointsPerEuro ?? 0) > 0 && (
                                <span className="eyebrow"> · {option.pointsPerEuro} punt/€</span>
                              )}
                              {option.feeSource === "user" && <span className="eyebrow"> · door jou ingesteld</span>}
                              {option.feeSource === "agent" && option.feeUpdatedAt && (
                                <span className="eyebrow"> · {figureAge(option.feeUpdatedAt, asOf)}</span>
                              )}
                            </span>
                            <span className="travel-leg-cost">
                              {cost === null ? "onbekend" : legCost(option.netCostPct)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {plan.spendNote && <p className="cell-sub travel-note">{plan.spendNote}</p>}
                </div>
              </div>

              {/* Full width, outside the three-column grid: both are lists, and
                  a list of thirteen tariffs does not belong in a 240px column. */}
              <CashSection options={plan.withdraw} asOf={asOf} />

              <OffersSection offers={plan.offers} asOf={asOf} />

              {plan.unidentifiedCount > 0 && (
                <p className="cell-sub">
                  {plan.unidentifiedCount} rekening{plan.unidentifiedCount === 1 ? "" : "en"} zonder bank — die kunnen we
                  niet opzoeken. Vul de bank in bij Rekeningen, of zet het type op Spaarrekening als het spaargeld is.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </Module>
  );
}
