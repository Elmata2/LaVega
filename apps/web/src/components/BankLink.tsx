import { Fragment, useCallback, useState } from "react";
import { API_BASE, apiErrorMessageIn } from "../api";
import { useAppLocale } from "../appLocale";
import { moneyCopy } from "../copy/money";
import Button from "./ui/Button.js";

/* "Koppel bank" via Enable Banking (AIS, read-only). Fetches the bank list,
 * lets the user pick one, and redirects the browser to the bank to authorise.
 * The return trip (?eb=<session>) is handled in App. Read-only: no payments. */

type Aspsp = { name: string; country: string; logo?: string };
type PsuType = "business" | "personal";

const PSU_TYPE_ORDER: PsuType[] = ["business", "personal"];

export default function BankLink({ busy }: { busy: boolean }) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale];
  const psuTypeLabels: Record<PsuType, string> = {
    business: c.bankLink.zakelijk,
    personal: c.bankLink.particulier,
  };
  const [psuType, setPsuType] = useState<PsuType>("business");
  const [aspsps, setAspsps] = useState<Aspsp[] | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadBanks = useCallback(
    async (type: PsuType) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_BASE}/api/eb/aspsps?country=NL&psu_type=${type}`);
        if (!res.ok) {
          setError(await apiErrorMessageIn(locale, res));
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
    },
    [locale],
  );

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
        setError(await apiErrorMessageIn(locale, res));
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (!data.url) {
        setError(data.error || c.bankLink.bankGeenAutorisatiepagina);
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
      <h3 style={{ marginTop: 0 }}>{c.bankLink.ofKoppelJeBankDirect}</h3>
      <div className="scope-switch" role="group" aria-label={c.bankLink.typeRekeningAria}>
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
              {psuTypeLabels[t]}
            </button>
          </Fragment>
        ))}
      </div>
      {aspsps === null ? (
        <Button disabled={busy || loading} onClick={() => void loadBanks(psuType)}>
          {loading ? c.bankLink.laden : c.bankLink.koppelBankEnableBanking}
        </Button>
      ) : aspsps.length === 0 ? (
        <p className="cell-sub">{c.bankLink.geenBankenBeschikbaar}</p>
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
          <Button variant="primary" disabled={busy || loading} onClick={() => void connect()}>
            {loading ? c.bankLink.doorsturen : c.bankLink.autoriseer}
          </Button>
        </span>
      )}
      {error && (
        <p className="text-warn" role="alert">
          {c.bankLink.bankkoppelingError(error)}
        </p>
      )}
      <p className="eyebrow" style={{ marginTop: "var(--sp-2)" }}>
        {c.bankLink.alleenLezenToegang}
      </p>
    </div>
  );
}
