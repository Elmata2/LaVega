import { useState } from "react";
import { Cell, Pie, PieChart } from "recharts";
import type { Allocation } from "@lavega/core";
import { EmptyState } from "./EmptyState";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer } from "./ui/chart";

type AllocationDonutProps = {
  instrument: Allocation;
  broker: Allocation;
};

const colors = ["hsl(var(--chart-blue))", "hsl(var(--chart-teal))", "hsl(var(--chart-purple))", "hsl(var(--chart-amber))", "hsl(var(--chart-coral))"];

export function AllocationDonut({ instrument, broker }: AllocationDonutProps) {
  const [group, setGroup] = useState<"instrument" | "broker">("instrument");
  const allocation = group === "instrument" ? instrument : broker;
  const priced = allocation.buckets.filter((bucket) => !bucket.unpriced && bucket.value !== null && bucket.value > 0);

  return <Card>
    <CardHeader className="flex-row items-start justify-between gap-4">
      <div><p className="text-sm font-medium text-muted-foreground">Verdeling</p><CardTitle>Portefeuille</CardTitle></div>
      <div aria-label="Verdeling groeperen" className="flex rounded-pill bg-secondary p-1" role="group">
        <Button aria-pressed={group === "instrument"} className="rounded-pill" onClick={() => setGroup("instrument")} size="sm" variant={group === "instrument" ? "default" : "ghost"}>Belegging</Button>
        <Button aria-pressed={group === "broker"} className="rounded-pill" onClick={() => setGroup("broker")} size="sm" variant={group === "broker" ? "default" : "ghost"}>Broker</Button>
      </div>
    </CardHeader>
    <CardContent>
      {priced.length === 0 && allocation.unpriced.length === 0 ? <EmptyState title="Geen posities" description="Jouw verdeling verschijnt na de eerste brokersynchronisatie." /> : <div className="grid gap-5 sm:grid-cols-[minmax(180px,220px)_1fr] sm:items-center">
        <div className="relative" role="img" aria-label={`Portefeuilleverdeling per ${group === "instrument" ? "belegging" : "broker"}`}>
          {priced.length > 0 ? <ChartContainer className="h-[220px]" aria-hidden="true"><PieChart><Pie data={priced} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="62%" outerRadius="88%" paddingAngle={2} strokeWidth={0}>{priced.map((bucket, index) => <Cell key={bucket.key} fill={colors[index % colors.length]} />)}</Pie></PieChart></ChartContainer> : <div className="flex h-[220px] items-center justify-center rounded-full border-[22px] border-secondary text-center text-xs text-muted-foreground">Niet geprijsd</div>}
        </div>
        <ul aria-label="Verdelingsdetails" className="space-y-3 text-sm">
          {priced.map((bucket, index) => <li className="flex items-center justify-between gap-3" key={bucket.key}><span className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} /><span className="truncate">{bucket.label}</span></span><span className="font-semibold tabular-nums">{bucket.value?.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}</span></li>)}
          {allocation.unpriced.length > 0 && <li className="border-t border-border pt-3 text-muted-foreground">Niet geprijsd: {allocation.unpriced.join(", ")}</li>}
        </ul>
      </div>}
    </CardContent>
  </Card>;
}
