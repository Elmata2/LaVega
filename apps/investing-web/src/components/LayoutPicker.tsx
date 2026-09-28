import { HOME_MODULE, MODULES, WIDGETS } from "../lib/investingRegistry.js";
import type { InvestingModuleId, InvestingWidgetId } from "@lavega/core";

/* One row per module or widget: preview, label, one line, switch. Mirrors
 * apps/web/src/components/ModulePicker.tsx's row shape, hand-rolled as a
 * role="switch" button rather than a new shadcn Switch import — investing-web
 * has no Switch component yet and one control does not earn a new dependency. */

type LayoutPickerProps =
  | {
      kind: "module";
      enabled: Array<InvestingModuleId | typeof HOME_MODULE>;
      onChange: (next: InvestingModuleId[]) => void;
    }
  | { kind: "widget"; enabled: InvestingWidgetId[]; onChange: (next: InvestingWidgetId[]) => void };

function Switch({
  on,
  locked,
  label,
  onToggle,
}: {
  on: boolean;
  locked?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked}
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
                locked={locked}
                label={`${m.label} in the top bar`}
                onToggle={() => {
                  if (locked) return;
                  const next = isOn ? [...on].filter((id) => id !== m.id) : [...on, m.id];
                  props.onChange(next.filter((id): id is InvestingModuleId => id !== HOME_MODULE));
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
              label={`${w.label} on Overview`}
              onToggle={() => {
                const next = isOn ? [...on].filter((id) => id !== w.id) : [...on, w.id];
                props.onChange(next);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
