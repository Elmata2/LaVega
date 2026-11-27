import { useEffect, useRef, useState } from "react";
import { Button } from "@lavega/ui";
import { GICS_SECTOR_LABELS } from "@lavega/core";

type SectorKind = "stock" | "fund" | "unknown";
type SectorSource = "provider" | "inferred" | "correction" | "unknown";
type SectorState = {
  kind?: SectorKind;
  sector: string | null;
  source: SectorSource;
  confidence?: number;
};

type LoadPhase = { kind: "loading" } | { kind: "ready"; state: SectorState; isFund: boolean };
type ActionPhase = "idle" | "saving" | "resetting";

const badgeClass = "ml-2 rounded-pill bg-secondary px-2 py-0.5 text-xs text-muted-foreground";

function sectorUrl(symbol: string): string {
  return `/api/investing/positions/${encodeURIComponent(symbol)}/sector`;
}

/** A fund's sector is a look-through weight vector, not a single label, so
 *  PUT rejects it with 422 (Task 10). The GET response's `kind` field
 *  already knows this up front once the profile is cached, so the control
 *  hides itself immediately; a symbol GET hasn't cached yet still learns
 *  it from that same 422 (a response with no `kind` is treated as a
 *  stock, for a server that hasn't shipped the field yet). */
export function PositionSectorControl({ symbol }: { symbol: string }) {
  const [trackedSymbol, setTrackedSymbol] = useState(symbol);
  const [load, setLoad] = useState<LoadPhase>({ kind: "loading" });
  const [selection, setSelection] = useState("");
  const [action, setAction] = useState<ActionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  if (trackedSymbol !== symbol) {
    setTrackedSymbol(symbol);
    setLoad({ kind: "loading" });
    setSelection("");
    setAction("idle");
    setError(null);
  }

  async function loadSector(targetSymbol: string, signal?: AbortSignal): Promise<void> {
    const generation = generationRef.current;
    const response = await fetch(sectorUrl(targetSymbol), { signal });
    if (signal?.aborted || generation !== generationRef.current || !response.ok) return;
    const next = (await response.json()) as SectorState;
    if (signal?.aborted || generation !== generationRef.current) return;
    setLoad({ kind: "ready", state: next, isFund: next.kind === "fund" });
  }

  useEffect(() => {
    generationRef.current += 1;
    const controller = new AbortController();
    void loadSector(symbol, controller.signal).catch(() => undefined);
    return () => {
      generationRef.current += 1;
      controller.abort();
    };
  }, [symbol]);

  if (load.kind !== "ready") return null;
  const { state, isFund } = load;
  const busy = action !== "idle";

  const badge =
    state.source === "inferred" ? (
      <span className={badgeClass}>
        inferred{state.confidence !== undefined ? ` · ${Math.round(state.confidence * 100)}%` : ""}
      </span>
    ) : state.source === "correction" ? (
      <span className={badgeClass}>your correction</span>
    ) : null;

  async function save() {
    if (!selection || busy) return;
    const generation = generationRef.current;
    setAction("saving");
    setError(null);
    try {
      const response = await fetch(sectorUrl(symbol), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sector: selection }),
      });
      if (generation !== generationRef.current) return;
      if (response.status === 422) {
        setLoad((current) => (current.kind === "ready" ? { ...current, isFund: true } : current));
        setSelection("");
        return;
      }
      if (!response.ok) {
        setError("Couldn't save — try again.");
        return;
      }
      setSelection("");
      await loadSector(symbol);
    } finally {
      if (generation === generationRef.current) setAction("idle");
    }
  }

  async function reset() {
    if (busy) return;
    const generation = generationRef.current;
    setAction("resetting");
    setError(null);
    try {
      const response = await fetch(sectorUrl(symbol), { method: "DELETE" });
      if (generation !== generationRef.current) return;
      if (response.ok) await loadSector(symbol);
      else setError("Couldn't reset — try again.");
    } finally {
      if (generation === generationRef.current) setAction("idle");
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
      {state.sector !== null && (
        <span>
          Sector: <span className="font-semibold">{state.sector}</span>
          {badge}
        </span>
      )}
      {isFund ? (
        <p className="text-xs text-muted-foreground">
          Split across its holdings' sectors — correct the underlying holdings instead.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Correct sector
            <select
              aria-label="Correct sector"
              className="rounded-tile border border-input bg-background px-3 py-2 text-sm"
              value={selection}
              disabled={busy}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selection || busy}
            onClick={() => void save()}
          >
            {action === "saving" ? "Saving…" : "Save"}
          </Button>
          {state.source === "correction" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void reset()}
            >
              {action === "resetting" ? "Resetting…" : "Reset to automatic"}
            </Button>
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
