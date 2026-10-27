import { useId, useState } from "react";
import type { WizardCopy } from "../../copy/wizard.js";
import MultiTiles from "./MultiTiles.js";
import { OTHER_CARD, cardGroups, cardLabel, matchCards, type CardBrand } from "./cardOptions.js";

export type CardPickerProps = {
  copy: Pick<
    WizardCopy,
    "cardSearch" | "cardNotFound" | "otherCard" | "otherBrand" | "cardsPicked"
  >;
  label: string;
  picked: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

/** Brands first; a search swaps them for a flat list. Picks live in `picked`, so
 *  they survive opening and closing a brand and typing in the search. */
export default function CardPicker(p: CardPickerProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<CardBrand>>(new Set());
  const searching = query.trim() !== "";
  const found = matchCards(query);
  const toggle = (c: string) =>
    p.onChange(p.picked.includes(c) ? p.picked.filter((x) => x !== c) : [...p.picked, c]);
  const other = { value: OTHER_CARD, label: p.copy.otherCard };
  const toOptions = (cards: readonly { id: string; label: string }[]) =>
    cards.map((o) => ({ value: o.id, label: o.label }));
  const stray = p.picked
    .filter((x) => x !== OTHER_CARD && !matchCards("").some((f) => f.id === x))
    .map((x) => ({ id: x, label: cardLabel(x, p.copy.otherCard) }));
  const flat = [...found, ...stray.filter((s) => !found.some((f) => f.id === s.id))];
  const flip = (b: CardBrand) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(b)) next.add(b);
      return next;
    });
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
      {searching ? (
        <MultiTiles<string>
          label={p.label}
          disabled={p.disabled}
          selected={p.picked}
          onToggle={toggle}
          options={[...toOptions(flat), other]}
        />
      ) : (
        <div className="wz-brands">
          {cardGroups(p.copy.otherBrand, stray).map((g) => {
            const isOpen = open.has(g.brand);
            const n = g.cards.filter((c) => p.picked.includes(c.id)).length;
            const panel = `${id}-${g.brand}`;
            return (
              <div key={g.brand} className="wz-brand">
                <button
                  type="button"
                  className={`wz-tile wz-brand-tile${n > 0 ? " is-selected" : ""}`}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? panel : undefined}
                  disabled={p.disabled}
                  onClick={() => flip(g.brand)}
                >
                  <span>{g.label}</span>
                  <span className="wz-brand-end">
                    {n > 0 && <span className="wz-brand-count">{p.copy.cardsPicked(n)}</span>}
                    <svg
                      className="wz-chevron"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      aria-hidden="true"
                    >
                      <path
                        d="M6 9l6 6 6-6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
                {isOpen && (
                  <div id={panel} className="wz-brand-cards">
                    <MultiTiles<string>
                      label={g.label}
                      disabled={p.disabled}
                      selected={p.picked}
                      onToggle={toggle}
                      options={toOptions(g.cards)}
                    />
                  </div>
                )}
              </div>
            );
          })}
          <MultiTiles<string>
            label={p.label}
            disabled={p.disabled}
            selected={p.picked}
            onToggle={toggle}
            options={[other]}
          />
        </div>
      )}
      {found.length === 0 && searching && (
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
  return [...known.filter((x) => picked.includes(x)), ...picked.filter((x) => !known.includes(x))];
};
