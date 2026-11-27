import { MAX_BENCHMARKS, type BenchmarkInstrument } from "@lavega/core";
import { useEffect, useId, useState } from "react";
import { saveBenchmarkSymbols, searchBenchmarks } from "../lib/benchmarkSelection";

const SEARCH_DEBOUNCE_MS = 250;

type SearchPhase =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "ready"; results: BenchmarkInstrument[]; fallback: boolean }
  | { kind: "error"; message: string };

/** The card's explicit "which market should beta measure against?" action.
 *  Self-contained: the search and save calls belong to the user's click, not
 *  to mounting this card, so a card that is merely rendered never fetches. */
export function BenchmarkPicker({ selected = [] }: { selected?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [symbols, setSymbols] = useState<string[]>([...selected]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchPhase>({ kind: "idle" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listboxId = useId();
  const full = symbols.length >= MAX_BENCHMARKS;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearch({ kind: "searching" });
      void searchBenchmarks(query, controller.signal)
        .then((payload) => {
          if (controller.signal.aborted) return;
          setSearch({
            kind: "ready",
            results: payload.results.filter((result) => !symbols.includes(result.symbol)),
            fallback: payload.fallback === true,
          });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setSearch({
            kind: "error",
            message:
              error instanceof Error ? error.message : "Benchmark search failed. Try again.",
          });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, symbols]);

  const results = search.kind === "ready" ? search.results : [];
  const statusLabel =
    search.kind === "searching"
      ? "Searching…"
      : search.kind === "ready" && search.fallback
        ? "European suggestions"
        : null;

  async function replaceSelection(next: string[]): Promise<boolean> {
    setBusy(true);
    setSaveError(null);
    try {
      await saveBenchmarkSymbols(next);
      setSymbols(next);
      return true;
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Benchmark selection could not be saved.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable rounded-pill border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-accent"
      >
        Choose benchmark
      </button>
    );

  return (
    <div role="group" aria-label="Choose benchmark" className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {symbols.map((symbol) => (
          <span
            key={symbol}
            className="inline-flex items-center gap-1 rounded-pill bg-secondary px-2.5 py-1 text-xs font-semibold"
          >
            {symbol}
            <button
              type="button"
              disabled={busy}
              aria-label={`${symbol} remove`}
              onClick={() => void replaceSelection(symbols.filter((entry) => entry !== symbol))}
              className="pressable rounded-full px-1 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setSearch({ kind: "idle" });
          }}
          className="pressable rounded-pill px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      <label className="block text-xs font-semibold text-muted-foreground">
        Search benchmarks
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-label="Search benchmarks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="AEX, DAX, ETF…"
          className="mt-1 w-full rounded-chip border border-input bg-background px-2 py-1 text-sm font-normal text-foreground"
        />
      </label>
      {statusLabel && (
        <p role="status" className="text-xs text-muted-foreground">
          {statusLabel}
        </p>
      )}
      {search.kind === "error" && (
        <p role="alert" className="text-xs text-negative">
          {search.message}
        </p>
      )}
      {saveError && (
        <p role="alert" className="text-xs text-negative">
          {saveError}
        </p>
      )}
      {full && <p className="text-xs text-muted-foreground">Up to {MAX_BENCHMARKS} benchmarks.</p>}
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Benchmark results"
        className="max-h-48 space-y-1 overflow-y-auto"
      >
        {results.map((result) => (
          <li key={result.symbol} role="option" aria-selected="false">
            <button
              type="button"
              disabled={busy || full}
              onClick={() => {
                void replaceSelection([...symbols, result.symbol]).then((saved) => {
                  if (!saved) return;
                  setQuery("");
                  setSearch({ kind: "idle" });
                  setOpen(false);
                });
              }}
              className="pressable w-full rounded-chip px-2 py-1 text-left hover:bg-secondary/40"
            >
              <span className="block text-xs font-semibold">{result.name}</span>
              <span className="block text-xs text-muted-foreground">
                {result.symbol} · {result.currency}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {search.kind === "ready" && results.length === 0 && (
        <p className="text-xs text-muted-foreground">No benchmarks found.</p>
      )}
    </div>
  );
}
