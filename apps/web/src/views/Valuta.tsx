import { useEffect, useMemo, useState } from "react";
import type { Account } from "@lavega/core";
import { FX_ROUTES, FX_ROUTES_AS_OF, FX_RATE_FALLBACK, crossRate, parseFxRatePayload, rankRoutes } from "@lavega/core";
import type { FxRate, FxRoute } from "@lavega/core";
import { API_BASE } from "../api";

/** Which route providers the user likely already holds, by matching each
 *  account's bank name against the provider label (token contains). Lets the
 *  UI flag "in bezit" so the owner can prefer a route they can use today. */
export function ownedProviders(accounts: Account[], routes: readonly FxRoute[]): Set<string> {
  const banks = accounts.map((a) => (a.bank || "").toLowerCase()).filter(Boolean);
  const owned = new Set<string>();
  for (const r of routes) {
    const label = r.provider.toLowerCase();
    if (banks.some((b) => b.length > 2 && (label.includes(b) || b.includes(label.split(" ")[0])))) {
      owned.add(r.provider);
    }
  }
  return owned;
}

export default function Valuta({ accounts }: { accounts: Account[] }) {
  const [rate, setRate] = useState<FxRate>(FX_RATE_FALLBACK);
  const [source, setSource] = useState<"live" | "offline">("offline");
  const [amount, setAmount] = useState("1000");
  const [from, setFrom] = useState("EUR");
  const [to, setTo] = useState("USD");

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
  const owned = useMemo(() => ownedProviders(accounts, FX_ROUTES), [accounts]);
  const foreignHoldings = useMemo(
    () => [...new Set(accounts.map((a) => a.currency).filter((c) => c && c !== "EUR"))],
    [accounts],
  );
  const amt = Number(amount.replace(",", ".")) || 0;
  const results = useMemo(() => {
    try {
      return rankRoutes(amt, from, to, rate);
    } catch {
      return [];
    }
  }, [amt, from, to, rate]);
  const mid = useMemo(() => {
    try {
      return crossRate(from, to, rate);
    } catch {
      return null;
    }
  }, [from, to, rate]);

  const fmt = (n: number, ccy: string) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n);

  return (
    <section className="card" aria-label="Valuta">
      <div className="card-header">
        <h2>Valuta</h2>
        <span className="eyebrow">beste wisselroute</span>
      </div>
      <p className="cell-sub">
        Vergelijk wat je overhoudt bij het omwisselen van valuta. Middenkoers via de ECB
        (Frankfurter); de kosten per aanbieder zijn <strong>indicatief</strong> (peildatum {FX_ROUTES_AS_OF}).
        Er wordt niets over je rekeningen verstuurd.
      </p>

      {foreignHoldings.length > 0 && (
        <p className="cell-sub">Je hebt saldi in: {foreignHoldings.join(", ")}.</p>
      )}

      <div className="facturen-form">
        <label>Bedrag{" "}
          <input className="saldo-input" type="number" step={0.01} min={0} value={amount}
            aria-label="Bedrag" onChange={(e) => setAmount(e.target.value)} />
        </label>{" "}
        <label>Van{" "}
          <select value={from} aria-label="Van valuta" onChange={(e) => setFrom(e.target.value)}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>{" "}
        <label>Naar{" "}
          <select value={to} aria-label="Naar valuta" onChange={(e) => setTo(e.target.value)}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <p className="eyebrow" style={{ marginTop: "var(--sp-3)" }}>
        Middenkoers: 1 {from} = {mid ? mid.toFixed(4) : "—"} {to}
      </p>

      {results.length === 0 ? (
        <p>Kies geldige valuta.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Aanbieder</th><th>Effectieve koers</th><th>Je ontvangt</th><th>Kosten vs midden</th><th></th></tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={r.provider}>
                  <td>
                    {r.provider}
                    {owned.has(r.provider) ? <span className="badge" style={{ marginLeft: "var(--sp-1)" }}>in bezit</span> : null}
                    {r.note ? <span className="cell-sub"> · {r.note}</span> : null}
                  </td>
                  <td>{r.effectiveRate.toFixed(4)}</td>
                  <td className={i === 0 ? "text-pos" : ""}>{fmt(r.netReceived, to)}</td>
                  <td>{r.totalCostPct.toFixed(2)}%</td>
                  <td>{i === 0 ? <span className="badge">beste</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cell-sub" style={{ marginTop: "var(--sp-2)" }}>
        Koersbron: {source === "live" ? `live (ECB, ${rate.date})` : "offline snapshot"}.
      </p>
    </section>
  );
}
