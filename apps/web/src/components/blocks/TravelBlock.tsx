import { useState } from "react";
import type { Account, Tx, LearnedFact, RateBenchmark, TravelPlan, Journey } from "@lavega/core";
import { planTravel, makeFact, costOnReferenceSpend, TRAVEL_AGENT, TRAVEL_REFERENCE_SPEND } from "@lavega/core";
import { formatEuro } from "../../format.js";
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

export default function TravelBlock({
  accounts, txs, rates, facts, asOf, homeCountry, busy, aiAvailable, onRefreshTerms, onCorrectFact,
}: TravelBlockProps) {
  const [destination, setDestination] = useState("");
  // One disclosure for the whole block. The answer is the product; everything
  // that argues for it is a click away, not a wall of caveats next to it.
  const [showWhy, setShowWhy] = useState(false);

  const plan: TravelPlan | null = destination
    ? planTravel({ accounts, txs, rates, facts, destination, asOf })
    : null;

  const bestJourney = plan?.journeys.find((j) => j.known) ?? null;

  return (
    <Module
      title="Op reis"
      span={3}
      height="tall"
      menu={
        plan && plan.spend.length > 0 && aiAvailable ? (
          <button type="button" className="card-link" onClick={() => onRefreshTerms(destination)} disabled={busy}>
            {busy
              ? "Bezig…"
              : plan.unknownProviders.length > 0
                ? `Zoek voorwaarden (${plan.unknownProviders.length})`
                : "Ververs voorwaarden"}
          </button>
        ) : undefined
      }
    >
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
          {/* THE ANSWER. One sentence, in euros, on the reference spend. */}
          <div className="travel-winner">
            <div className="travel-winner-name">{plan.headline}</div>
            <div className="cell-sub">
              Alle bedragen gelden op {formatEuro(TRAVEL_REFERENCE_SPEND)} die je daar uitgeeft. LaVega verplaatst zelf
              niets — dit is een stap die jij zet.
            </div>
          </div>

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
                  <p className="travel-step-line">{plan.convert.note}</p>
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
