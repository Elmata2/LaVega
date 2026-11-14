import type { ReactNode } from "react";
import type { WidgetId } from "./moduleRegistry";
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

/** The pieces of a module, for a block that is shown inside a module it does not
 *  own (the Home chart slot). The block's own `Module` is built from the same
 *  pieces, so the content is written once. */
export type ModuleParts = {
  title: string;
  menu: ReactNode;
  footer: ReactNode;
  body: ReactNode;
};

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
  /** Set by a widget card: its heading becomes a focus target, so the add area
   *  can move focus to a card that was just switched on. */
  widgetId?: WidgetId;
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
  widgetId,
  children,
}: ModuleProps) {
  return (
    <section
      className={moduleClass({ span, height, className })}
      data-span={span ?? 1}
      aria-label={title}
    >
      <header className="module-head">
        <h2
          className="module-title"
          {...(widgetId ? { tabIndex: -1, "data-widget": widgetId } : {})}
        >
          {title}
        </h2>
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
