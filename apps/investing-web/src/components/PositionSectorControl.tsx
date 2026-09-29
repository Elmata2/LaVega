import { useEffect, useState } from "react";
import { GICS_SECTOR_LABELS } from "@lavega/core";

type SectorSource = "provider" | "inferred" | "correction" | "unknown";
type SectorState = { sector: string; source: SectorSource; confidence?: number };

const badgeClass = "ml-2 rounded-pill bg-secondary px-2 py-0.5 text-xs text-muted-foreground";

function sectorUrl(symbol: string): string {
  return `/api/investing/positions/${encodeURIComponent(symbol)}/sector`;
}

/** A fund's sector is a look-through weight vector, not a single label, so
 *  PUT rejects it with 422 (Task 10). Nothing in InvestingPositionDetail
 *  marks a position as a fund, so this can't hide the control up front; it
 *  finds out from the same 422 the API already uses to enforce the rule,
 *  and then hides itself for the rest of this mount. */
export function PositionSectorControl({ symbol }: { symbol: string }) {
  const [state, setState] = useState<SectorState | null>(null);
  const [selection, setSelection] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [fund, setFund] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch(sectorUrl(symbol));
    if (response.ok) setState(await response.json());
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (!state) return null;

  const badge =
    state.source === "inferred" ? (
      <span className={badgeClass}>
        inferred{state.confidence !== undefined ? ` · ${Math.round(state.confidence * 100)}%` : ""}
      </span>
    ) : state.source === "correction" ? (
      <span className={badgeClass}>your correction</span>
    ) : null;

  async function save() {
    if (!selection) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(sectorUrl(symbol), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sector: selection }),
      });
      if (response.status === 422) {
        setFund(true);
        setSelection("");
        return;
      }
      if (!response.ok) {
        setError("Couldn't save — try again.");
        return;
      }
      setSelection("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setResetting(true);
    setError(null);
    try {
      const response = await fetch(sectorUrl(symbol), { method: "DELETE" });
      if (response.ok) await load();
      else setError("Couldn't reset — try again.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
      <span>
        Sector: <span className="font-semibold">{state.sector}</span>
        {badge}
      </span>
      {fund ? (
        <p className="text-xs text-muted-foreground">
          Split across its holdings' sectors — correct the underlying holdings instead.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Correct sector
            <select
              aria-label="Correct sector"
              className="rounded-md border bg-background px-2 py-1"
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
            >
              <option value="">Choose…</option>
              {GICS_SECTOR_LABELS.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
            disabled={!selection || saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {state.source === "correction" && (
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
              disabled={resetting}
              onClick={() => void reset()}
            >
              {resetting ? "Resetting…" : "Reset to automatic"}
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
