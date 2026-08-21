import { buildIndexedSeries, deriveChartMode, type BenchmarkInstrument, type BenchmarkSeries, type PortfolioRange, type PortfolioValuePoint } from "@lavega/core";
import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { EmptyState } from "./EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

const ranges: { value: PortfolioRange; label: string }[] = [
  { value: "1M", label: "1 maand" }, { value: "6M", label: "6 maanden" }, { value: "1Y", label: "1 jaar" }, { value: "YTD", label: "Dit jaar" }, { value: "All", label: "Alles" },
];
const colors = ["chart-blue", "chart-purple", "chart-teal"];
type Props = { data: Partial<Record<PortfolioRange, PortfolioValuePoint[]>>; benchmarks?: BenchmarkSeries[]; externalCashFlows?: Array<{ date: string; amount: number | null }>; currency?: string };
type SearchPayload = { results?: BenchmarkInstrument[]; fallback?: boolean; problems?: string[] };

const money = (value: number, currency: string) => value.toLocaleString("nl-NL", { style: "currency", currency, maximumFractionDigits: 2 });
const percent = (value: number) => value.toLocaleString("nl-NL", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2 });

export function PortfolioBenchmarkChart({ data, benchmarks = [], externalCashFlows = [], currency = "EUR" }: Props) {
  const [range, setRange] = useState<PortfolioRange>("1M");
  const [selected, setSelected] = useState<string[]>(benchmarks.map((benchmark) => benchmark.symbol));
  const [visible, setVisible] = useState<Set<string>>(new Set(["portfolio", ...selected]));
  const [comparing, setComparing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BenchmarkInstrument[]>([]);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/investing/benchmarks").then(async (response) => response.ok ? await response.json() as { symbols?: string[] } : {}).then((payload) => {
      if (!active || !Array.isArray(payload.symbols)) return;
      setSelected(payload.symbols);
      setVisible(new Set(["portfolio", ...payload.symbols]));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!comparing) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchStatus("Zoeken…");
      void fetch(`/api/investing/benchmarks/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Zoeken mislukt");
          return await response.json() as SearchPayload;
        })
        .then((payload) => {
          setResults((payload.results ?? []).filter((result) => !selected.includes(result.symbol)));
          setSearchStatus(payload.fallback ? "Europese suggesties" : null);
        })
        .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setSearchStatus("Zoeken niet beschikbaar"); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [comparing, query, selected]);

  async function replaceSelection(symbols: string[]) {
    setBusy(true);
    setSelectionError(null);
    try {
      const response = await fetch("/api/investing/benchmarks", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols }) });
      if (!response.ok) throw new Error("Selectie opslaan mislukt");
      setSelected(symbols);
      setVisible((current) => new Set(["portfolio", ...symbols.filter((symbol) => current.has(symbol) || !selected.includes(symbol))]));
      window.dispatchEvent(new Event("lavega:dashboard-refresh"));
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "Selectie opslaan mislukt");
    } finally { setBusy(false); }
  }

  const points = data[range] ?? [];
  const selectedSeries = selected.map((symbol) => benchmarks.find((benchmark) => benchmark.symbol === symbol) ?? { symbol, name: symbol, exchange: "Yahoo Finance", currency: "EUR", points: [] });
  const mode = deriveChartMode(selected);
  const indexed = useMemo(() => buildIndexedSeries(points, selectedSeries, externalCashFlows), [points, benchmarks, externalCashFlows, selected.join("\u0000")]);
  const chartPoints = mode === "euros" ? points : points.map((base, index) => {
    const point = indexed[index]!;
    return { ...base, ...point, ...Object.fromEntries(Object.entries(point.benchmarkReturns).map(([symbol, value]) => [`benchmark:${symbol}`, value])) };
  });
  const direction = useMemo(() => {
    const values = points.flatMap((point) => point.value === null ? [] : [point.value]);
    return values.length < 2 || values.at(-1)! >= values[0]! ? "pos" : "neg";
  }, [points]);
  const label = mode === "euros" ? "Portefeuillewaarde" : "Geïndexeerd rendement";

  return <Card>
    <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="relative h-5 text-sm font-medium text-muted-foreground"><span className={`axis-label absolute inset-0 ${mode === "euros" ? "opacity-100" : "opacity-0"}`}>Portefeuillewaarde</span><span className={`axis-label absolute inset-0 ${mode === "indexed" ? "opacity-100" : "opacity-0"}`}>Geïndexeerd rendement</span></p><CardTitle>{mode === "euros" ? "Portefeuille" : "Vergelijking"}</CardTitle></div>
      <div role="group" aria-label="Periode kiezen" className="flex flex-wrap gap-1 rounded-pill bg-secondary p-1">
        {ranges.map((item) => <button key={item.value} type="button" aria-pressed={range === item.value} onClick={() => setRange(item.value)} className={`pressable rounded-pill px-2.5 py-1.5 text-xs font-semibold ${range === item.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{item.label}</button>)}
      </div>
    </CardHeader>
    <CardContent>
      <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Geselecteerde benchmarks">
        {selected.map((symbol, index) => <span key={symbol} className="inline-flex items-center gap-2 rounded-pill bg-secondary px-3 py-1.5 text-xs font-semibold"><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: `hsl(var(--${colors[index]}))` }} />{benchmarks.find((item) => item.symbol === symbol)?.name ?? symbol}<button type="button" disabled={busy} aria-label={`${symbol} verwijderen`} onClick={() => void replaceSelection(selected.filter((item) => item !== symbol))} className="pressable -mr-1 rounded-full px-1 text-muted-foreground hover:text-foreground">×</button></span>)}
        {selected.length < 3 && !comparing && <button type="button" onClick={() => setComparing(true)} className="pressable rounded-pill border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-primary">+ Vergelijk</button>}
      </div>
      {selectionError && <p role="alert" className="mb-4 text-sm text-negative">{selectionError}</p>}
      {comparing && <div className="mb-5 rounded-card border border-border bg-secondary/30 p-3">
        <div className="flex gap-2"><label className="min-w-0 flex-1 text-xs font-semibold">Benchmark zoeken<input autoFocus role="combobox" aria-expanded="true" aria-controls="benchmark-results" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="AEX, DAX, ETF…" className="mt-1.5 w-full rounded-[12px] border border-input bg-background px-3 py-2 text-sm font-normal" /></label><button type="button" onClick={() => setComparing(false)} className="self-end rounded-[12px] px-3 py-2 text-sm font-semibold">Sluiten</button></div>
        {searchStatus && <p role="status" className="mt-2 text-xs text-muted-foreground">{searchStatus}</p>}
        <ul id="benchmark-results" role="listbox" className="mt-2 grid gap-1 sm:grid-cols-2">{results.map((result) => <li key={result.symbol} role="option" aria-selected="false"><button type="button" disabled={busy} onClick={() => { void replaceSelection([...selected, result.symbol]); setComparing(false); setQuery(""); }} className="w-full rounded-[12px] px-3 py-2 text-left hover:bg-background"><span className="block text-sm font-semibold">{result.name}</span><span className="block text-xs text-muted-foreground">{result.symbol} · {result.exchange} · {result.currency}</span></button></li>)}</ul>
      </div>}
      {points.length === 0 ? <EmptyState title="Geen portefeuillegegevens" description="Portefeuillewaarde verschijnt zodra prijsdata beschikbaar is." /> : <>
        <div role="img" aria-label={`${label}, bereik ${ranges.find((item) => item.value === range)?.label}`}>
          <ChartContainer className="h-[320px]" aria-hidden="true">
            <LineChart data={chartPoints} margin={{ top: 12, right: 12, left: 8, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value: string) => value.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} tickFormatter={(value: number) => mode === "euros" ? money(value, currency) : percent(value)} />
              {mode === "indexed" && <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeOpacity={0.35} strokeWidth={1.5} />}
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => new Date(`${value}T00:00:00Z`).toLocaleDateString("nl-NL")} formatter={(value, name) => [mode === "euros" ? money(Number(value), currency) : percent(Number(value)), name === "portfolioReturn" || name === "value" ? "Portefeuille" : String(name).replace("benchmark:", "")]} supplementary={(payload) => mode === "indexed" && typeof payload[0]?.payload?.portfolioValue === "number" ? <p className="mt-1 border-t border-border pt-1 text-muted-foreground">Portefeuillewaarde: {money(payload[0].payload.portfolioValue, currency)}</p> : null} />} />
              <Line dataKey={mode === "euros" ? "value" : "portfolioReturn"} name="Portefeuille" hide={!visible.has("portfolio")} connectNulls={false} stroke={`hsl(var(--${mode === "euros" ? direction : "pos"}))`} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              {mode === "indexed" && selectedSeries.map((benchmark, index) => <Line key={benchmark.symbol} dataKey={`benchmark:${benchmark.symbol}`} name={benchmark.name} hide={!visible.has(benchmark.symbol)} connectNulls={false} stroke={`hsl(var(--${colors[index]}))`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />)}
            </LineChart>
          </ChartContainer>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs" aria-label="Grafiekseries">
          <button type="button" aria-pressed={visible.has("portfolio")} onClick={() => setVisible(toggle(visible, "portfolio"))} className="pressable inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-muted-foreground"><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: `hsl(var(--${mode === "euros" ? direction : "pos"}))` }} />Portefeuille</button>
          {selectedSeries.map((benchmark, index) => <button key={benchmark.symbol} type="button" aria-pressed={visible.has(benchmark.symbol)} onClick={() => setVisible(toggle(visible, benchmark.symbol))} className="pressable inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-muted-foreground"><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: `hsl(var(--${colors[index]}))` }} />{benchmark.name}</button>)}
        </div>
      </>}
    </CardContent>
  </Card>;
}

function toggle(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}
