import type { FigureUnit } from "@lavega/core";
import type { PlanFmt } from "../copy/plan/index.js";

/** One figure as text, by its unit. Null is the shell's dash, never a zero. */
export function formatFigure(
  value: number | string | null,
  unit: FigureUnit,
  fmt: PlanFmt,
  dash: string,
): string {
  if (value === null) return dash;
  if (unit === "date") return typeof value === "string" ? fmt.date(value) : dash;
  if (typeof value !== "number") return String(value);
  switch (unit) {
    case "cents":
      return fmt.eur(value);
    case "months":
      return fmt.monthsLabel(value);
    case "ratio":
      return fmt.pct(value);
    case "pct":
      return fmt.points(value);
    case "count":
      return fmt.count(value);
    case "years":
      return fmt.yearsLabel(value);
    default:
      return String(value);
  }
}
