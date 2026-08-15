import { useState } from "react";
import type { Account, Tx, LearnedFact, RateBenchmark, TravelPlan } from "@lavega/core";
import { planTravel, countryCurrency, makeFact, costOnReferenceSpend, TRAVEL_AGENT, TRAVEL_REFERENCE_SPEND } from "@lavega/core";
import { formatEuro } from "../format.js";

/* A self-contained block: everything it needs arrives as props and it owns only
 * its own draft state. That makes it the first MODULAR block — droppable into a
 * customizable dashboard without dragging App state along with it. */

type TravelBlockProps = {
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
 *  writes a `user` fact, which no later agent run may overwrite. */
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

export default function TravelBlock({
  accounts, txs, rates, facts, asOf, homeCountry, busy, aiAvailable, onRefreshTerms, onCorrectFact,
}: TravelBlockProps) {
  const [destination, setDestination] = useState("");
  // Which card's "waarom" is open. One at a time — the point is a clear answer
  // with the reasoning a click away, not a wall of caveats.
  const [expanded, setExpanded] = useState<string | null>(null);

  const plan: TravelPlan | null = destination
    ? planTravel({ accounts, txs, rates, facts, destination, asOf })
    : null;

  const winner = plan?.spend.find((o) => o.known) ?? null;
  const winnerCost = costOnReferenceSpend(winner?.netCostPct ?? null);
  // What choosing the winner saves against the next-best KNOWN card.
  const runnerUp = plan?.spend.filter((o) => o.known)[1] ?? null;
  const runnerUpSaving =
    winner && runnerUp && winner.netCostPct !== null && runnerUp.netCostPct !== null
      ? Math.round((runnerUp.netCostPct - winner.netCostPct) * TRAVEL_REFERENCE_SPEND) / 100
      : null;

  return (
    <section className="card" aria-label="Op reis">
      <div className="card-header">
        <h2>Op reis</h2>
        {plan && plan.spend.length > 0 && aiAvailable && (
          <button type="button" className="card-link" onClick={() => onRefreshTerms(destination)} disabled={busy}>
            {busy
              ? "Bezig…"
              : plan.unknownProviders.length > 0
                ? `Zoek voorwaarden (${plan.unknownProviders.length})`
                : "Ververs voorwaarden"}
          </button>
        )}
      </div>

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
        <p className="cell-sub">Kies een land en LaVega zegt waar je je geld het best bewaart, wisselt en uitgeeft.</p>
      ) : (
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
            <p className="cell-sub">LaVega verplaatst zelf niets — dit is een stap die jij zet.</p>
          </div>

          <div className="travel-step travel-step-wide">
            <h3 className="travel-step-title">Betalen</h3>
            {plan.spend.length === 0 ? (
              <p className="cell-sub">Nog geen kaarten of betaalrekeningen bekend.</p>
            ) : (
              <>
                {winner && (
                  <div className="travel-winner">
                    <div className="travel-winner-name">{winner.provider}</div>
                    <div className="travel-winner-cost">
                      {winnerCost !== null && winnerCost > 0 && `€ ${winnerCost.toFixed(2)} kosten per € 1.000 die je uitgeeft`}
                      {winnerCost !== null && winnerCost <= 0 && `levert € ${Math.abs(winnerCost).toFixed(2)} op per € 1.000 die je uitgeeft`}
                    </div>
                    {runnerUpSaving !== null && (
                      <div className="cell-sub">
                        € {runnerUpSaving.toFixed(2)} goedkoper dan {runnerUp!.provider}
                      </div>
                    )}
                  </div>
                )}

                <ul className="travel-cards">
                  {plan.spend.map((option, i) => {
                    const cost = costOnReferenceSpend(option.netCostPct);
                    const open = expanded === option.provider;
                    return (
                      <li key={option.provider} className={option === winner ? "travel-card-best" : ""}>
                        <button
                          type="button"
                          className="travel-card-row"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : option.provider)}
                        >
                          <span className="travel-card-name">
                            {option.provider}
                            {option.accounts.length > 1 && <span className="eyebrow"> · {option.accounts.length} rek.</span>}
                            {(option.pointsPerEuro ?? 0) > 0 && <span className="eyebrow"> · {option.pointsPerEuro} punt/€</span>}
                          </span>
                          <span className="travel-card-cost">
                            {cost === null ? "onbekend" : `€ ${cost.toFixed(2)}`}
                            <span className="travel-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
                          </span>
                        </button>

                        {open && (
                          <div className="travel-card-detail">
                            <p className="cell-sub">
                              {option.why}
                              {option.feeSource === "user" && " · door jou ingesteld"}
                              {option.feeSource === "agent" && option.feeUpdatedAt && ` · opgezocht ${option.feeUpdatedAt}`}
                            </p>
                            {option.note && <p className="cell-sub travel-note">{option.note}</p>}
                            <FactCorrection
                              provider={option.provider}
                              factKey="fxFeePct"
                              label={`wisselkosten (${pct(option.fxFeePct)})`}
                              value={option.fxFeePct}
                              busy={busy}
                              onCorrect={onCorrectFact}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {plan.spendNote && <p className="cell-sub travel-note">{plan.spendNote}</p>}
            {plan.unidentifiedCount > 0 && (
              <p className="cell-sub">
                {plan.unidentifiedCount} rekening{plan.unidentifiedCount === 1 ? "" : "en"} zonder bank — die kunnen we
                niet opzoeken. Vul de bank in bij Rekeningen, of zet het type op Spaarrekening als het spaargeld is.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
