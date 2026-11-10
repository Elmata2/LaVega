import { useId, useState } from "react";
import { parseEuros } from "./parseEuros.js";

export type AmountFieldProps = {
  label: string;
  valueCents: number | null;
  onChange: (cents: number | null) => void;
  hint?: string;
};

const show = (cents: number | null) => (cents === null ? "" : String(Math.round(cents / 100)));

export default function AmountField(p: AmountFieldProps) {
  const id = useId();
  const [text, setText] = useState(show(p.valueCents));
  // Follow the stored value when the screen changes it, but keep what the user
  // typed while it still parses to the same amount. Adjusted during render.
  const [seen, setSeen] = useState(p.valueCents);
  if (seen !== p.valueCents) {
    setSeen(p.valueCents);
    if (parseEuros(text) !== p.valueCents) setText(show(p.valueCents));
  }

  return (
    <div className="wz-amount">
      <label className="wz-sr" htmlFor={id}>
        {p.label}
      </label>
      <div className="wz-amount-row">
        <span className="wz-euro" aria-hidden="true">
          €
        </span>
        <input
          id={id}
          className="wz-amount-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            p.onChange(parseEuros(e.target.value));
          }}
        />
      </div>
      {p.hint ? <p className="wz-hint">{p.hint}</p> : null}
    </div>
  );
}
