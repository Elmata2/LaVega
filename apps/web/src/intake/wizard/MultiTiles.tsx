import { useRef, type KeyboardEvent } from "react";

export type MultiTilesProps<T extends string> = {
  label: string;
  options: { value: T; label: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  disabled?: boolean;
};

export default function MultiTiles<T extends string>(p: MultiTilesProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = p.options.length;
  const firstOn = p.options.findIndex((o) => p.selected.includes(o.value));
  const tabIdx = firstOn >= 0 ? firstOn : 0;

  const move = (from: number, delta: number) => {
    refs.current[(from + delta + n) % n]?.focus();
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
    <div className="wz-tiles" role="group" aria-label={p.label}>
      {p.options.map((o, i) => {
        const on = p.selected.includes(o.value);
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="checkbox"
            aria-checked={on}
            tabIndex={i === tabIdx ? 0 : -1}
            disabled={p.disabled}
            className={`wz-tile${on ? " is-selected" : ""}`}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => p.onToggle(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
