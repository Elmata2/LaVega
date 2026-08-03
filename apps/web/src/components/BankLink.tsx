import { useState } from "react";
import { API_BASE } from "../api";

/* "Koppel bank" via Enable Banking (AIS, read-only). Fetches the bank list,
 * lets the user pick one, and redirects the browser to the bank to authorise.
 * The return trip (?eb=<session>) is handled in App. Read-only: no payments. */

type Aspsp = { name: string; country: string; logo?: string };

export default function BankLink({ busy }: { busy: boolean }) {
  const [aspsps, setAspsps] = useState<Aspsp[] | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadBanks() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/eb/aspsps?country=NL`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Fout ${res.status}`);
        return;
      }
      setAspsps(data.aspsps || []);
      if (data.aspsps?.length) setSelected(data.aspsps[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function connect() {
    const bank = (aspsps || []).find((a) => a.name === selected);
    if (!bank) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/eb/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bank.name, country: bank.country }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error || `Fout ${res.status}`);
        setLoading(false);
        return;
      }
      window.location.href = data.url; // hand off to the bank's authorisation page
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: "var(--sp-4)", borderTop: "1px solid var(--line)", paddingTop: "var(--sp-4)" }}>
      <h3 style={{ marginTop: 0 }}>Of koppel je bank direct</h3>
      {aspsps === null ? (
        <button type="button" className="btn" disabled={busy || loading} onClick={() => void loadBanks()}>
          {loading ? "Laden…" : "Koppel bank (Enable Banking)"}
        </button>
      ) : aspsps.length === 0 ? (
        <p className="cell-sub">Geen banken beschikbaar.</p>
      ) : (
        <span style={{ display: "inline-flex", gap: "var(--sp-2)", alignItems: "center", flexWrap: "wrap" }}>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={busy || loading}>
            {aspsps.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" disabled={busy || loading} onClick={() => void connect()}>
            {loading ? "Doorsturen…" : "Autoriseer"}
          </button>
        </span>
      )}
      {error && (
        <p className="text-warn" role="alert">
          Bankkoppeling: {error}
        </p>
      )}
      <p className="eyebrow" style={{ marginTop: "var(--sp-2)" }}>
        Alleen-lezen toegang via Enable Banking — je autoriseert bij je eigen bank; gegevens komen versleuteld in je
        eigen kluis.
      </p>
    </div>
  );
}
