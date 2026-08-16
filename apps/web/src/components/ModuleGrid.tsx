import type { ReactNode } from "react";
import { MODULE_GRID_CLASS } from "../module-grid.js";

/* The homescreen grid. Children are <Module> blocks that declare their own
 * span; the grid places them and collapses 3 → 2 → 1 columns as the viewport
 * narrows (styles/modules.css). It holds no layout knowledge of its own, so a
 * new module is one line inside it. */

type ModuleGridProps = {
  /** Accessible name for the region, e.g. "Overzicht". */
  label?: string;
  className?: string;
  children: ReactNode;
};

export default function ModuleGrid({ label, className, children }: ModuleGridProps) {
  return (
    <div className={className ? `${MODULE_GRID_CLASS} ${className}` : MODULE_GRID_CLASS} role="group" aria-label={label}>
      {children}
    </div>
  );
}
