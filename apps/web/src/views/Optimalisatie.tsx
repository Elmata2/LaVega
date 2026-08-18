import { useEffect, useMemo, useState } from "react";
import type { Account, Tx, AccountRate, LearnedFact, OwnAccounts, Rule } from "@lavega/core";
import {
  accountLabel,
  accountReturns,
  isSpendable,
  optimiseReturns,
  MIN_SPEND_DAYS,
  detectSubscriptions,
  subscriptionPriceIncreases,
  subscriptionOverlaps,
  subscriptionCoverage,
  resolveHousingCost,
  analyzeInterest,
  CADENCE_LABEL_NL,
  NL_SAVINGS_RATES,
  RATES_AS_OF,
} from "@lavega/core";
import { createRatesProvider, type RatesResult } from "@lavega/adapters";
import { formatEuro } from "../format";
import Module from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import "../styles/views.css";

/* Optimalisatie — rebalanced (UI review, 2026-08-16).
 *
 * Two changes, both his words:
 *   1. "the reasoning must be explicit and end in a number" — every interest
 *      suggestion is now one sentence that names the account, its rate, the
 *      bank that pays more, and the euros per year that follow from it.
 *   2. subscriptions much larger, the savings-rate part smaller and the two
 *      roughly equal in weight — hence the two-column grid instead of a short
 *      subscriptions card above a rate card with three tables.
 *
 * The thin/empty subscriptions state is INFORMATIVE, not seeded: it counts what
 * LaVega actually saw in his own transactions and explains the pattern it looks
 * for. The worked example is behind a disclosure and labelled as an example; it
 * is never written to the vault. */

// Where to fetch the public rate benchmark. Set VITE_RATES_URL to your rates
// service; in dev it defaults to the local Hono server (run `pnpm dev:server`).
// Unset in prod => no fetch, offline snapshot. Only public data is requested.
const RATES_URL: string | undefined =
  import.meta.env.VITE_RATES_URL ?? (import.meta.env.DEV ? "http://localhost:8787/api/rates" : undefined);

const RATES_SOURCE_LABEL: Record<RatesResult["source"], string> = {
  live: "🟢 live opgehaald",
  cache: "uit cache",
  bundled: "offline momentopname",
};

type OptimalisatieProps = {
  txs: Tx[];
  accounts: Account[];
  /** Categorisation inputs — the housing cost is READ from the transactions
   *  (core's `resolveHousingCost`), and that needs the same rules and own-account
   *  set every other categorised view uses. */
  rules: Rule[];
  own: OwnAccounts;
  asOf: string;
  busy: boolean;
  /** What the agents have learned, for the cashback figures. Keyed by
   *  productOf(), the same key the travel agent uses. */
  facts: readonly LearnedFact[];
  onRateCommit: (key: string, value: string) => void;
};

const euro = (cents: number) => formatEuro(cents / 100);
const pct = (p: number) => `${p.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`;

const SOURCE_LABEL: Record<AccountRate["source"], string> = {
  manual: "handmatig",
  detected: "geschat uit rente",
  benchmark: "geschat via banktarief",
  assumed: "aangenomen 0%",
  unknown: "onbekend",
};

/** A worked example of the subscriptions table. Explicitly NOT his data: it is
 *  rendered behind a disclosure, labelled, and never saved anywhere. Seeding
 *  rows into the vault to make the block look full would put numbers he cannot
 *  trust next to numbers he can. */
const EXAMPLE_SUBS = [
  { name: "Netflix", fn: "Videostreaming", monthly: 1599, last: 1599, change: 0.14 },
  { name: "Spotify", fn: "Muziekstreaming", monthly: 1199, last: 1199, change: 0.09 },
  { name: "Adobe Creative Cloud", fn: "Software", monthly: 6899, last: 6899, change: 0 },
  { name: "Odido", fn: "Telecom", monthly: 3500, last: 3500, change: -0.05 },
] as const;

/** Editable rente-% cell. Holds a free-form draft while typing (so "1," etc.
 *  don't fight a number input) and commits on blur; blank clears the override
 *  back to auto (detected/assumed). */
