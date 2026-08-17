import { useEffect, useMemo, useState } from "react";
import type { Account, FxRate, Journey, LearnedFact } from "@lavega/core";
import {
  FX_RATE_FALLBACK,
  accountLabel,
  crossRate,
  journeyHeadline,
  parseFxRatePayload,
  rankJourneys,
} from "@lavega/core";
import { API_BASE } from "../api";
import Module, { ModuleMenu } from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import "../styles/views.css";

/* Valuta — rebuilt around the reference's "Transfer money" block
 * (Modules for homescreen example.png): from account, to account, an amount,
 * currency pills, and what actually ARRIVES.
 *
 * The pricing is NOT re-derived here. `rankJourneys` / `journeyHeadline` in
 * packages/core/src/travel.ts already rank every way of moving money through
 * the cards he actually holds, and this view calls them. A second calculation
 * would eventually disagree with the travel block, and then neither number
 * could be trusted.
 *
 * The rule that shapes the whole screen: an unknown cost is NOT zero. When no
 * route has known terms, "wat er aankomt" stays "onbekend" — the mid-market
 * amount is shown separately and clearly labelled as the market value, never as
 * the amount that lands. */

type ValutaProps = {
  accounts: Account[];
  /** Learned card/route terms from the vault (same store the travel block
   *  uses). Optional so the shell keeps compiling while it is wired through;
   *  absent means "we know no terms", which is exactly what the UI then says. */
  facts?: readonly LearnedFact[];
};

const NO_ACCOUNT = "";

