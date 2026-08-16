import { HOME_MODULE, MODULES, toggleModule, type ModuleId } from "./moduleRegistry";

/* The module picker: every module in the registry, with its preview, one line
 * of what it does, and a switch. On = it appears in the top nav; off = it
 * disappears. That is the whole point of the modular grid — the nav becomes the
 * owner's own selection instead of the full catalogue.
 *
 * The picker owns no state: it hands the caller the NEXT list (computed by the
 * registry, which is what keeps Overzicht unremovable) and the caller persists
 * it. Reached from the profile, and from "Widget toevoegen" in the header —
 * the same idea from the other end. */

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
          <li key={m.id} className="mp-item">
            <div className="mp-preview">{m.preview}</div>

            <div className="mp-text">
              <span className="mp-label">{m.label}</span>
              <span className="mp-what">{m.what}</span>
              {locked && <span className="mp-note">Je startpagina — staat altijd in de navigatie.</span>}
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={isOn}
              aria-label={`${m.label} in de navigatie`}
              disabled={locked}
              className={`mp-toggle${isOn ? " on" : ""}`}
              onClick={() => onChange(toggleModule(enabled, m.id, !isOn))}
            >
              <span className="mp-knob" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