function RateCell({ ar, busy, onCommit }: { ar: AccountRate; busy: boolean; onCommit: (key: string, value: string) => void }) {
  const initial = ar.source === "manual" && ar.ratePct !== null ? String(ar.ratePct) : "";
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  return (
    <input
      className="saldo-input"
      inputMode="decimal"
      placeholder={ar.ratePct === null ? "—" : `${ar.ratePct}`}
      aria-label={`Rente ${ar.account.name}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(ar.account.key, draft)}
      disabled={busy}
    />
  );
}

/** What LaVega actually saw in the outflows, so an empty subscriptions list is
 *  a measurement rather than a shrug. Nothing here is stored; it is counted off
 *  the transactions already on screen. */
function outflowFacts(txs: Tx[]) {
  const byMerchant = new Map<string, number>();
  let outflows = 0;
  let first = "";
  let last = "";
  for (const t of txs) {
    if (t.date && (first === "" || t.date < first)) first = t.date;
    if (t.date && t.date > last) last = t.date;
    if (t.amount >= 0) continue;
    outflows++;
    const key = t.counterparty.trim().toLowerCase();
    byMerchant.set(key, (byMerchant.get(key) ?? 0) + 1);
  }
  let repeated = 0;
  for (const n of byMerchant.values()) if (n >= 2) repeated++;
  return { outflows, merchants: byMerchant.size, repeated, first, last };
}

export default function Optimalisatie({ txs, accounts, rules, own, asOf, busy, facts, onRateCommit }: OptimalisatieProps) {
  const subs = useMemo(() => detectSubscriptions(txs), [txs]);
  const increases = useMemo(() => subscriptionPriceIncreases(subs), [subs]);
  const overlaps = useMemo(() => subscriptionOverlaps(subs), [subs]);
  const totalMonthlyCents = useMemo(() => subs.reduce((s, x) => s + x.monthlyCents, 0), [subs]);
  const seen = useMemo(() => outflowFacts(txs), [txs]);

  // Why a subscription can be MISSING. His Simeo is the case: a charge that
  // repeats every three months cannot be recognised in two months of statements,
  // no matter how the detector is tuned. Core measures which cadences the data
  // can carry at all (`subscriptionCoverage`) — this view only says it out loud,
  // so an empty list is a stated limit rather than a shrug.
  const coverage = useMemo(() => subscriptionCoverage(txs), [txs]);
  const cadenceName = (days: number) => CADENCE_LABEL_NL[days] ?? `elke ${days} dagen`;

  // Woonlasten read from the data instead of typed in. Core owns the whole
  // derivation (`resolveHousingCost`); the manual figure is `null` because there
  // is nowhere to type one — which is the point. `monthlyCents: null` means
  // LaVega does not know, and is printed as "onbekend", never as €0.
  const housing = useMemo(() => resolveHousingCost(null, txs, rules, own), [txs, rules, own]);

  // Fetch the public rate benchmark (live -> cache -> bundled). Starts from the
  // bundled snapshot so the tab renders instantly, then upgrades to live/cache.
  const provider = useMemo(() => createRatesProvider({ url: RATES_URL }), []);
  const [rates, setRates] = useState<RatesResult>({ rates: [...NL_SAVINGS_RATES], asOf: RATES_AS_OF, source: "bundled" });
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let alive = true;
    provider.getRates().then((r) => alive && setRates(r));
    return () => {
      alive = false;
    };
  }, [provider]);
  async function refreshRates() {
    setRefreshing(true);
    try {
      setRates(await provider.getRates());
    } finally {
      setRefreshing(false);
    }
  }

  const interest = useMemo(() => analyzeInterest(accounts, txs, rates.rates, asOf), [accounts, txs, rates, asOf]);
  // Why a suggestion might be empty: accounts missing a saldo (CSV imports) or a
  // known rente — surfaced in the guidance so the €0 isn't a dead end.
  const noSaldo = interest.accountRates.filter((a) => a.account.balance === null).length;
  const unknownRate = interest.accountRates.filter((a) => a.ratePct === null).length;

  // Two rates on two bases, from the accounts he already holds. Core owns the
  // whole derivation; this view only prints it.
  const returns = useMemo(
    () => accountReturns(accounts, txs, rules, own, facts, rates.rates, asOf),
    [accounts, txs, rules, own, facts, rates, asOf],
  );
  const { actions, gaps } = useMemo(() => optimiseReturns(returns), [returns]);
  const routing = actions.filter((a) => a.kind === "route-spending");
  const cashbackGaps = gaps.filter((g) => g.missing === "cashbackPct");
  // Why the module can be empty, in the order the reasons actually apply. "Je
  // betaalt al met de beste kaart" is only true when there IS a card and there
  // IS measured spending; printed over an empty vault it is advice that cannot
  // be true in the state it appears in.
  const spendable = returns.filter((r) => isSpendable(r.account));
  const rankable = spendable.filter((r) => r.cashbackPct !== null);
  const measured = rankable.filter((r) => r.spend.perYearCents !== null);
  // How the base was measured, so the figure can be checked against the same
  // afschrift it was read from rather than taken on trust.
  const spendOf = useMemo(() => new Map(returns.map((r) => [r.account.key, r.spend])), [returns]);

  return (
    <>
      <div className="view-head">
        <h2>Wat je geld laat liggen</h2>
        <span className="eyebrow">abonnementen &amp; rente</span>
      </div>

      <div className="kpi-row">
        <div className="kpi highlight">
          <div className="kpi-label">Abonnementen</div>
          <div className="kpi-value">{subs.length}</div>
          <div className="eyebrow">{euro(totalMonthlyCents)}/mnd</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Prijsstijgingen</div>
          <div className={`kpi-value ${increases.length > 0 ? "text-warn" : ""}`}>{increases.length}</div>
          <div className="eyebrow">herkend</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Dubbele functies</div>
          <div className={`kpi-value ${overlaps.length > 0 ? "text-warn" : ""}`}>{overlaps.length}</div>
          <div className="eyebrow">overlap</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Woonlasten</div>
          <div className="kpi-value">{housing.monthlyCents === null ? "onbekend" : euro(housing.monthlyCents)}</div>
          <div className="eyebrow">
            {housing.monthlyCents === null
              ? "niet in de data gezien"
              : `${housing.proposal?.kind ?? "wonen"} · uit je transacties`}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Rente laten liggen</div>
          <div className={`kpi-value ${interest.totalExtraPerYearCents > 0 ? "text-warn" : "text-pos"}`}>
            {euro(interest.totalExtraPerYearCents)}
          </div>
          <div className="eyebrow">per jaar</div>
        </div>
      </div>

      <ModuleGrid className="grid-2" label="Optimalisatie">
        {/* ── Abonnementen: de grote helft ──────────────────────────────── */}
        <Module
          title="Abonnementen"
          height="tall"
          footer={
            subs.length > 0 ? (
              <span>
                {subs.length} {subs.length === 1 ? "abonnement" : "abonnementen"} · samen {euro(totalMonthlyCents)} per
                maand, {euro(totalMonthlyCents * 12)} per jaar.
              </span>
            ) : (
              <span>Herkend uit je eigen transacties — er wordt niets bijverzonnen.</span>
            )
          }
        >
          {/* What the history can and cannot show, before anything is counted.
              A quarterly charge needs one full gap before there is a pattern at
              all, so with a short import "niets gevonden" and "kon niets vinden"
              are different answers — and only core knows which one this is. */}
          <p className="reason">
            {coverage.historyDays === 0 ? (
              "Nog geen uitgaande transacties, dus nog geen ritme om te herkennen."
            ) : (
              <>
                LaVega kijkt over <strong>{coverage.historyDays}</strong> dagen afschrift (
                {coverage.firstDate} – {coverage.lastDate}). Daarin is{" "}
                <strong>{coverage.visibleCadences.map(cadenceName).join(", ") || "geen enkel ritme"}</strong>{" "}
                herkenbaar.
                {coverage.hiddenCadences.length > 0 && (
                  <>
                    {" "}Nog niet:{" "}
                    {coverage.hiddenCadences
                      .map((h) => `${cadenceName(h.cadenceDays)} (vanaf ${h.needsDays} dagen)`)
                      .join(", ")}
                    . Een abonnement met zo'n ritme staat hier dus niet omdat de geschiedenis nog niet ver
                    genoeg terugloopt — niet omdat het er niet is.
                  </>
                )}
              </>
            )}
          </p>

          {/* The biggest recurring fixed cost there is, and he should not have
              to type it: core reads it off the same transactions. Never a
              number without the row it came from. */}
          {housing.source === "detected" && housing.proposal && housing.monthlyCents !== null && (
            <p className="reason">
              Je grootste vaste last is <strong>{housing.proposal.kind}</strong> aan{" "}
              <strong>{housing.proposal.counterparty}</strong>:{" "}
              <span className="reason-figure">{euro(housing.monthlyCents)}</span> per maand, gezien in{" "}
              {housing.proposal.occurrences} betalingen, laatst op {housing.proposal.lastDate}. Zelf invullen
              hoeft niet — dit komt uit je eigen afschriften.
            </p>
          )}

          {subs.length === 0 ? (
            <div className="empty-guide">
              <p>
                <strong>Nog geen abonnement herkend.</strong> Dat is een meting, geen leeg scherm:
                {seen.outflows === 0 ? (
                  " er staan nog geen uitgaande transacties in LaVega."
                ) : (
                  <>
                    {" "}LaVega zag <strong>{seen.outflows}</strong> uitgaande transacties
                    {seen.first && seen.last ? ` tussen ${seen.first} en ${seen.last}` : ""}, verdeeld over{" "}
                    <strong>{seen.merchants}</strong> ontvangers. Daarvan betaalde je er{" "}
                    <strong>{seen.repeated}</strong> minstens twee keer — en geen daarvan voldeed aan het patroon.
                  </>
                )}
              </p>
              <p className="cell-sub">Wat LaVega een abonnement noemt:</p>
              <ul>
                <li>minstens twee betalingen aan dezelfde ontvanger;</li>
                <li>een vast ritme: ongeveer maandelijks, per kwartaal of jaarlijks;</li>
                <li>een bedrag dat mag stijgen (dat is juist het signaal) maar niet wild springt;</li>
                <li>geen eigen overboeking of kaartafrekening.</li>
              </ul>
              <p className="cell-sub">
                Meestal ontbreekt de rekening waar ze vanaf gaan: importeer je creditcard of privérekening,
                dan verschijnen ze hier — inclusief prijsstijgingen en dubbele diensten.
              </p>
              <details className="demo-preview">
                <summary>Bekijk hoe dit eruitziet met gevulde data</summary>
                <p className="badge demo-flag">Voorbeeld — niet jouw data, en nergens opgeslagen</p>
                <div className="table-wrap table-cards">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Dienst</th>
                        <th>Functie</th>
                        <th className="num">Per maand</th>
                        <th className="num">Verandering</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_SUBS.map((s) => (
                        <tr key={s.name}>
                          <td data-label="Dienst" style={{ fontWeight: 600 }}>{s.name}</td>
                          <td data-label="Functie"><span className="badge">{s.fn}</span></td>
                          <td className="num" data-label="Per maand">{euro(s.monthly)}</td>
                          <td className={`num ${s.change > 0 ? "text-neg" : s.change < 0 ? "text-pos" : ""}`} data-label="Verandering">
                            {s.change === 0 ? "—" : `${s.change > 0 ? "+" : ""}${Math.round(s.change * 100)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ) : (
            <>
              {increases.length > 0 || overlaps.length > 0 ? (
                <div className="reason-list" style={{ marginBottom: "var(--sp-4)" }}>
                  {increases.map((p) => (
                    <p key={`inc-${p.sub.key}`} className="reason">
                      <strong>{p.sub.name}</strong> ging van {euro(p.fromCents)} naar {euro(p.toCents)} (+
                      {Math.round(p.changePct * 100)}%) — dat is{" "}
                      <span className="reason-figure text-warn">{euro((p.toCents - p.fromCents) * 12)}</span> per jaar
                      extra.
                    </p>
                  ))}
                  {overlaps.map((o) => (
                    <p key={`ov-${o.function}`} className="reason">
                      {o.subs.length} × <strong>{o.function}</strong>: {o.subs.map((s) => s.name).join(" + ")} — samen{" "}
                      {euro(o.monthlyCents)}/mnd. Eén opzeggen scheelt tot{" "}
                      <span className="reason-figure text-warn">
                        {euro(Math.max(...o.subs.map((s) => s.monthlyCents)) * 12)}
                      </span>{" "}
                      per jaar.
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="table-wrap table-cards">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Dienst</th>
                      <th>Functie</th>
                      <th className="num">Per maand</th>
                      <th className="num">Per jaar</th>
                      <th className="num">Verandering</th>
                      <th>Laatst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s) => (
                      <tr key={s.key}>
                        <td data-label="Dienst" style={{ fontWeight: 600 }}>{s.name}</td>
                        <td data-label="Functie">
                          <span className="badge">{s.function}</span>
                        </td>
                        <td className="num" data-label="Per maand">{euro(s.monthlyCents)}</td>
                        <td className="num" data-label="Per jaar">{euro(s.monthlyCents * 12)}</td>
                        <td data-label="Verandering" className={`num ${s.changePct > 0 ? "text-neg" : s.changePct < 0 ? "text-pos" : ""}`}>
                          {s.changePct === 0 ? "—" : `${s.changePct > 0 ? "+" : ""}${Math.round(s.changePct * 100)}%`}
                        </td>
                        <td className="cell-sub" data-label="Laatst">{s.lastDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Module>

        {/* ── Rente: de kleinere helft, maar met de redenering uitgeschreven ── */}
        <Module
          title="Rente"
          height="tall"
          footer={
            interest.best ? (
              <span>
                Beste vrij opneembare rente die LaVega kent: {interest.best.bank} {pct(interest.best.ratePct)} ·{" "}
                {RATES_SOURCE_LABEL[rates.source]}, peildatum {rates.asOf}.
              </span>
            ) : (
              <span>Geen vergelijkingsrente beschikbaar.</span>
            )
          }
        >
          {interest.suggestions.length > 0 && interest.best ? (
            <>
              <p className="reason-lead">
                Verplaatsen levert je <strong>{euro(interest.totalExtraPerYearCents)}</strong> per jaar op.
              </p>
              <div className="reason-list">
                {interest.suggestions.map((s) => (
                  <p key={`sug-${s.account.key}`} className="reason">
                    Je houdt <strong>{euro(s.balanceCents)}</strong> aan bij {accountLabel(s.account)} tegen{" "}
                    {pct(s.ratePct)}; {interest.best!.bank} betaalt {pct(interest.best!.ratePct)} — dat verschil van{" "}
                    {pct(Math.round((interest.best!.ratePct - s.ratePct) * 100) / 100)} is{" "}
                    <span className="reason-figure text-warn">{euro(s.extraPerYearCents)}</span> per jaar.
                  </p>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-guide">
              <p>
                <strong>Nog geen rentewinst berekend.</strong> Per rekening heeft LaVega een <em>saldo</em> én een{" "}
                <em>rente %</em> nodig; een van beide onbekend betekent geen bedrag, geen aanname.
              </p>
              <ul>
                {noSaldo > 0 && <li>{noSaldo} rekening{noSaldo > 1 ? "en" : ""} zonder saldo — vul dat in bij Rekeningen.</li>}
                {unknownRate > 0 && <li>{unknownRate} rekening{unknownRate > 1 ? "en" : ""} zonder rente — zet de Rente % hieronder.</li>}
                {noSaldo === 0 && unknownRate === 0 && <li>Je saldi staan al op de beste plek die LaVega kent.</li>}
              </ul>
            </div>
          )}

          <div className="table-wrap table-cards" style={{ marginTop: "var(--sp-4)" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Rekening</th>
                  <th className="num">Saldo</th>
                  <th className="num">Rente %</th>
                  <th>Bron</th>
                  <th className="num">
                    Mogelijk/jr{interest.best ? ` vs ${pct(interest.best.ratePct)}` : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {interest.accountRates.map((ar) => {
                  const gain =
                    interest.best && ar.ratePct !== null && ar.balanceCents > 0 && interest.best.ratePct - ar.ratePct > 0.1
                      ? Math.round((ar.balanceCents * (interest.best.ratePct - ar.ratePct)) / 100)
                      : 0;
                  return (
                    <tr key={ar.account.key}>
                      <td data-label="Rekening">
                        <div style={{ fontWeight: 600 }}>{ar.account.bank || ar.account.name}</div>
                        <div className="cell-sub">{ar.account.name}</div>
                      </td>
                      <td className="num" data-label="Saldo">{ar.account.balance === null ? "onbekend" : euro(ar.balanceCents)}</td>
                      <td className="num" data-label="Rente %">
                        <RateCell ar={ar} busy={busy} onCommit={onRateCommit} />
                      </td>
                      <td className="cell-sub" data-label="Bron">{SOURCE_LABEL[ar.source]}</td>
                      <td className="num" data-label="Mogelijk/jr">{gain > 0 ? <span className="text-warn">+{euro(gain)}</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <details className="rates-benchmark">
            <summary className="eyebrow">
              Vergelijkingsrentes ({rates.rates.length} banken) · {RATES_SOURCE_LABEL[rates.source]} · peildatum {rates.asOf}
            </summary>
            <div className="table-wrap table-cards">
              <table className="table">
                <thead>
                  <tr>
                    <th>Bank</th>
                    <th className="num">Rente nu</th>
                    <th className="num">Standaard</th>
                    <th>Actie</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.rates.map((r) => (
                    <tr key={`${r.bank}-${r.product}`}>
                      <td data-label="Bank">
                        <div style={{ fontWeight: 600 }}>{r.bank}</div>
                        <div className="cell-sub">{r.product}</div>
                      </td>
                      <td className="num text-pos" data-label="Rente nu">{pct(r.ratePct)}</td>
                      <td className="num cell-sub" data-label="Standaard">
                        {r.standardRatePct !== undefined && r.standardRatePct !== r.ratePct ? pct(r.standardRatePct) : "—"}
                      </td>
                      <td data-label="Actie">{r.promoNote ? <span className="badge">🎁 {r.promoNote}</span> : <span className="cell-sub">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="eyebrow">
              "Rente nu" is inclusief actietarieven (vaak alleen voor nieuwe klanten); "standaard" is het tarief ná de
              actie. Bron: {RATES_SOURCE_LABEL[rates.source]} via geld.nl (peildatum {rates.asOf}).{" "}
              <button type="button" className="card-link" onClick={() => void refreshRates()} disabled={refreshing}>
                {refreshing ? "verversen…" : "ververs rentes"}
              </button>
              . Alleen publieke rentes worden opgehaald — je eigen saldi/rentes blijven lokaal.{" "}
              {rates.source !== "live" && "Voor live tarieven: start de rente-service (pnpm dev:server)."}
            </p>
          </details>
        </Module>

        {/* ── Cashback: dezelfde vraag, maar op wat je uitgeeft ──────────── */}
        <Module
          span={2}
          title="Cashback"
          footer={<span>Percentages gelden op wat je uitgeeft, niet op je saldo.</span>}
        >
          {routing.length === 0 && cashbackGaps.length === 0 && (
            <p className="block-empty">
              {spendable.length === 0
                ? "Nog geen betaalrekening of creditcard in beeld — er is dus nog niets om mee te vergelijken."
                : rankable.length >= 2 && measured.length === 0
                  ? `LaVega kent de cashback van je kaarten, maar heeft nog te weinig afschrift om te zien wat je ermee uitgeeft (minimaal ${MIN_SPEND_DAYS} dagen). Zonder die basis is er een percentage, maar geen bedrag.`
                  : "Je betaalt al met de kaart die het meeste teruggeeft."}
            </p>
          )}
          {routing.map((a) => {
            const base = spendOf.get(a.from.key);
            return (
              <div className="reason-list" key={a.from.key + a.to.key}>
                <div className="position-row">
                  <span>
                    Betaal met <strong>{a.to.bank}</strong> in plaats van {a.from.bank} — {pct(a.toPct)} tegen{" "}
                    {pct(a.fromPct)}.
                  </span>
                  <span className="text-pos">
                    {a.approximate ? "tot " : ""}
                    {euro(a.gainPerYearCents)} per jaar
                  </span>
                </div>
                {/* Where the euros come from. "tot" is not a hedge for its own
                    sake: on a betaalrekening the base still has rent and
                    incasso's inside it, so the figure is the most it could be
                    and the sentence has to say why. */}
                <p className="cell-sub">
                  Gerekend over {a.approximate ? "maximaal " : ""}
                  {euro(a.baseCents)} aan uitgaven per jaar
                  {base ? `, gemeten over ${base.observedDays} dagen afschrift` : ""}.
                  {a.approximate &&
                    " Je bank zegt er niet bij of een afschrijving een kaartbetaling of een incasso was — huur en incasso's zitten er dus nog in."}
                </p>
              </div>
            );
          })}
          {cashbackGaps.length > 0 && (
            <p className="cell-sub">
              Cashback onbekend voor {cashbackGaps.map((g) => g.product).join(", ")}. Vul het zelf in bij het
              reisblok — wat jij invult wordt nooit overschreven.
            </p>
          )}
        </Module>
      </ModuleGrid>
    </>
  );
}
