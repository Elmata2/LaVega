import { useEffect, useMemo, useState } from "react";
import type { Account } from "@lavega/core";
import { FX_RATE_FALLBACK, crossRate, parseFxRatePayload } from "@lavega/core";
import type { FxRate } from "@lavega/core";
import { API_BASE } from "../api";

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
  const foreignHoldings = useMemo(
    () => [...new Set(accounts.map((a) => a.currency).filter((c) => c && c !== "EUR"))],
    [accounts],
  );
  const amt = Number(amount.replace(",", ".")) || 0;
  const mid = useMemo(() => {
    try {
      return crossRate(from, to, rate);
    } catch {
      return null;
    }
  }, [from, to, rate]);
  const received = mid !== null ? amt * mid : null;

  const fmt = (n: number, ccy: string) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n);

  return (
    <section className="card" aria-label="Valuta">
      <div className="card-header">
        <h2>Valuta</h2>
        <span className="eyebrow">live wisselkoers</span>
      </div>
      <p className="cell-sub">
        Reken om tegen de live middenkoers van de ECB (via Frankfurter). Er wordt niets
        over je rekeningen verstuurd.
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

      <p style={{ marginTop: "var(--sp-2)" }}>
        Je ontvangt ≈ {received !== null ? fmt(received, to) : "—"}
      </p>

      <p className="cell-sub" style={{ marginTop: "var(--sp-2)" }}>
        Koersbron: {source === "live" ? `live (ECB, ${rate.date})` : "offline snapshot"}.
      </p>

      <p className="cell-sub" style={{ marginTop: "var(--sp-2)" }}>
        Voor de goedkoopste route en actuele kosten per aanbieder: vraag de LaVega-assistent
        rechtsonder — die zoekt de actuele tarieven live op.
      </p>
    </section>
  );
}
