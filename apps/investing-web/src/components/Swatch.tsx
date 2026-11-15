import type { CSSProperties } from "react";
import { cn } from "../lib/utils";

export function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("bg-(--swatch)", className)}
      style={{ "--swatch": color } as CSSProperties}
    />
  );
}

/** Legend sample for a line series: same colour and stroke style as the line,
 *  so the legend matches the chart without colour being the only cue. */
export function LineSwatch({
  color,
  dashed = false,
  thick = false,
  className,
}: {
  color: string;
  dashed?: boolean;
  thick?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block w-5 border-t-(length:--line-w) border-t-(--swatch)",
        dashed ? "border-dashed" : "border-solid",
        className,
      )}
      style={{ "--swatch": color, "--line-w": thick ? "3px" : "2px" } as CSSProperties}
    />
  );
}
