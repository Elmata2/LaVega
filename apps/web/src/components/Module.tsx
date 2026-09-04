import type { ReactNode } from "react";
import { moduleClass, type ModuleHeight, type ModuleSpan } from "../module-grid.js";

/* The module card every homescreen block is built from.
 *
 *   <Module title="Positie" span={2} height="tall"
 *           period={<ModulePeriod value={p} onChange={setP} options={…} />}
 *           menu={<ModuleMenu label="Meer" onClick={…} />}>
 *     …content…
 *   </Module>
 *
 * Title, period control and "…" slot sit in one header row; the body fills the
 * rest of the card. Span/height are the only layout knobs — see module-grid.ts. */

type ModuleProps = {
  title: string;
  span?: ModuleSpan;
  height?: ModuleHeight;
  /** Right-hand period control, e.g. <ModulePeriod/>. */
  period?: ReactNode;
  /** Right-hand overflow slot, e.g. <ModuleMenu/>. */
  menu?: ReactNode;
  /** Muted line under the body, e.g. a source or an "as of" note. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
};

export default function Module({
  title,
  span,
  height,
  period,
  menu,
  footer,
  className,
  children,
}: ModuleProps) {
  return (
    <section className={moduleClass({ span, height, className })} aria-label={title}>
      <header className="module-head">
        <h2 className="module-title">{title}</h2>
        {(period || menu) && (
          <div className="module-controls">
            {period}
            {menu}
          </div>
        )}
      </header>

      <div className="module-body">{children}</div>

      {footer && <div className="module-foot">{footer}</div>}
    </section>
  );
}

type ModulePeriodProps = {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  /** Accessible name; the visible control is the pill select itself. */
  label?: string;
};

/** The reference's "Week ▾" pill dropdown. */
export function ModulePeriod({ value, options, onChange, label = "Periode" }: ModulePeriodProps) {
  return (
    <select
      className="module-period"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type ModuleMenuProps = {
  label: string;
  onClick: () => void;
};

/** The reference's "…" overflow button. */
export function ModuleMenu({ label, onClick }: ModuleMenuProps) {
  return (
    <button
      type="button"
      className="module-menu"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <span aria-hidden="true">···</span>
    </button>
  );
}
