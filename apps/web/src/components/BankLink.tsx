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

/** `https:` with a host, and nothing else.
 *
 *  The bank's authorisation URL is the one place in this component that
 *  navigates to something a third party chose, so it gets an explicit scheme
 *  allowlist before it can move the browser. `data.url` comes from our own
 *  server today, but a value that is not https (a `javascript:` or `data:`
 *  URL) would run in our origin if a server or proxy ever returned one; a
 *  scheme check is the cheapest place to make that impossible. */
function isHttpsUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.hostname !== "";
}

export default function BankLink({
  busy,
  onRefresh,
  onBeforeRedirect,
  defaultPsuType = "business",
}: {
  busy: boolean;
  /** Re-read every connected bank. See App's `handleRefreshBank`. */
  onRefresh: () => void;
  /** Awaited just before the browser leaves for the bank. The intake saves its
   *  place here, so the return trip can resume. A throw cancels the redirect
   *  and shows as the usual bank-link error. */
  onBeforeRedirect?: () => void | Promise<void>;
  defaultPsuType?: PsuType;
}) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale];
  const psuTypeLabels: Record<PsuType, string> = {
    business: c.bankLink.zakelijk,
    personal: c.bankLink.particulier,
  };
  const [psuType, setPsuType] = useState<PsuType>(defaultPsuType);
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
      /* A scheme allowlist, not just "looks like a URL": see `isHttpsUrl`. */
      if (typeof data.url !== "string" || !isHttpsUrl(data.url)) {
        setError(c.bankLink.bankOnveiligeAutorisatiepagina);
        setLoading(false);
        return;
      }
      await onBeforeRedirect?.();
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
      {/* VERVERSEN STAAT BOVEN HET KOPPELEN, want voor wie al gekoppeld is, is
          dit de knop die hij zoekt. Altijd zichtbaar en niet pas na een
          statuscheck: het antwoord "er is nog geen koppeling" komt van de
          server en is een zin die hij kan lezen, geen knop die er niet is. */}
      <div className="flex flex-wrap gap-2 mb-[var(--sp-3)]">
        <Button disabled={busy} onClick={onRefresh}>
          {c.bankLink.ververs}
        </Button>
        <span className="cell-sub">{c.bankLink.ververshHint}</span>
      </div>
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
