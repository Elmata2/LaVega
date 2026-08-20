import type { ReactNode } from "react";
import {
  HOME_MODULE,
  MODULES,
  WIDGETS,
  toggleModule,
  toggleWidget,
  type ModuleId,
  type WidgetId,
} from "./moduleRegistry";

/* The module picker: every module in the registry, with its preview, one line
 * of what it does, and a switch. On = it appears in the top nav; off = it
 * disappears. That is the whole point of the modular grid — the nav becomes the
 * owner's own selection instead of the full catalogue.
 *
 * The picker owns no state: it hands the caller the NEXT list (computed by the
 * registry, which is what keeps Overzicht unremovable) and the caller persists
 * it. Reached from the profile, and from "Widget toevoegen" in the header —
 * the same idea from the other end.
 *
 * Below it, the same picker for the two homescreen WIDGETS (Aandacht, Positie
 * per bedrijf). Same list, same switch, same wording — a card you switch on and
 * a tab you switch on are the same gesture, so they must not look like two
 * different mechanisms. */

/** One row: preview, label, one line, switch. Shared by both pickers so the
 *  two never drift apart visually. */
function PickerRow({
  preview,
  label,
  what,
  note,
  on,
  locked,
  switchLabel,
  onToggle,
}: {
  preview: ReactNode;
  label: string;
  what: string;
  note?: string;
  on: boolean;
  locked?: boolean;
  /** Accessible name of the switch, e.g. "Valuta in de navigatie". */
  switchLabel: string;
  onToggle: () => void;
}) {
  return (
    <li className="mp-item">
      <div className="mp-preview">{preview}</div>

      <div className="mp-text">
        <span className="mp-label">{label}</span>
        <span className="mp-what">{what}</span>
        {note && <span className="mp-note">{note}</span>}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={switchLabel}
        disabled={locked}
        className={`mp-toggle${on ? " on" : ""}`}
        onClick={onToggle}
      >
        <span className="mp-knob" aria-hidden="true" />
      </button>
    </li>
  );
}

type ModulePickerProps = {
  enabled: ModuleId[];
  onChange: (next: ModuleId[]) => void;
};

export default function ModulePicker({ enabled, onChange }: ModulePickerProps) {
  const on = new Set<ModuleId>(enabled);

  return (
    <ul className="module-picker">
      {MODULES.map((m) => {
        const isOn = on.has(m.id);
        const locked = m.id === HOME_MODULE;
        return (
          <PickerRow
            key={m.id}
            preview={m.preview}
            label={m.label}
            what={m.what}
            note={locked ? "Je startpagina — staat altijd in de navigatie." : undefined}
            on={isOn}
            locked={locked}
            switchLabel={`${m.label} in de navigatie`}
            onToggle={() => onChange(toggleModule(enabled, m.id, !isOn))}
          />
        );
      })}
    </ul>
  );
}

type WidgetPickerProps = {
  enabled: WidgetId[];
  onChange: (next: WidgetId[]) => void;
};

/** The two cards on the homescreen that are a choice rather than a fixture.
 *  Nothing is locked here: a homescreen without either of them is still a
 *  homescreen, so both switches are always usable. */
export function WidgetPicker({ enabled, onChange }: WidgetPickerProps) {
  const on = new Set<WidgetId>(enabled);

  return (
    <ul className="module-picker">
      {WIDGETS.map((w) => {
        const isOn = on.has(w.id);
        return (
          <PickerRow
            key={w.id}
            preview={w.preview}
            label={w.label}
            what={w.what}
            on={isOn}
            switchLabel={`${w.label} op je overzicht`}
            onToggle={() => onChange(toggleWidget(enabled, w.id, !isOn))}
          />
        );
      })}
    </ul>
  );
}
