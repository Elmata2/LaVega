import { useRef, type KeyboardEvent } from "react";

export type ChoiceTilesProps<T extends string> = {
  label: string;
  options: { value: T; label: string }[];
  selected: T | null;
  onPick: (value: T) => void;
  disabled?: boolean;
};

export default function ChoiceTiles<T extends string>(p: ChoiceTilesProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = p.options.length;
  const selIdx = p.options.findIndex((o) => o.value === p.selected);
  const tabIdx = selIdx >= 0 ? selIdx : 0;

  const move = (from: number, delta: number) => {
    const to = (from + delta + n) % n;
    refs.current[to]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      move(i, 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      move(i, -1);
    }
  };

  return (
    <div className="wz-tiles" role="radiogroup" aria-label={p.label}>
      {p.options.map((o, i) => {
        const on = o.value === p.selected;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === tabIdx ? 0 : -1}
            disabled={p.disabled}
            className={`wz-tile${on ? " is-selected" : ""}`}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => p.onPick(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
