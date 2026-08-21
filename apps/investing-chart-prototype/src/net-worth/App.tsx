import { useEffect, useMemo, useRef, useState } from "react";
import { generateNetWorthPoints } from "./data";
import { LayeredValues } from "./variants/LayeredValues";
import { CompositionBand } from "./variants/CompositionBand";
import { EditorialLedger } from "./variants/EditorialLedger";

const variants = [
  { name: "Waarde", render: (points: ReturnType<typeof generateNetWorthPoints>) => <LayeredValues points={points} /> },
  { name: "Samenstelling", render: (points: ReturnType<typeof generateNetWorthPoints>) => <CompositionBand points={points} /> },
  { name: "Kop", render: (points: ReturnType<typeof generateNetWorthPoints>) => <EditorialLedger points={points} /> },
];

function usePickerKeyboard(current: number, setActive: (i: number) => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= variants.length) setActive(num - 1);
      else if (e.key === "ArrowRight") setActive((current + 1) % variants.length);
      else if (e.key === "ArrowLeft") setActive((current - 1 + variants.length) % variants.length);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, setActive]);
}

export function App() {
  const points = useMemo(() => generateNetWorthPoints(), []);
  const [current, setCurrent] = useState(() => {
    const v = parseInt(new URLSearchParams(location.search).get("v") ?? "1", 10);
    return v >= 1 && v <= variants.length ? v - 1 : 0;
  });
  const [ready, setReady] = useState(false);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [highlight, setHighlight] = useState({ width: 0, left: 0 });

  function setActive(i: number) {
    setCurrent(i);
    const url = new URL(location.href);
    url.searchParams.set("v", String(i + 1));
    history.replaceState(null, "", url);
  }

  usePickerKeyboard(current, setActive);

  useEffect(() => {
    const el = itemRefs.current[current];
    if (el) setHighlight({ width: el.offsetWidth, left: el.offsetLeft });
  }, [current]);

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
  }, []);

  return (
    <div className="stage">
      <div className="chart-card">
        <div className="chart-card-header">
          <div>
            <p className="chart-card-eyebrow">Nettovermogen</p>
            <h2 className="chart-card-title">Beleggingen &amp; cash</h2>
          </div>
          <span className="chart-card-hint">Hover of raak de grafiek aan</span>
        </div>
        <div key={current}>{variants[current]!.render(points)}</div>
      </div>

      <nav className="proto-picker" aria-label="Prototype variants" data-ready={ready || undefined}>
        <span className="proto-picker-highlight" aria-hidden="true" style={{ width: highlight.width, transform: `translateX(${highlight.left}px)` }} />
        {variants.map((variant, i) => (
          <button
            key={variant.name}
            ref={(el) => { itemRefs.current[i] = el; }}
            className="proto-picker-item"
            data-active={i === current || undefined}
            aria-current={i === current ? "true" : undefined}
            onClick={() => setActive(i)}
          >
            {variant.name}
          </button>
        ))}
      </nav>
    </div>
  );
}
