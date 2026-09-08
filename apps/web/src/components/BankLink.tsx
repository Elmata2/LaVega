import { Fragment, useCallback, useState } from "react";
import { API_BASE, apiErrorMessage } from "../api";

/* "Koppel bank" via Enable Banking (AIS, read-only). Fetches the bank list,
 * lets the user pick one, and redirects the browser to the bank to authorise.
 * The return trip (?eb=<session>) is handled in App. Read-only: no payments. */

type Aspsp = { name: string; country: string; logo?: string };
type PsuType = "business" | "personal";

const PSU_TYPE_ORDER: PsuType[] = ["business", "personal"];
const PSU_TYPE_LABELS: Record<PsuType, string> = {
  business: "Zakelijk",
  personal: "Particulier",
};

export default function BankLink({ busy }: { busy: boolean }) {
  const [psuType, setPsuType] = useState<PsuType>("business");
  const [aspsps, setAspsps] = useState<Aspsp[] | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadBanks = useCallback(async (type: PsuType) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/eb/aspsps?country=NL&psu_type=${type}`);
      if (!res.ok) {
        setError(await apiErrorMessage(res));
        return;
      }
      const data = await res.json();
      setAspsps(data.aspsps || []);
      if (data.aspsps?.length) setSelected(data.aspsps[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  function pickPsuType(type: PsuType) {
    setPsuType(type);
    if (aspsps !== null) {
      setAspsps(null);
      setSelected("");
      void loadBanks(type);
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
        body: JSON.stringify({ name: bank.name, country: bank.country, psuType }),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res));
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (!data.url) {
        setError(data.error || "De bank gaf geen autorisatiepagina terug.");
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
    <div
      style={{
        marginTop: "var(--sp-4)",
        borderTop: "1px solid var(--line)",
        paddingTop: "var(--sp-4)",
      }}
    >
      <h3 style={{ marginTop: 0 }}>Of koppel je bank direct</h3>
      <div className="scope-switch" role="group" aria-label="Type rekening">
        {PSU_TYPE_ORDER.map((t, i) => (
          <Fragment key={t}>
            {i > 0 && <span className="scope-rule" aria-hidden="true" />}
            <button
              type="button"
              className={`scope-option${psuType === t ? " scope-on" : ""}`}
              aria-pressed={psuType === t}
              disabled={busy || loading}
              onClick={() => pickPsuType(t)}
            >
              {PSU_TYPE_LABELS[t]}
            </button>
          </Fragment>
        ))}
      </div>
      {aspsps === null ? (
        <button
          type="button"
          className="btn"
          disabled={busy || loading}
          onClick={() => void loadBanks(psuType)}
        >
          {loading ? "Laden…" : "Koppel bank (Enable Banking)"}
        </button>
      ) : aspsps.length === 0 ? (
        <p className="cell-sub">Geen banken beschikbaar.</p>
      ) : (
        <span
          style={{
            display: "inline-flex",
            gap: "var(--sp-2)",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy || loading}
          >
            {aspsps.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || loading}
            onClick={() => void connect()}
          >
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
        Alleen-lezen toegang via Enable Banking — je autoriseert bij je eigen bank; gegevens komen
        versleuteld in je eigen kluis.
      </p>
    </div>
  );
}
