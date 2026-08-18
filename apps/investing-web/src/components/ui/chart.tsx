import type { ComponentProps, ReactNode } from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "../../lib/utils";

export type ChartConfig = Record<string, { label?: ReactNode; color?: string }>;

export function ChartContainer({ className, children, ...props }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("h-[280px] w-full", className)} {...props}><ResponsiveContainer width="100%" height="100%">{children as never}</ResponsiveContainer></div>;
}

export function ChartTooltip(props: ComponentProps<typeof Tooltip>) {
  return <Tooltip {...props} />;
}

type TooltipEntry = { dataKey?: string | number; name?: string | number; value?: string | number };
export function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-soft"><p className="mb-1 text-muted-foreground">{label}</p>{payload.map((entry) => <p key={entry.dataKey} className="font-semibold">{entry.name}: {entry.value}</p>)}</div>;
}
