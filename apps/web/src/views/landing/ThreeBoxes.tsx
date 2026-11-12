import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { LandingCopy } from "../../landingCopy.js";
import { slot } from "./motion.js";

/** Hover pauses a loop only where a pointer can really leave again. On touch
 *  `:hover` sticks after a tap and would freeze the box for good. */
const canHover = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Runs `step` every `ms` while the box is at least 40% on screen, not hovered.
 *  Leaving the screen clears the interval; so does unmount. */
function useVisibleLoop(
  ref: RefObject<HTMLElement | null>,
  step: () => void,
  ms: number,
  enabled: boolean,
) {
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    const box = ref.current;
    if (!enabled || !box) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        clearInterval(timer);
        timer = undefined;
        if (entries[entries.length - 1]?.isIntersecting) {
          timer = setInterval(() => {
            if (!(canHover() && box.matches(":hover"))) stepRef.current();
          }, ms);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(box);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, [ref, ms, enabled]);
}

function StandBox({ copy, animated }: { copy: LandingCopy["does"]["stand"]; animated: boolean }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [k, setK] = useState(0);
  const n = copy.accounts.length;
  useVisibleLoop(boxRef, () => setK((v) => v + 1), 3000, animated);
  return (
    <div className="tile r">
      <div className="box" ref={boxRef}>
        <button
          type="button"
          className="stack"
          aria-label={copy.label}
          onClick={() => setK((v) => v + 1)}
        >
          <span className="total">
            {copy.totalLabel}
            <b>{copy.total}</b>
          </span>
          {copy.accounts.map((a, i) => (
            <span className="acct" key={a.name} data-p={slot(i, k, n, 1)}>
              <em>{a.name}</em>
              <strong>{a.amount}</strong>
            </span>
          ))}
        </button>
      </div>
      <h3>{copy.title}</h3>
      <p>{copy.text}</p>
    </div>
  );
}

function MoveBox({
  copy,
  animated,
  reduce,
}: {
  copy: LandingCopy["does"]["move"];
  animated: boolean;
  reduce: boolean;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [ticked, setTicked] = useState<boolean[]>(() => copy.moves.map(() => reduce || !animated));
  const [manual, setManual] = useState(false);
  const gain = copy.moves.reduce((sum, m, i) => sum + (ticked[i] ? m.gain : 0), 0);
  const advance = () =>
    setTicked((t) => {
      const next = t.indexOf(false);
      return next < 0 ? t.map(() => false) : t.map((on, i) => on || i === next);
    });
  useVisibleLoop(boxRef, advance, 1600, animated && !manual);
  return (
    <div className="tile r" style={{ "--d": 1 } as CSSProperties}>
      <div className="box" ref={boxRef}>
        <div className="plan">
          <span className="total">
            {copy.gainLabel}
            <b>
              €{gain} {copy.unit}
            </b>
          </span>
          <ul>
            {copy.moves.map((m, i) => (
              <li key={m.label}>
                <button
                  type="button"
                  className="move"
                  aria-pressed={ticked[i]}
                  onClick={() => {
                    setManual(true);
                    setTicked((t) => t.map((on, j) => (j === i ? !on : on)));
                  }}
                >
                  <i className="mv-l">{m.label}</i>
                  <span>€{m.gain}</span>
                  <i className="tick" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <h3>{copy.title}</h3>
      <p>{copy.text}</p>
    </div>
  );
}

function WatchBox({ copy, animated }: { copy: LandingCopy["does"]["watch"]; animated: boolean }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [k, setK] = useState(0);
  const n = copy.notes.length;
  useVisibleLoop(boxRef, () => setK((v) => v + 1), 2600, animated);
  return (
    <div className="tile r" style={{ "--d": 2 } as CSSProperties}>
      <div className="box" ref={boxRef}>
        <div className="feed" aria-hidden="true">
          {copy.notes.map((note, i) => (
            <div className="note" key={note.title} data-p={slot(i, k, n, -1)}>
              <b>{note.title}</b>
              <span>{note.text}</span>
            </div>
          ))}
        </div>
      </div>
      <h3>{copy.title}</h3>
      <p>
        {copy.text} <span className="next">{copy.next}</span>
      </p>
    </div>
  );
}

export default function ThreeBoxes({
  copy,
  animated,
  reduce,
}: {
  copy: LandingCopy["does"];
  animated: boolean;
  reduce: boolean;
}) {
  return (
    <div className="three">
      <StandBox copy={copy.stand} animated={animated} />
      <MoveBox copy={copy.move} animated={animated} reduce={reduce} />
      <WatchBox copy={copy.watch} animated={animated} />
    </div>
  );
}
