import { useEffect, useRef, useState } from "react";
import type { Account, Tx, LearnedFact, RateBenchmark, TravelPlan, Journey } from "@lavega/core";
import { planTravel, makeFact, costOnReferenceSpend, TRAVEL_AGENT, TRAVEL_REFERENCE_SPEND } from "@lavega/core";
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

export type TravelBlockProps = {
  accounts: Account[];
  txs: Tx[];
  rates: readonly RateBenchmark[];
  facts: LearnedFact[];
  asOf: string;
  homeCountry: string;
  busy: boolean;
  /** Whether the server has an API key — hides the refresh action when not. */
  aiAvailable: boolean;
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
  | { kind: "searched-empty"; unknown: string[] };

export function termsState(plan: TravelPlan, aiAvailable: boolean, searched: boolean): TermsState {
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
  return searched ? { kind: "searched-empty", unknown } : { kind: "never-searched", unknown };
}

/** The one line that replaces core's headline when there is no priced route.
 *  Core's version advises a refresh; these name the cause instead. */
function termsHeadline(state: TermsState): string | null {
  switch (state.kind) {
    case "no-products":
      return "Nog geen betaalpas of creditcard met een bank erbij — er valt nog niets te vergelijken.";
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
 *  the explanation and the fix are one thing. When there is nothing a click can
 *  fix (no key, no cards) there is deliberately NO button: an action that
 *  cannot work is worse than none. */
function TermsNotice({
  state, busy, aiAvailable, onSearch,
}: {
  state: TermsState;
  busy: boolean;
  aiAvailable: boolean;
  onSearch: () => void;
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

  const noKeyLine = (
    <p className="cell-sub">
      Deze server heeft geen AI-sleutel (<code>ANTHROPIC_API_KEY</code>) ingesteld, dus opzoeken kan hier niet —
      verversen zou niets doen. Zet die sleutel in de serveromgeving, of vul de percentages zelf in onder
      “Waarom?”. Wat jij invult wordt nooit door een agent overschreven.
    </p>
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
    const asOfLine = state.lastUpdated ? ` Laatst opgezocht op ${dayLabelYearNL(state.lastUpdated)}.` : "";
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
        {gaps === 0 && <p className="cell-sub">Alle routes zijn beprijsd.{asOfLine}</p>}
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

export default function TravelBlock({
  accounts, txs, rates, facts, asOf, homeCountry, busy, aiAvailable, onRefreshTerms, onCorrectFact,
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
    ? planTravel({ accounts, txs, rates, facts, destination, asOf })
    : null;

  const bestJourney = plan?.journeys.find((j) => j.known) ?? null;
  const terms = plan ? termsState(plan, aiAvailable, searched.includes(destination)) : null;
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
            {bestJourney && (
              <div className="cell-sub">
                Alle bedragen gelden op {formatEuro(TRAVEL_REFERENCE_SPEND)} die je daar uitgeeft. LaVega verplaatst
                zelf niets — dit is een stap die jij zet.
              </div>
            )}
          </div>

          {/* Why, and the one control that changes it — under the answer, not
              hidden in the header. */}
          {terms && <TermsNotice state={terms} busy={busy} aiAvailable={aiAvailable} onSearch={search} />}

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
                                <span className="eyebrow"> · opgezocht {option.feeUpdatedAt}</span>
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
