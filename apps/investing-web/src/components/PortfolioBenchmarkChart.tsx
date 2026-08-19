import type { PortfolioBenchmarkPoint, PortfolioRange } from "@lavega/core";
import { useMemo, useState } from "react";
import { Line, LineChart, XAxis, YAxis } from "recharts";
import { EmptyState } from "./EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

const ranges: { value: PortfolioRange; label: string }[] = [
  { value: "1M", label: "1 maand" },
  { value: "6M", label: "6 maanden" },
  { value: "1Y", label: "1 jaar" },
  { value: "YTD", label: "Dit jaar" },
  { value: "All", label: "Alles" },
];

type PortfolioBenchmarkChartProps = {
  data: Partial<Record<PortfolioRange, PortfolioBenchmarkPoint[]>>;
  currency?: string;
};

const money = (value: number, currency: string) => value.toLocaleString("nl-NL", {
  style: "currency",
  currency,
  maximumFractionDigits: 2,
});

export function PortfolioBenchmarkChart({ data, currency = "EUR" }: PortfolioBenchmarkChartProps) {
  const [range, setRange] = useState<PortfolioRange>("1M");
  const points = data[range] ?? [];
  const direction = useMemo(() => {
    const values = points.flatMap((point) => point.portfolioValue === null ? [] : [point.portfolioValue]);
    return values.at(-1)! >= values[0]! ? "pos" : "neg";
  }, [points]);
  const description = points.length === 0
    ? "Geen portefeuille- of benchmarkgegevens beschikbaar"
    : `Portefeuillewaarde in ${currency} en S&P 500, bereik ${ranges.find((item) => item.value === range)?.label}`;

  return <Card>
    <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-sm font-medium text-muted-foreground">Portefeuillewaarde</p><CardTitle>Versus S&amp;P 500</CardTitle></div>
      <div role="group" aria-label="Periode kiezen" className="flex flex-wrap gap-1 rounded-pill bg-secondary p-1">
        {ranges.map((item) => <button key={item.value} type="button" aria-pressed={range === item.value} onClick={() => setRange(item.value)} className={`pressable rounded-pill px-2.5 py-1.5 text-xs font-semibold ${range === item.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{item.label}</button>)}
      </div>
    </CardHeader>
    <CardContent>
      {points.length === 0 ? <EmptyState title="Geen portefeuillegegevens" description="Portefeuillewaarde verschijnt zodra prijsdata beschikbaar is." /> : <>
        <div role="img" aria-label={description}>
          <ChartContainer className="h-[320px]" aria-hidden="true">
            <LineChart data={points} margin={{ top: 12, right: 12, left: 8, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value: string) => value.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} tickFormatter={(value: number) => money(value, currency)} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => new Date(`${label}T00:00:00Z`).toLocaleDateString("nl-NL")} formatter={(value, name) => [money(Number(value), currency), name === "portfolioValue" ? "Portefeuille" : "S&P 500"]} />} />
              <Line dataKey="portfolioValue" name="Portefeuille" connectNulls={false} stroke={`hsl(var(--${direction}))`} strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line dataKey="benchmarkValue" name="S&P 500" connectNulls={false} stroke="hsl(var(--chart-purple))" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Grafiekseries">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: `hsl(var(--${direction}))` }} />Portefeuille ({currency})</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--chart-purple))]" />S&amp;P 500</span>
        </div>
        <ul className="sr-only" aria-label="Exacte grafiekwaarden">{points.map((point) => <li key={point.date}>{point.date}: {point.portfolioValue === null ? "portefeuille onbekend" : money(point.portfolioValue, currency)}; {point.benchmarkValue === null ? "S&P 500 onbekend" : money(point.benchmarkValue, currency)}</li>)}</ul>
      </>}
    </CardContent>
  </Card>;
}
