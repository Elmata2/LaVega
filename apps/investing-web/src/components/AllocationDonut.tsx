import { useState } from "react";
import { Cell, Pie, PieChart } from "recharts";
import type { Allocation, InvestingDashboardData } from "@lavega/core";
import { EmptyState } from "./EmptyState";
import { Swatch } from "./Swatch";
import { Segmented } from "./ui/segmented";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer } from "./ui/chart";

type AllocationLadderView = NonNullable<InvestingDashboardData["allocation"]["ladder"]>;

type AllocationDonutProps = {
  instrument: Allocation;
  entity: Allocation;
  /** Platform split. Absent on a dashboard stored before broker provenance. */
  broker?: Allocation;
  /** Cash-aware ladder with the documented denominator (WS4.6, #297). Absent
   *  on a dashboard payload stored before the ladder existed. */
  ladder?: AllocationLadderView;
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

// Largest-remainder (Hamilton) apportionment: floor every share, then hand
// the leftover points to the largest fractional remainders, so the displayed
// integers always sum to exactly 100 instead of drifting from independent
// per-bucket rounding.
const groupOptions = [
  { value: "instrument" as const, label: "Holding" },
  { value: "entity" as const, label: "Entity" },
  { value: "broker" as const, label: "Platform" },
];

export function apportionPercentages(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const shares = values.map((value) => (value / total) * 100);
  const floors = shares.map(Math.floor);
  const remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  const byRemainder = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const result = [...floors];
  for (let i = 0; i < remainder; i += 1) result[byRemainder[i]!.index] += 1;
  return result;
}

function buildDisplayBuckets(
  priced: { key: string; label: string; value: number | null }[],
): DisplayBucket[] {
  const sorted = [...priced]
    .filter((bucket): bucket is { key: string; label: string; value: number } => !!bucket.value)
    .map((bucket) => ({ ...bucket, label: bucket.label || "Unclassified" }))
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

const LADDER_PREVIEW_ROWS = 12;

function LadderRows({
  ladder,
  currency,
}: {
  ladder: AllocationLadderView["instrument"];
  currency: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const hidden = ladder.rows.filter(
    (row, index) => row.kind === "holding" && index >= LADDER_PREVIEW_ROWS,
  ).length;
  const rows =
    showAll || hidden === 0
      ? ladder.rows
      : ladder.rows.filter((row, index) => row.kind !== "holding" || index < LADDER_PREVIEW_ROWS);
  return (
    <div className="mt-5 border-t border-border pt-4" data-dashboard-section="allocation-ladder">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Ladder</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {ladder.weightsSum === null
            ? "Weights unknown"
            : `Weights ${(ladder.weightsSum * 100).toFixed(1)}%`}
        </span>
      </div>
      <ul aria-label="Allocation ladder" className="mt-2 space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={`${row.kind}-${row.key}`} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`truncate ${row.kind === "cash" ? "font-semibold" : ""} ${
                  row.kind === "unclassified" ? "text-warning" : ""
                }`}
              >
                {row.label}
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                {row.weight === null ? "Unknown" : `${(row.weight * 100).toFixed(1)}%`}
              </span>
              <span className="min-w-16 text-right font-semibold tabular-nums">
                {row.value === null
                  ? "Unknown"
                  : row.value.toLocaleString("en-GB", {
                      style: "currency",
                      currency,
                      maximumFractionDigits: 0,
                    })}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((open) => !open)}
          className="mt-2 text-xs font-semibold text-accent hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${ladder.rows.length} rows`}
        </button>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{ladder.denominatorRule}</p>
    </div>
  );
}

export function AllocationDonut({
  instrument,
  entity,
  broker,
  ladder,
  currency = "EUR",
}: AllocationDonutProps) {
  const [group, setGroup] = useState<"instrument" | "entity" | "broker">("instrument");
  const [showOverige, setShowOverige] = useState(false);
  const allocation =
    group === "instrument" ? instrument : group === "broker" ? (broker ?? entity) : entity;
  const groupNoun = group === "instrument" ? "holding" : group === "broker" ? "platform" : "entity";
  const priced = allocation.buckets.filter(
    (bucket) => !bucket.unpriced && bucket.value !== null && bucket.value > 0,
  );
  const display = buildDisplayBuckets(priced);
  const percentages = apportionPercentages(display.map((bucket) => bucket.value));

  return (
    <Card>
      <CardHeader gap="wide" className="flex-row items-start justify-between">
        <CardTitle>Allocation</CardTitle>
        <Segmented
          label="Group allocation"
          value={group}
          options={broker ? groupOptions : groupOptions.slice(0, 2)}
          onValueChange={(next) => {
            setGroup(next);
            setShowOverige(false);
          }}
        />
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
              aria-label={`Portfolio allocation per ${groupNoun}`}
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
                      /* The card mounts below the fold, and Recharts' sweep
                       * never advances past its first frame there — the ring
                       * renders as three 3-degree slivers until a resize
                       * forces a re-render. A static allocation snapshot has
                       * nothing to gain from sweeping anyway. */
                      isAnimationActive={false}
                    >
                      {display.map((bucket) => (
                        <Cell key={bucket.key} fill={bucket.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              ) : (
                <div className="mx-auto flex size-[180px] items-center justify-center rounded-full border-22 border-secondary text-center text-xs text-muted-foreground">
                  Not priced
                </div>
              )}
            </div>
            <ul aria-label="Allocation details" className="space-y-3 text-sm">
              {display.map((bucket, index) => (
                <li key={bucket.key}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <Swatch className="size-2 shrink-0 rounded-full" color={bucket.color} />
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
                        {percentages[index]}%
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
                    <div className="mt-3 rounded-tile border border-border/70 bg-secondary/40 p-3">
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
              {group === "broker" &&
                allocation.buckets
                  .filter((bucket) => bucket.value === null)
                  .map((bucket) => (
                    <li
                      key={`unknown-${bucket.key}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Swatch className="size-2 shrink-0 rounded-full" color={otherColor} />
                        <span className="truncate">{bucket.label}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">Value unknown</span>
                    </li>
                  ))}
              {allocation.unpriced.length > 0 && (
                <li role="status" className="border-t border-warning/30 pt-3 text-warning">
                  <span className="font-semibold">Value unknown:</span>{" "}
                  {allocation.unpriced.join(", ")}
                  <span className="block text-xs text-muted-foreground">
                    No usable price yet, so they stay out of the chart and percentage. Allow market
                    data on Overview; the next price sync values them.
                  </span>
                </li>
              )}
            </ul>
          </div>
        )}
        {ladder && group !== "broker" && (
          <LadderRows
            ladder={group === "instrument" ? ladder.instrument : ladder.entity}
            currency={currency}
          />
        )}
      </CardContent>
    </Card>
  );
}
