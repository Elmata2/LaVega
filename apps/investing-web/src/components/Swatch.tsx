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
