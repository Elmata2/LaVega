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
import { formatEuro } from "../format";

type OptimisatieProps = {
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

export default function Optimisatie({ txs, accounts, asOf, busy, onRateCommit }: OptimisatieProps) {
  const subs = useMemo(() => detectSubscriptions(txs), [txs]);
  const increases = useMemo(() => subscriptionPriceIncreases(subs), [subs]);
  const overlaps = useMemo(() => subscriptionOverlaps(subs), [subs]);
  const totalMonthlyCents = useMemo(() => subs.reduce((s, x) => s + x.monthlyCents, 0), [subs]);
  const interest = useMemo(() => analyzeInterest(accounts, txs, NL_SAVINGS_RATES, asOf), [accounts, txs, asOf]);

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
          <p>Geen duidelijke rente-winst gevonden (of saldi/rentes nog onbekend — vul ze hieronder in).</p>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rekening</th>
                <th className="num">Saldo</th>
                <th className="num">Rente %</th>
                <th>Bron</th>
              </tr>
            </thead>
            <tbody>
              {interest.accountRates.map((ar) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="rates-benchmark">
          <summary className="eyebrow">Vergelijkingsrentes (indicatief · peildatum {RATES_AS_OF})</summary>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Bank</th>
                  <th>Product</th>
                  <th className="num">Rente</th>
                </tr>
              </thead>
              <tbody>
                {NL_SAVINGS_RATES.map((r) => (
                  <tr key={`${r.bank}-${r.product}`}>
                    <td>{r.bank}</td>
                    <td className="cell-sub">{r.product}</td>
                    <td className="num">{pct(r.ratePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <p className="eyebrow">
          Rentes zijn een offline momentopname (peildatum {RATES_AS_OF}) — controleer actuele tarieven zelf. Live
          ophalen volgt zodra de rentebron is aangesloten. Je eigen saldi/rentes blijven lokaal.
        </p>
      </section>
    </>
  );
}
