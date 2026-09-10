import { useState } from "react";
import { Cell, Pie, PieChart } from "recharts";
import type { Allocation } from "@lavega/core";
import { EmptyState } from "./EmptyState";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer } from "./ui/chart";

type AllocationDonutProps = {
  instrument: Allocation;
  entity: Allocation;
  currency?: string;
};

const colors = [
  "hsl(var(--chart-blue))",
  "hsl(var(--chart-teal))",
  "hsl(var(--chart-purple))",
  "hsl(var(--chart-amber))",
  "hsl(var(--chart-coral))",
  "hsl(var(--chart-blue) / 0.72)",
  "hsl(var(--chart-teal) / 0.72)",
  "hsl(var(--chart-purple) / 0.72)",
  "hsl(var(--chart-amber) / 0.72)",
  "hsl(var(--chart-coral) / 0.72)",
];
const otherColor = "hsl(var(--muted-foreground) / 0.35)";
// A donut reads as at most a handful of wedges. Past that, per-slice padding
// angle eats more arc than the data itself and the ring turns into a row of
// disconnected ticks. Cap named slices and fold the rest into one "Other"
// wedge instead of rendering every holding.
const MAX_NAMED_BUCKETS = 10;

type DisplayBucket = {
  key: string;
  label: string;
  value: number;
  color: string;
  members?: { key: string; label: string; value: number }[];
};

function buildDisplayBuckets(
  priced: { key: string; label: string; value: number | null }[],
): DisplayBucket[] {
  const sorted = [...priced]
    .filter((bucket): bucket is { key: string; label: string; value: number } => !!bucket.value)
    .sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_NAMED_BUCKETS) {
    return sorted.map((bucket, index) => ({ ...bucket, color: colors[index] }));
  }
  const named = sorted.slice(0, MAX_NAMED_BUCKETS);
  const rest = sorted.slice(MAX_NAMED_BUCKETS);
  return [
    ...named.map((bucket, index) => ({ ...bucket, color: colors[index] })),
    {
      key: "__overige",
      label: `Other (${rest.length})`,
      value: rest.reduce((sum, bucket) => sum + bucket.value, 0),
      color: otherColor,
      members: rest,
    },
  ];
}

export function AllocationDonut({ instrument, entity, currency = "EUR" }: AllocationDonutProps) {
  const [group, setGroup] = useState<"instrument" | "entity">("instrument");
  const [showOverige, setShowOverige] = useState(false);
  const allocation = group === "instrument" ? instrument : entity;
  const priced = allocation.buckets.filter(
    (bucket) => !bucket.unpriced && bucket.value !== null && bucket.value > 0,
  );
  const display = buildDisplayBuckets(priced);
  const total = display.reduce((sum, bucket) => sum + bucket.value, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Allocation</p>
          <CardTitle>Portfolio</CardTitle>
        </div>
        <div
          aria-label="Group allocation"
          className="flex rounded-pill bg-secondary p-1"
          role="group"
        >
          <Button
            aria-pressed={group === "instrument"}
            className="rounded-pill"
            onClick={() => {
              setGroup("instrument");
              setShowOverige(false);
            }}
            size="sm"
            variant={group === "instrument" ? "default" : "ghost"}
          >
            Holding
          </Button>
          <Button
            aria-pressed={group === "entity"}
            className="rounded-pill"
            onClick={() => {
              setGroup("entity");
              setShowOverige(false);
            }}
            size="sm"
            variant={group === "entity" ? "default" : "ghost"}
          >
            Entity
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {priced.length === 0 && allocation.unpriced.length === 0 ? (
          <EmptyState
            title="No positions"
            description="Your allocation appears after the first broker sync."
          />
        ) : (
          <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <div
              className="relative"
              role="img"
              aria-label={`Portfolio allocation per ${group === "instrument" ? "holding" : "entity"}`}
            >
              {display.length > 0 ? (
                <ChartContainer className="h-[180px]" aria-hidden="true">
                  <PieChart>
                    <Pie
                      data={display}
                      dataKey="value"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius="62%"
                      outerRadius="88%"
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {display.map((bucket) => (
                        <Cell key={bucket.key} fill={bucket.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              ) : (
                <div className="mx-auto flex size-[180px] items-center justify-center rounded-full border-[22px] border-secondary text-center text-xs text-muted-foreground">
                  Not priced
                </div>
              )}
            </div>
            <ul aria-label="Allocation details" className="space-y-3 text-sm">
              {display.map((bucket) => (
                <li key={bucket.key}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: bucket.color }}
                      />
                      {bucket.members ? (
                        <button
                          aria-expanded={showOverige}
                          className="truncate underline decoration-dotted underline-offset-2"
                          onClick={() => setShowOverige((value) => !value)}
                          type="button"
                        >
                          {bucket.label}
                        </button>
                      ) : (
                        <span className="truncate">{bucket.label}</span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.round((bucket.value / total) * 100)}%
                      </span>
                      <span className="font-semibold tabular-nums">
                        {bucket.value.toLocaleString("en-GB", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 0,
                        })}
                      </span>
                    </span>
                  </div>
                  {bucket.members && showOverige && (
                    <div className="mt-3 rounded-lg border border-border/70 bg-secondary/40 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold text-foreground">Other holdings</span>
                        <span className="tabular-nums text-muted-foreground">
                          {bucket.members.length} positions
                        </span>
                      </div>
                      <ul className="grid max-h-52 gap-x-4 gap-y-2 overflow-y-auto pr-1 sm:grid-cols-2">
                        {bucket.members.map((member) => (
                          <li
                            className="flex items-center justify-between gap-3 text-muted-foreground"
                            key={member.key}
                          >
                            <span className="truncate">{member.label}</span>
                            <span className="tabular-nums">
                              {member.value.toLocaleString("en-GB", {
                                style: "currency",
                                currency,
                                maximumFractionDigits: 0,
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
              {allocation.unpriced.length > 0 && (
                <li role="status" className="border-t border-warning/30 pt-3 text-warning">
                  <span className="font-semibold">Value unknown:</span>{" "}
                  {allocation.unpriced.join(", ")}
                  <span className="block text-xs text-muted-foreground">
                    Not included in the chart or percentage.
                  </span>
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