function fmt(n: number, ccy: string): string {
  try {
    return new Intl.NumberFormat("nl-NL", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n);
  } catch {
    // A currency code Intl doesn't know: still show the number, never a blank.
    return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 2 })} ${ccy}`;
  }
}

const pctText = (p: number) => `${p.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`;

/** One ranked route, in the same shape the travel block prints them. */
function JourneyRow({ j, best }: { j: Journey; best: boolean }) {
  return (
    <li className={`travel-journey${best ? " travel-journey-best" : ""}${j.known ? "" : " travel-journey-unknown"}`}>
      <div className="travel-journey-head">
        <span className="travel-journey-name">
          {j.via === null ? `Direct met ${j.provider}` : `Via ${j.via}${j.fundedFrom ? ` (vanaf ${j.fundedFrom})` : ""}`}
        </span>
        <span className="travel-journey-cost">
          {j.totalCostPct === null ? "kosten onbekend" : pctText(j.totalCostPct)}
        </span>
      </div>
      <p className="cell-sub" style={{ margin: 0 }}>{j.why}</p>
    </li>
  );
}

export default function Valuta({ accounts, facts = [] }: ValutaProps) {
  const [rate, setRate] = useState<FxRate>(FX_RATE_FALLBACK);
  const [source, setSource] = useState<"live" | "offline">("offline");
  const [amount, setAmount] = useState("1000");
  const [from, setFrom] = useState("EUR");
  const [to, setTo] = useState("USD");
  const [fromKey, setFromKey] = useState(NO_ACCOUNT);
  const [toKey, setToKey] = useState(NO_ACCOUNT);
  const [showInfo, setShowInfo] = useState(false);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let ok = true;
    void fetch(`${API_BASE}/api/fx/rate`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const parsed = parseFxRatePayload(j);
        if (ok && parsed) {
          setRate(parsed);
          setSource("live");
        }
      })
      .catch(() => {/* keep fallback */});
    return () => { ok = false; };
  }, []);

  const currencies = useMemo(
    () => [rate.base, ...Object.keys(rate.rates)].filter((v, i, a) => a.indexOf(v) === i).sort(),
    [rate],
  );

  const byKey = useMemo(() => new Map(accounts.map((a) => [a.key, a])), [accounts]);
  const fromAcc = fromKey ? byKey.get(fromKey) ?? null : null;
  const toAcc = toKey ? byKey.get(toKey) ?? null : null;

  const amt = Number(amount.replace(",", ".")) || 0;

  const mid = useMemo(() => {
    try {
      return crossRate(from, to, rate);
    } catch {
      return null;
    }
  }, [from, to, rate]);

  // THE pricing. One call into core, the same one the travel block makes.
  const journeys = useMemo(() => rankJourneys(accounts, facts), [accounts, facts]);
  const best = useMemo(() => journeys.find((j) => j.known) ?? null, [journeys]);

  const sameCurrency = from === to;
  // No conversion means no conversion cost — that is a fact, not an assumption.
  // Otherwise the cost is the best KNOWN route's; unknown stays unknown.
  const costPct = sameCurrency ? 0 : best?.totalCostPct ?? null;
  const grossReceived = mid !== null ? amt * mid : null;
  const netReceived = grossReceived !== null && costPct !== null ? grossReceived * (1 - costPct / 100) : null;
  const costInFrom = costPct !== null ? (amt * costPct) / 100 : null;

  const headline = sameCurrency
    ? "Zelfde valuta — er wordt niets omgewisseld."
    : journeyHeadline(journeys, from === "EUR" ? to : from);

  const unknownProviders = useMemo(
    () => [...new Set(journeys.filter((j) => !j.known).map((j) => j.provider).filter(Boolean))],
    [journeys],
  );

  /** Selecting an account sets the leg's currency to that account's own — the
   *  currency of the money is a property of the account, not a free choice. */
  function pickFrom(key: string) {
    setFromKey(key);
    const c = key ? byKey.get(key)?.currency : undefined;
    if (c && /^[A-Za-z]{3}$/.test(c)) setFrom(c.toUpperCase());
  }
  function pickTo(key: string) {
    setToKey(key);
    const c = key ? byKey.get(key)?.currency : undefined;
    if (c && /^[A-Za-z]{3}$/.test(c)) setTo(c.toUpperCase());
  }
  function swap() {
    setFrom(to);
    setTo(from);
    setFromKey(toKey);
    setToKey(fromKey);
  }

  const available = (a: Account | null) =>
    a === null ? "—" : a.balance === null ? "onbekend" : fmt(a.balance, a.currency || "EUR");

  return (
    <>
      <div className="view-head">
        <h2>Geld overzetten</h2>
        <span className="eyebrow">live ECB-middenkoers · kosten van je eigen kaarten</span>
      </div>

      <ModuleGrid className="grid-2" label="Valuta">
        <Module
          title="Overzetten"
          height="tall"
          menu={
            <>
              <button
                type="button"
                className="module-info"
                aria-label="Uitleg bij dit bedrag"
                aria-expanded={showInfo}
                title="Uitleg bij dit bedrag"
                onClick={() => setShowInfo((v) => !v)}
              >
                <span aria-hidden="true">i</span>
              </button>
              <ModuleMenu label="Koersbron" onClick={() => setShowSource((v) => !v)} />
            </>
          }
        >
          <div className="xfer">
            <div className="xfer-leg">
              <div className="xfer-leg-head">
                <span className="xfer-leg-label">Van rekening</span>
                <select className="xfer-account" aria-label="Van rekening" value={fromKey} onChange={(e) => pickFrom(e.target.value)}>
                  <option value={NO_ACCOUNT}>geen rekening gekozen</option>
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>{accountLabel(a)}</option>
                  ))}
                </select>
              </div>
              <div className="xfer-amount-row">
                <input
                  className="xfer-amount"
                  type="number"
                  step={0.01}
                  min={0}
                  value={amount}
                  aria-label="Bedrag"
                  onChange={(e) => setAmount(e.target.value)}
                />
                <select className="xfer-ccy" aria-label="Van valuta" value={from} onChange={(e) => setFrom(e.target.value)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="xfer-foot">
                <span>Beschikbaar</span>
                <span>{available(fromAcc)}</span>
              </div>
            </div>

            <button type="button" className="xfer-swap" aria-label="Wissel van en naar" onClick={swap}>
              <span aria-hidden="true">⇅</span>
            </button>

            <div className="xfer-leg">
              <div className="xfer-leg-head">
                <span className="xfer-leg-label">Naar rekening</span>
                <select className="xfer-account" aria-label="Naar rekening" value={toKey} onChange={(e) => pickTo(e.target.value)}>
                  <option value={NO_ACCOUNT}>geen rekening gekozen</option>
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>{accountLabel(a)}</option>
                  ))}
                </select>
              </div>
              <div className="xfer-amount-row">
                <span className={`xfer-out${netReceived === null ? " xfer-out-unknown" : ""}`} data-testid="arrives">
                  {netReceived === null ? "onbekend" : fmt(netReceived, to)}
                </span>
                <select className="xfer-ccy" aria-label="Naar valuta" value={to} onChange={(e) => setTo(e.target.value)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="xfer-foot">
                <span>Komt aan na kosten · beschikbaar</span>
                <span>{available(toAcc)}</span>
              </div>
            </div>
          </div>

          <p className="reason" style={{ marginTop: "var(--sp-4)" }}>
            {netReceived === null ? (
              <>
                <strong>Wat er aankomt is onbekend.</strong>{" "}
                {mid === null
                  ? `LaVega heeft geen koers voor ${from} → ${to}.`
                  : (
                    <>
                      Tegen de middenkoers is dit {fmt(grossReceived ?? 0, to)} waard, maar de kosten van je
                      eigen kaarten zijn nog niet bekend — en LaVega rekent een onbekende kostenpost niet als
                      nul. Het reisblok op Overzicht laat zien wat er nog mist en of het hier op te zoeken is.
                    </>
                  )}
              </>
            ) : (
              <>
                Je zet <span className="reason-figure">{fmt(amt, from)}</span> over,{" "}
                {sameCurrency ? (
                  <>zonder omwisseling. Er komt <span className="reason-figure">{fmt(netReceived, to)}</span> aan.</>
                ) : (
                  <>
                    tegen middenkoers {mid?.toFixed(4)} is dat {fmt(grossReceived ?? 0, to)}. Je beste eigen route
                    kost {pctText(costPct ?? 0)} ({fmt(costInFrom ?? 0, from)}), dus er komt{" "}
                    <span className="reason-figure">{fmt(netReceived, to)}</span> aan.
                  </>
                )}
              </>
            )}
          </p>

          {showSource && (
            <div className="info-panel">
              <p>
                <strong>Koers:</strong> {source === "live" ? `live ECB-middenkoers via Frankfurter, peildatum ${rate.date}` : `offline momentopname van ${rate.date}`}.
              </p>
              <p>Er wordt niets over je rekeningen verstuurd om die koers op te halen.</p>
            </div>
          )}

          {showInfo && (
            <div className="info-panel">
              <p>
                <strong>Dit is het beste dat je eigen kaarten toelaten.</strong> LaVega rangschikt alleen
                routes via producten die je zelf hebt — een aanbieder die je niet hebt, staat hier niet in
                en wordt hier ook niet geprijsd.
              </p>
              <p>{headline}</p>
              {costPct === null ? (
                <p>
                  Zolang de voorwaarden van je kaarten onbekend zijn, kan LaVega niet zeggen of overstappen
                  loont. Een onbekend tarief is geen 0%.
                </p>
              ) : (
                <p>
                  <strong>Waar overstappen je zou verslaan:</strong> je beste eigen route kost{" "}
                  {pctText(costPct)}. Elke aanbieder die minder dan {pctText(costPct)} rekent, houdt op dit
                  bedrag meer dan {fmt(costInFrom ?? 0, from)} voor je over. Wat een specifieke aanbieder
                  vandaag rekent, weet LaVega niet uit zichzelf — vraag het de assistent, die zoekt het live op.
                </p>
              )}
              {unknownProviders.length > 0 && (
                <p className="cell-sub">
                  Zonder bekende voorwaarden, dus niet meegerangschikt: {unknownProviders.join(", ")}.
                </p>
              )}
            </div>
          )}
        </Module>

        <Module title="Routes via je eigen kaarten" height="tall" footer={<span>Onbekende kosten staan onderaan — nooit als 0% bovenaan.</span>}>
          {journeys.length === 0 ? (
            <div className="empty-guide">
              <p>Nog geen route te rangschikken.</p>
              <ul>
                <li>Een route ontstaat uit een betaalrekening of creditcard mét bekende bank.</li>
                <li>Rekeningen zonder bank kunnen niet opgezocht worden en tellen niet mee.</li>
                {/* Deliberately NOT "klik op Ververs voorwaarden": dat knopje bestaat
                    juist in deze situatie vaak niet. Het reisblok toont geen zoekknop
                    als de server geen AI-sleutel heeft of als er geen kaart met bank is
                    — dan zou verversen niets doen. Het blok zegt zelf welke van die
                    gevallen het is, dus we verwijzen ernaar in plaats van een handeling
                    voor te schrijven die hier kan mislukken. */}
                <li>
                  De voorwaarden zelf komen uit het reisblok op Overzicht. Dat blok zegt erbij of
                  opzoeken hier mogelijk is — en zo niet, waarom niet.
                </li>
              </ul>
            </div>
          ) : (
            <ul className="travel-journeys">
              {journeys.map((j) => (
                <JourneyRow key={`${j.provider}-${j.via ?? "direct"}`} j={j} best={j === best} />
              ))}
            </ul>
          )}
        </Module>
      </ModuleGrid>
    </>
  );
}
