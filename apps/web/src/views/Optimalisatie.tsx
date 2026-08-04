import { useEffect, useMemo, useState } from "react";
import type { Account, Tx, AccountRate } from "@lavega/core";
import {
  detectSubscriptions,
  subscriptionPriceIncreases,
  subscriptionOverlaps,
  analyzeInterest,
  NL_SAVINGS_RATES,
  RATES_AS_OF,
} from "@lavega/core";
import { createRatesProvider, type RatesResult } from "@lavega/adapters";
import { formatEuro } from "../format";

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
  asOf: string;
  busy: boolean;
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

export default function Optimalisatie({ txs, accounts, asOf, busy, onRateCommit }: OptimalisatieProps) {
  const subs = useMemo(() => detectSubscriptions(txs), [txs]);
  const increases = useMemo(() => subscriptionPriceIncreases(subs), [subs]);
  const overlaps = useMemo(() => subscriptionOverlaps(subs), [subs]);
  const totalMonthlyCents = useMemo(() => subs.reduce((s, x) => s + x.monthlyCents, 0), [subs]);

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

  return (
    <>
      <div className="kpi-row">
        <div className="kpi">
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
        <div className="kpi highlight">
          <div className="kpi-label">Rente laten liggen</div>
          <div className={`kpi-value ${interest.totalExtraPerYearCents > 0 ? "text-warn" : "text-pos"}`}>
            {euro(interest.totalExtraPerYearCents)}
          </div>
          <div className="eyebrow">per jaar</div>
        </div>
      </div>

      <section className="card" aria-label="Abonnementen">
        <h2>Abonnementen</h2>
        {subs.length === 0 ? (
          <p>
            Nog geen abonnementen herkend. Importeer bijv. je creditcard- of privérekening met terugkerende
            betalingen (Netflix, Spotify, telecom…) — dan verschijnen ze hier, inclusief prijsstijgingen en dubbele diensten.
          </p>
        ) : (
          <>
            {increases.map((p) => (
              <p key={`inc-${p.sub.key}`} className="text-warn">
                📈 <strong>{p.sub.name}</strong> ging omhoog: {euro(p.fromCents)} → {euro(p.toCents)} (+
                {Math.round(p.changePct * 100)}%).
              </p>
            ))}
            {overlaps.map((o) => (
              <p key={`ov-${o.function}`} className="text-warn">
                ♻️ {o.subs.length} × <strong>{o.function}</strong>: {o.subs.map((s) => s.name).join(" + ")} — samen{" "}
                {euro(o.monthlyCents)}/mnd. Er eentje opzeggen?
              </p>
            ))}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Dienst</th>
                    <th>Functie</th>
                    <th className="num">Per maand</th>
                    <th className="num">Laatste bedrag</th>
                    <th className="num">Verandering</th>
                    <th>Laatst</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.key}>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td>
                        <span className="badge">{s.function}</span>
                      </td>
                      <td className="num">{euro(s.monthlyCents)}</td>
                      <td className="num">{euro(s.lastAmountCents)}</td>
                      <td className={`num ${s.changePct > 0 ? "text-neg" : s.changePct < 0 ? "text-pos" : ""}`}>
                        {s.changePct === 0 ? "—" : `${s.changePct > 0 ? "+" : ""}${Math.round(s.changePct * 100)}%`}
                      </td>
                      <td className="cell-sub">{s.lastDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card" aria-label="Rente-optimalisatie">
        <div className="card-header">
          <h2>Rente-optimalisatie</h2>
          {interest.best && (
            <span className="eyebrow">
              beste vrij opneembaar: {interest.best.bank} {pct(interest.best.ratePct)}
            </span>
          )}
        </div>

        {interest.suggestions.length > 0 && interest.best ? (
          <>
            <p className="text-warn">
              💰 Je laat ~<strong>{euro(interest.totalExtraPerYearCents)}/jaar</strong> liggen. Bij {interest.best.bank} (
              {pct(interest.best.ratePct)}):
            </p>
            {interest.suggestions.map((s) => (
              <p key={`sug-${s.account.key}`} className="cell-sub">
                {s.account.bank} {s.account.name}: {euro(s.balanceCents)} op {pct(s.ratePct)} → +
                {euro(s.extraPerYearCents)}/jaar
              </p>
            ))}
          </>
        ) : (
          <p>
            Nog geen rente-winst berekend. Dat komt omdat ik per rekening een <strong>saldo</strong> én een{" "}
            <strong>rente %</strong> nodig heb.
            {noSaldo > 0 && ` ${noSaldo} rekening${noSaldo > 1 ? "en" : ""} zonder saldo — vul in bij Rekeningen.`}
            {unknownRate > 0 &&
              ` ${unknownRate} rekening${unknownRate > 1 ? "en" : ""} zonder rente — zet de Rente % hieronder (betaalrekeningen reken ik als 0%).`}
          </p>
        )}

        <div className="table-wrap">
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
                    <td>
                      <div style={{ fontWeight: 600 }}>{ar.account.bank || ar.account.name}</div>
                      <div className="cell-sub">{ar.account.name}</div>
                    </td>
                    <td className="num">{ar.account.balance === null ? "—" : euro(ar.balanceCents)}</td>
                    <td className="num">
                      <RateCell ar={ar} busy={busy} onCommit={onRateCommit} />
                    </td>
                    <td className="cell-sub">{SOURCE_LABEL[ar.source]}</td>
                    <td className="num">{gain > 0 ? <span className="text-warn">+{euro(gain)}</span> : "—"}</td>
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
          <div className="table-wrap">
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
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.bank}</div>
                      <div className="cell-sub">{r.product}</div>
                    </td>
                    <td className="num text-pos">{pct(r.ratePct)}</td>
                    <td className="num cell-sub">
                      {r.standardRatePct !== undefined && r.standardRatePct !== r.ratePct ? pct(r.standardRatePct) : "—"}
                    </td>
                    <td>{r.promoNote ? <span className="badge">🎁 {r.promoNote}</span> : <span className="cell-sub">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <p className="eyebrow">
          "Rente nu" is inclusief actietarieven (vaak alleen voor nieuwe klanten); "standaard" is het tarief ná de
          actie. Bron: {RATES_SOURCE_LABEL[rates.source]} via geld.nl (peildatum {rates.asOf}).{" "}
          <button type="button" className="card-link" onClick={() => void refreshRates()} disabled={refreshing}>
            {refreshing ? "verversen…" : "ververs rentes"}
          </button>
          . Alleen publieke rentes worden opgehaald — je eigen saldi/rentes blijven lokaal.{" "}
          {rates.source !== "live" && "Voor live tarieven: start de rente-service (pnpm dev:server)."}
        </p>
      </section>
    </>
  );
}
