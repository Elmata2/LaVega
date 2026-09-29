import { HOME_MODULE, MODULES, WIDGETS } from "../lib/investingRegistry.js";
import type { InvestingModuleId, InvestingWidgetId } from "@lavega/core";

/* One row per module or widget: preview, label, one line, switch. Mirrors
 * apps/web/src/components/ModulePicker.tsx's row shape, hand-rolled as a
 * role="switch" button rather than a new shadcn Switch import — investing-web
 * has no Switch component yet and one control does not earn a new dependency. */

/* `onChange` reports only the switch that moved, so a caller saves that one
 * choice instead of re-stating every id (which would pin today's defaults
 * and could overwrite choices it hasn't loaded yet). */
type LayoutPickerProps =
  | {
      kind: "module";
      enabled: Array<InvestingModuleId | typeof HOME_MODULE>;
      onChange: (id: InvestingModuleId, on: boolean) => void;
      disabled?: boolean;
    }
  | {
      kind: "widget";
      enabled: InvestingWidgetId[];
      onChange: (id: InvestingWidgetId, on: boolean) => void;
      disabled?: boolean;
    };

export function Switch({
  on,
  disabled,
  label,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      aria-disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-pill border border-border transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-secondary"}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 size-5 rounded-pill bg-background transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function LayoutPicker(props: LayoutPickerProps) {
  if (props.kind === "module") {
    const on = new Set(props.enabled);
    return (
      <ul className="divide-y divide-border">
        {MODULES.map((m) => {
          const locked = m.id === HOME_MODULE;
          const isOn = on.has(m.id);
          return (
            <li key={m.id} className="flex items-center gap-4 py-4">
              {m.preview}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{m.label}</p>
                <p className="text-sm text-muted-foreground">{m.what}</p>
                {locked && <p className="text-xs text-muted-foreground">Always on.</p>}
              </div>
              <Switch
                on={isOn}
                disabled={locked || props.disabled}
                label={`${m.label} in the top bar`}
                onToggle={() => {
                  if (m.id !== HOME_MODULE) props.onChange(m.id, !isOn);
                }}
              />
            </li>
          );
        })}
      </ul>
    );
  }
  const on = new Set(props.enabled);
  return (
    <ul className="divide-y divide-border">
      {WIDGETS.map((w) => {
        const isOn = on.has(w.id);
        return (
          <li key={w.id} className="flex items-center gap-4 py-4">
            {w.preview}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{w.label}</p>
              <p className="text-sm text-muted-foreground">{w.what}</p>
            </div>
            <Switch
              on={isOn}
              disabled={props.disabled}
              label={`${w.label} on Overview`}
              onToggle={() => props.onChange(w.id, !isOn)}
            />
          </li>
        );
      })}
    </ul>
  );
}
