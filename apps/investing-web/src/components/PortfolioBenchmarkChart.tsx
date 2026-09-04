import {
  buildIndexedSeries,
  deriveChartMode,
  type BenchmarkInstrument,
  type BenchmarkSeries,
  type IndexedSeriesPoint,
  type PortfolioRange,
  type PortfolioValuePoint,
} from "@lavega/core";
import { runPriceSyncUntilComplete } from "../lib/priceSync";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { EmptyState } from "./EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip } from "./ui/chart";
import { chartRanges, pointsInWindow, useChartWindow, type ChartWindow } from "./useChartWindow";
import { shortDate } from "../lib/dates.js";
const colors = ["chart-blue", "chart-purple", "chart-teal"];
type Props = {
  data: Partial<Record<PortfolioRange, PortfolioValuePoint[]>>;
  benchmarks?: BenchmarkSeries[];
  externalCashFlows?: Array<{ date: string; amount: number | null }>;
  currency?: string;
};
type SearchPayload = { results?: BenchmarkInstrument[]; fallback?: boolean; problems?: string[] };
export type VisibleWindow = ChartWindow;

const money = (value: number, currency: string) =>
  value.toLocaleString("nl-NL", { style: "currency", currency, maximumFractionDigits: 2 });
const percent = (value: number) =>
  value.toLocaleString("nl-NL", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
const dateLabel = shortDate;
const valueOrUnknown = (value: number | null, formatter: (value: number) => string) =>
  value === null ? "Onbekend" : formatter(value);
const pp = (value: number) =>
  `${value >= 0 ? "+" : ""}${(value * 100).toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;
const cappedXirr = (value: number | null) =>
  value === null
    ? "Onbekend"
    : value > 9.99
      ? "> +999%"
      : value < -0.99
        ? "< -99%"
        : percent(value);

function allPoints(data: Props["data"]): PortfolioValuePoint[] {
  if (data.All) return data.All;
  return [
    ...new Map(
      Object.values(data)
        .flatMap((points) => points ?? [])
        .map((point) => [point.date, point]),
    ).values(),
  ].sort((left, right) => left.date.localeCompare(right.date));
}

export function pointsForWindow(data: Props["data"], window: VisibleWindow): PortfolioValuePoint[] {
  return pointsInWindow(
    allPoints(data),
    window,
    (range) => data[range] ?? (range === "All" ? allPoints(data) : []),
  );
}

export function PortfolioBenchmarkChart({
  data,
  benchmarks = [],
  externalCashFlows = [],
  currency = "EUR",
}: Props) {
  const [selected, setSelected] = useState<string[]>(
    benchmarks.map((benchmark) => benchmark.symbol),
  );
  const [visible, setVisible] = useState<Set<string>>(new Set(["portfolio", ...selected]));
  const [comparing, setComparing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BenchmarkInstrument[]>([]);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fullPoints = useMemo(() => allPoints(data), [data]);
  const presetPoints = useCallback(
    (range: PortfolioRange) => data[range] ?? (range === "All" ? fullPoints : []),
    [data, fullPoints],
  );
  const chart = useChartWindow({ allPoints: fullPoints, presetPoints, minimumWheelPoints: 5 });
  const {
    points,
    focusIndex,
    setFocusIndex,
    pointerRatio,
    setPointerRatio,
    drag,
    chartRef,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    dateError,
    minDate,
    maxDate,
  } = chart;

  useEffect(() => {
    let active = true;
    void fetch("/api/investing/benchmarks")
      .then(async (response) =>
        response.ok ? ((await response.json()) as { symbols?: string[] }) : {},
      )
      .then((payload) => {
        if (!active || !Array.isArray(payload.symbols)) return;
        setSelected(payload.symbols);
        setVisible(new Set(["portfolio", ...payload.symbols]));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!comparing) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchStatus("Zoeken…");
      void fetch(`/api/investing/benchmarks/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Zoeken mislukt");
          return (await response.json()) as SearchPayload;
        })
        .then((payload) => {
          setResults((payload.results ?? []).filter((result) => !selected.includes(result.symbol)));
          setSearchStatus(payload.fallback ? "Europese suggesties" : null);
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError"))
            setSearchStatus("Zoeken niet beschikbaar");
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [comparing, query, selected]);

  async function replaceSelection(symbols: string[]) {
    setBusy(true);
    setSelectionError(null);
    try {
      const response = await fetch("/api/investing/benchmarks", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      if (!response.ok) throw new Error("Selectie opslaan mislukt");
      setSelected(symbols);
      setVisible(
        (current) =>
          new Set([
            "portfolio",
            ...symbols.filter((symbol) => current.has(symbol) || !selected.includes(symbol)),
          ]),
      );
      window.dispatchEvent(new Event("lavega:dashboard-refresh"));
      /* Een net gekozen benchmark heeft nog geen koersen. De server haalt ze
         alleen op terwijl er een aanvraag loopt, dus vraagt de pagina erom. */
      await runPriceSyncUntilComplete();
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "Selectie opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  const selectedSeries = useMemo(
    () =>
      selected.map(
        (symbol) =>
          benchmarks.find((benchmark) => benchmark.symbol === symbol) ?? {
            symbol,
            name: symbol,
            exchange: "Yahoo Finance",
            currency: "EUR",
            points: [],
          },
      ),
    [selected, benchmarks],
  );
  const visibleBenchmarks = selectedSeries.filter((benchmark) => visible.has(benchmark.symbol));
  const mode = deriveChartMode(selected);
  const indexed = useMemo(
    () => buildIndexedSeries(points, selectedSeries, externalCashFlows),
    [points, selectedSeries, externalCashFlows],
  );
  const chartPoints =
    mode === "euros"
      ? points
      : points.map((base, index) => {
          const point = indexed[index]!;
          return {
            ...base,
            ...point,
            ...Object.fromEntries(
              Object.entries(point.benchmarkReturns).map(([symbol, value]) => [
                `benchmark:${symbol}`,
                value,
              ]),
            ),
          };
        });
  const direction = useMemo(() => {
    const values = points.flatMap((point) => (point.value === null ? [] : [point.value]));
    return values.length < 2 || values.at(-1)! >= values[0]! ? "pos" : "neg";
  }, [points]);
  const label = mode === "euros" ? "Portefeuillewaarde" : "Geïndexeerd rendement";
  const summaryPoint = indexed[focusIndex ?? indexed.length - 1] ?? null;
  const applyTypedDates = (event: React.FormEvent) => {
    event.preventDefault();
    chart.applyTypedDates();
  };

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="relative h-5 text-sm font-medium text-muted-foreground">
            <span
              className={`axis-label absolute inset-0 ${mode === "euros" ? "opacity-100" : "opacity-0"}`}
            >
              Portefeuillewaarde
            </span>
            <span
              className={`axis-label absolute inset-0 ${mode === "indexed" ? "opacity-100" : "opacity-0"}`}
            >
              Geïndexeerd rendement
            </span>
          </p>
          <CardTitle>{mode === "euros" ? "Portefeuille" : "Vergelijking"}</CardTitle>
        </div>
        <div
          role="group"
          aria-label="Periode kiezen"
          className="flex flex-wrap gap-1 rounded-pill bg-secondary p-1"
        >
          {chartRanges.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={chart.window.kind === "preset" && chart.window.range === item.value}
              onClick={() => chart.applyPreset(item.value)}
              className={`pressable rounded-pill px-2.5 py-1.5 text-xs font-semibold ${chart.window.kind === "preset" && chart.window.range === item.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="mb-4 flex flex-wrap items-center gap-2"
          aria-label="Geselecteerde benchmarks"
        >
          {selected.map((symbol, index) => (
            <span
              key={symbol}
              className="inline-flex items-center gap-2 rounded-pill bg-secondary px-3 py-1.5 text-xs font-semibold"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: `hsl(var(--${colors[index]}))` }}
              />
              {benchmarks.find((item) => item.symbol === symbol)?.name ?? symbol}
              <button
                type="button"
                disabled={busy}
                aria-label={`${symbol} verwijderen`}
                onClick={() => void replaceSelection(selected.filter((item) => item !== symbol))}
                className="pressable -mr-1 rounded-full px-1 text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
          {selected.length < 3 && !comparing && (
            <button
              type="button"
              onClick={() => setComparing(true)}
              className="pressable rounded-pill border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-primary"
            >
              + Vergelijk
            </button>
          )}
        </div>
        {selectionError && (
          <p role="alert" className="mb-4 text-sm text-negative">
            {selectionError}
          </p>
        )}
        {comparing && (
          <div className="mb-5 rounded-card border border-border bg-secondary/30 p-3">
            <div className="flex gap-2">
              <label className="min-w-0 flex-1 text-xs font-semibold">
                Benchmark zoeken
                <input
                  autoFocus
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="benchmark-results"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="AEX, DAX, ETF…"
                  className="mt-1.5 w-full rounded-[12px] border border-input bg-background px-3 py-2 text-sm font-normal"
                />
              </label>
              <button
                type="button"
                onClick={() => setComparing(false)}
                className="pressable self-end rounded-[12px] px-3 py-2 text-sm font-semibold"
              >
                Sluiten
              </button>
            </div>
            {searchStatus && (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {searchStatus}
              </p>
            )}
            <ul id="benchmark-results" role="listbox" className="mt-2 grid gap-1 sm:grid-cols-2">
              {results.map((result) => (
                <li key={result.symbol} role="option" aria-selected="false">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void replaceSelection([...selected, result.symbol]);
                      setComparing(false);
                      setQuery("");
                    }}
                    className="pressable w-full rounded-[12px] px-3 py-2 text-left hover:bg-background"
                  >
                    <span className="block text-sm font-semibold">{result.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {result.symbol} · {result.exchange} · {result.currency}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {points.length === 0 ? (
          <EmptyState
            title="Geen portefeuillegegevens"
            description="Portefeuillewaarde verschijnt zodra prijsdata beschikbaar is."
          />
        ) : (
          <>
            {mode === "indexed" && summaryPoint && (
              <PerformanceSummary
                point={summaryPoint}
                benchmarks={visibleBenchmarks}
                currency={currency}
              />
            )}
            <form
              onSubmit={applyTypedDates}
              aria-label="Datumbereik kiezen"
              className="mb-3 flex flex-wrap items-end gap-2 text-xs"
            >
              <label className="font-semibold text-muted-foreground">
                Van
                <input
                  type="date"
                  aria-label="Van datum"
                  min={minDate}
                  max={maxDate}
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground"
                />
              </label>
              <label className="font-semibold text-muted-foreground">
                Tot
                <input
                  type="date"
                  aria-label="Tot datum"
                  min={minDate}
                  max={maxDate}
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground"
                />
              </label>
              <button
                type="submit"
                className="pressable rounded-pill border border-border px-3 py-1.5 font-semibold"
              >
                Toepassen
              </button>
              {chart.window.kind === "custom" && (
                <button
                  type="button"
                  onClick={chart.clearZoom}
                  aria-label="Zoom wissen"
                  className="pressable rounded-pill bg-secondary px-3 py-1.5 font-semibold"
                >
                  Zoom: {dateLabel(chart.window.from)} – {dateLabel(chart.window.to)} ×
                </button>
              )}
            </form>
            {dateError && (
              <p role="alert" className="mb-3 text-xs text-negative">
                {dateError}
              </p>
            )}
            <div
              ref={chartRef}
              role="img"
              tabIndex={0}
              aria-label={`${label}. Gebruik pijltoetsen voor exacte waarden, Home en End voor begin en einde, Escape om zoom te wissen.`}
              className="touch-pan-y select-none rounded-[12px]"
              onKeyDown={chart.onKeyDown}
              onPointerDown={chart.onPointerDown}
              onPointerMove={(event) => {
                const index = chart.indexForClientX(event.clientX);
                if (index !== null) setFocusIndex(index);
                const rect = event.currentTarget.getBoundingClientRect();
                setPointerRatio(
                  Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
                );
                chart.onPointerMove(event);
              }}
              onPointerUp={chart.onPointerUp}
              onPointerLeave={() => {
                if (!drag) setFocusIndex(null);
              }}
            >
              <ChartContainer className="h-[320px]" aria-hidden="true">
                <LineChart
                  data={chartPoints}
                  margin={{ top: 12, right: 12, left: 8, bottom: 0 }}
                  onMouseMove={(state) => {
                    if (typeof state?.activeTooltipIndex === "number")
                      setFocusIndex(state.activeTooltipIndex);
                  }}
                >
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: string) => value.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                    domain={["auto", "auto"]}
                    tickFormatter={(value: number) =>
                      mode === "euros" ? money(value, currency) : percent(value)
                    }
                  />
                  {mode === "indexed" && (
                    <ReferenceLine
                      y={0}
                      stroke="hsl(var(--foreground))"
                      strokeOpacity={0.35}
                      strokeWidth={1.5}
                    />
                  )}
                  {focusIndex !== null && chartPoints[focusIndex] && (
                    <ReferenceLine
                      x={chartPoints[focusIndex]!.date}
                      stroke="hsl(var(--foreground))"
                      strokeOpacity={0.4}
                      strokeDasharray="3 3"
                    />
                  )}
                  {drag && (
                    <ReferenceArea
                      x1={points[Math.min(drag.from, drag.to)]?.date}
                      x2={points[Math.max(drag.from, drag.to)]?.date}
                      fill="hsl(var(--chart-blue))"
                      fillOpacity={0.12}
                      strokeOpacity={0}
                    />
                  )}
                  <ChartTooltip
                    isAnimationActive={false}
                    reverseDirection={{ x: pointerRatio > 0.62, y: false }}
                    content={
                      <PerformanceTooltip
                        mode={mode}
                        benchmarks={visibleBenchmarks}
                        currency={currency}
                      />
                    }
                  />
                  <Line
                    dataKey={mode === "euros" ? "value" : "portfolioReturn"}
                    name="Portefeuille"
                    hide={!visible.has("portfolio")}
                    connectNulls={false}
                    stroke={`hsl(var(--${mode === "euros" ? direction : "pos"}))`}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                  {mode === "indexed" &&
                    selectedSeries.map((benchmark, index) => (
                      <Line
                        key={benchmark.symbol}
                        dataKey={`benchmark:${benchmark.symbol}`}
                        name={benchmark.name}
                        hide={!visible.has(benchmark.symbol)}
                        connectNulls={false}
                        stroke={`hsl(var(--${colors[index]}))`}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    ))}
                </LineChart>
              </ChartContainer>
            </div>
            <p aria-live="polite" className="sr-only">
              {summaryPoint
                ? accessiblePoint(summaryPoint, selectedSeries, currency)
                : "Geen waarden beschikbaar"}
            </p>
            <ul className="sr-only" aria-label="Exacte grafiekwaarden">
              {indexed.map((point) => (
                <li key={point.date}>{accessiblePoint(point, selectedSeries, currency)}</li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2 text-xs" aria-label="Grafiekseries">
              <button
                type="button"
                aria-pressed={visible.has("portfolio")}
                onClick={() => setVisible(toggle(visible, "portfolio"))}
                className="pressable inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-muted-foreground"
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: `hsl(var(--${mode === "euros" ? direction : "pos"}))` }}
                />
                Portefeuille
              </button>
              {selectedSeries.map((benchmark, index) => (
                <button
                  key={benchmark.symbol}
                  type="button"
                  aria-pressed={visible.has(benchmark.symbol)}
                  onClick={() => setVisible(toggle(visible, benchmark.symbol))}
                  className="pressable inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ backgroundColor: `hsl(var(--${colors[index]}))` }}
                  />
                  {benchmark.name}
                </button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PerformanceSummary({
  point,
  benchmarks,
  currency,
}: {
  point: IndexedSeriesPoint;
  benchmarks: BenchmarkSeries[];
  currency: string;
}) {
  return (
    <section
      aria-label="Rendement op geselecteerde datum"
      className="mb-4 rounded-[14px] border border-border bg-secondary/30 p-3"
    >
      <p className="mb-2 text-xs font-semibold text-muted-foreground">
        {dateLabel(point.date)} · Portefeuille{" "}
        {valueOrUnknown(point.portfolioValue, (value) => money(value, currency))}
      </p>
      <div className="flex flex-wrap gap-3">
        {benchmarks.map((benchmark) => {
          const benchmarkTwr = point.benchmarkReturns[benchmark.symbol] ?? null;
          const benchmarkMwr = point.benchmarkXirr[benchmark.symbol] ?? null;
          const twrSpread =
            point.portfolioReturn === null || benchmarkTwr === null
              ? null
              : point.portfolioReturn - benchmarkTwr;
          const mwrSpread =
            point.portfolioXirr === null || benchmarkMwr === null
              ? null
              : point.portfolioXirr - benchmarkMwr;
          return (
            <div
              key={benchmark.symbol}
              className="min-w-[220px] flex-1 rounded-[12px] bg-card p-3 shadow-soft"
            >
              <p className="mb-2 text-xs font-semibold">vs. {benchmark.name}</p>
              <MetricSpread label="TWR" value={twrSpread} tone="blue" />
              <MetricSpread label="XIRR p.j." value={mwrSpread} tone="amber" />
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                <span>Portefeuille {valueOrUnknown(point.portfolioReturn, percent)}</span>
                <span>
                  {benchmark.name} {valueOrUnknown(benchmarkTwr, percent)}
                </span>
                <span>XIRR {cappedXirr(point.portfolioXirr)}</span>
                <span>XIRR {cappedXirr(benchmarkMwr)}</span>
                <span>
                  {valueOrUnknown(point.portfolioValue, (value) => money(value, currency))}
                </span>
                <span>
                  {valueOrUnknown(point.benchmarkValues[benchmark.symbol] ?? null, (value) =>
                    money(value, benchmark.currency),
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MetricSpread({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "blue" | "amber";
}) {
  return (
    <p className="mb-1 flex items-baseline justify-between gap-3">
      <span
        className={`rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${tone === "blue" ? "bg-[hsl(var(--chart-blue)/.12)] text-[hsl(var(--chart-blue))]" : "bg-[hsl(var(--chart-amber)/.14)] text-[hsl(var(--chart-amber))]"}`}
      >
        {label}
      </span>
      <span
        className={`font-semibold tabular-nums ${value === null ? "text-muted-foreground" : value >= 0 ? "text-positive" : "text-negative"}`}
      >
        {value === null ? "Onbekend" : pp(value)}
      </span>
    </p>
  );
}

function PerformanceTooltip({
  active,
  payload,
  mode,
  benchmarks,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: IndexedSeriesPoint & PortfolioValuePoint }>;
  mode: "euros" | "indexed";
  benchmarks: BenchmarkSeries[];
  currency: string;
}) {
  const point = active ? payload?.[0]?.payload : null;
  if (!point) return null;
  return (
    <div className="max-w-[min(420px,80vw)] rounded-[12px] border border-border bg-card px-3 py-2 text-xs shadow-soft">
      <p className="mb-2 text-muted-foreground">{dateLabel(point.date)}</p>
      {mode === "euros" ? (
        <p className="font-semibold">
          Portefeuille: {valueOrUnknown(point.value, (value) => money(value, currency))}
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {benchmarks.map((benchmark) => {
            const benchmarkTwr = point.benchmarkReturns[benchmark.symbol] ?? null;
            const benchmarkMwr = point.benchmarkXirr[benchmark.symbol] ?? null;
            return (
              <div key={benchmark.symbol} className="min-w-[180px] flex-1">
                <p className="mb-1 font-semibold">vs. {benchmark.name}</p>
                <MetricSpread
                  label="TWR"
                  value={
                    point.portfolioReturn === null || benchmarkTwr === null
                      ? null
                      : point.portfolioReturn - benchmarkTwr
                  }
                  tone="blue"
                />
                <MetricSpread
                  label="XIRR p.j."
                  value={
                    point.portfolioXirr === null || benchmarkMwr === null
                      ? null
                      : point.portfolioXirr - benchmarkMwr
                  }
                  tone="amber"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Portefeuille {valueOrUnknown(point.portfolioReturn, percent)} · {benchmark.name}{" "}
                  {valueOrUnknown(benchmarkTwr, percent)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  XIRR {cappedXirr(point.portfolioXirr)} · {cappedXirr(benchmarkMwr)}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {(point.unpriced.length > 0 || point.cashUnknown.length > 0) && (
        <p className="mt-2 border-t border-border pt-1 text-negative">
          Onbekend: {[...point.unpriced, ...point.cashUnknown].join(", ")}
        </p>
      )}
    </div>
  );
}

function accessiblePoint(
  point: IndexedSeriesPoint,
  benchmarks: BenchmarkSeries[],
  currency: string,
): string {
  const unknown = [...point.unpriced, ...point.cashUnknown];
  return `${dateLabel(point.date)}: portefeuille ${valueOrUnknown(point.portfolioValue, (value) => money(value, currency))}, TWR ${valueOrUnknown(point.portfolioReturn, percent)}, XIRR ${cappedXirr(point.portfolioXirr)}${benchmarks.map((benchmark) => `, ${benchmark.name} TWR ${valueOrUnknown(point.benchmarkReturns[benchmark.symbol] ?? null, percent)}, XIRR ${cappedXirr(point.benchmarkXirr[benchmark.symbol] ?? null)}`).join("")}${unknown.length ? `, onbekend: ${unknown.join(", ")}` : ""}`;
}

function toggle(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
