import type { PositionPricePoint } from "@lavega/core";
import { Line, LineChart, ReferenceDot, XAxis, YAxis } from "recharts";
import { EmptyState } from "./EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

type PositionPriceChartProps = {
  symbol: string;
  currency: string;
  points: PositionPricePoint[];
};

const markerColors = { buy: "hsl(var(--pos))", sell: "hsl(var(--neg))", dividend: "hsl(var(--chart-amber))" } as const;

export function PositionPriceChart({ symbol, currency, points }: PositionPriceChartProps) {
  const markers = points.flatMap((point) => point.markers.map((marker, index) => ({ ...marker, date: point.date, close: point.close, index })));
  return <Card>
    <CardHeader><p className="text-sm font-medium text-muted-foreground">Koershistorie</p><CardTitle>{symbol}</CardTitle></CardHeader>
    <CardContent>
      {points.length === 0 ? <EmptyState title="Geen koershistorie" description="Prijsdata verschijnt zodra de eerste synchronisatie klaar is." /> : <>
        <div role="img" aria-label={`Koershistorie van ${symbol} met ${markers.length} markeringen`}>
          <ChartContainer className="h-[300px]" aria-hidden="true">
            <LineChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => `${value}`} />
              <ChartTooltip content={<ChartTooltipContent />} labelFormatter={(label) => `${label}`} formatter={(value) => [`${Number(value ?? 0).toLocaleString("nl-NL")} ${currency}`, "Koers"]} />
              <Line type="monotone" dataKey="close" name="Koers" stroke="hsl(var(--chart-blue))" strokeWidth={2} dot={false} isAnimationActive={false} />
              {markers.map((marker, index) => <ReferenceDot key={`${marker.eventDate}-${marker.kind}-${index}`} x={marker.date} y={marker.close} r={5} fill={markerColors[marker.kind]} stroke="hsl(var(--background))" strokeWidth={2} ifOverflow="extendDomain" />)}
            </LineChart>
          </ChartContainer>
        </div>
        <div aria-label="Koersmarkeringen" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {(["buy", "sell", "dividend"] as const).map((kind) => <span key={kind} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: markerColors[kind] }} />{kind === "buy" ? "Koop" : kind === "sell" ? "Verkoop" : "Dividend"}</span>)}
        </div>
        {markers.length > 0 && <ul className="sr-only" aria-label="Koersmarkeringen details">{markers.map((marker, index) => <li key={`${marker.eventDate}-${index}`}>{marker.eventDate}: {marker.label}</li>)}</ul>}
      </>}
    </CardContent>
  </Card>;
}
