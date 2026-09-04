import type { ComponentProps, ReactNode } from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "../../lib/utils";

export type ChartConfig = Record<string, { label?: ReactNode; color?: string }>;

export function ChartContainer({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("h-[280px] w-full", className)} {...props}>
      <ResponsiveContainer width="100%" height="100%">
        {children as never}
      </ResponsiveContainer>
    </div>
  );
}

export function ChartTooltip(props: ComponentProps<typeof Tooltip>) {
  return <Tooltip {...props} />;
}

type TooltipEntry = {
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
  payload?: Record<string, unknown>;
};
export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  supplementary,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelFormatter?: (label: string | number) => ReactNode;
  formatter?: (
    value: string | number | undefined,
    name: string | number | undefined,
  ) => [ReactNode, ReactNode];
  supplementary?: (payload: TooltipEntry[]) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-soft">
      <p className="mb-1 text-muted-foreground">
        {labelFormatter ? labelFormatter(label ?? "") : label}
      </p>
      {payload.map((entry) => {
        const formatted = formatter?.(entry.value, entry.name);
        return (
          <p key={entry.dataKey} className="font-semibold">
            {formatted ? `${formatted[1]}: ${formatted[0]}` : `${entry.name}: ${entry.value}`}
          </p>
        );
      })}
      {supplementary?.(payload)}
    </div>
  );
}
