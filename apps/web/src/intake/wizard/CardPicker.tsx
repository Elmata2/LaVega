import { useId, useState } from "react";
import type { WizardCopy } from "../../copy/wizard.js";
import MultiTiles from "./MultiTiles.js";
import { OTHER_CARD, cardLabel, matchCards } from "./cardOptions.js";

export type CardPickerProps = {
  copy: Pick<WizardCopy, "cardSearch" | "cardNotFound" | "otherCard">;
  label: string;
  picked: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

/** Search plus multi-select over the card catalogue. A picked card stays listed
 *  while a search hides the rest, and "another card" is always offered. */
export default function CardPicker(p: CardPickerProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const found = matchCards(query);
  const shown = [
    ...found,
    ...p.picked
      .filter((x) => x !== OTHER_CARD && !found.some((f) => f.id === x))
      .map((x) => ({ id: x, label: cardLabel(x, p.copy.otherCard) })),
    { id: OTHER_CARD, label: p.copy.otherCard },
  ];
  return (
    <>
      <div className="wz-field">
        <label className="wz-sr" htmlFor={`${id}-search`}>
          {p.copy.cardSearch}
        </label>
        <input
          id={`${id}-search`}
          className="wz-text-input"
          type="search"
          autoComplete="off"
          placeholder={p.copy.cardSearch}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <MultiTiles<string>
        label={p.label}
        disabled={p.disabled}
        selected={p.picked}
        onToggle={(c) =>
          p.onChange(p.picked.includes(c) ? p.picked.filter((x) => x !== c) : [...p.picked, c])
        }
        options={shown.map((o) => ({ value: o.id, label: o.label }))}
      />
      {found.length === 0 && (
        <p role="status" className="wz-hint">
          {p.copy.cardNotFound}
        </p>
      )}
    </>
  );
}

/** Picked ids in a stable order: catalogue cards as listed, then the rest as picked. */
export const orderedCardIds = (picked: readonly string[]): string[] => {
  const known = matchCards("").map((c) => c.id);
  return [
    ...known.filter((x) => picked.includes(x)),
    ...picked.filter((x) => !known.includes(x)),
  ];
};
