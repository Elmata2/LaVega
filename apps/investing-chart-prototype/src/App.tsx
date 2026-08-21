import { useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "./Chart";
import { generatePoints } from "./data";
import { money, percent } from "./format";
import { BySeriesTooltip } from "./variants/BySeriesTooltip";
import { ByMetricTooltip } from "./variants/ByMetricTooltip";
import { OutperformanceTooltip } from "./variants/OutperformanceTooltip";

const variants = [
  { name: "Per reeks", render: (points: ReturnType<typeof generatePoints>) => (
    <Chart points={points} renderTooltip={(p) => <BySeriesTooltip point={p} />} />
  ) },
  { name: "Per metric", render: (points: ReturnType<typeof generatePoints>) => (
    <Chart points={points} renderTooltip={(p) => <ByMetricTooltip point={p} />} />
  ) },
  { name: "Outperformance", render: (points: ReturnType<typeof generatePoints>) => (
    <Chart
      points={points}
      renderTooltip={(p) => <OutperformanceTooltip point={p} />}
      renderHeader={(p) => (
        <div style={{ display: "flex", gap: 20, marginBottom: 14, fontSize: 13 }}>
          <span><span className="muted">Portefeuille</span> <strong className="tt-num">{money(p.portfolioValue)}</strong> <span className={p.portfolioTwr >= 0 ? "pos" : "neg"}>{percent(p.portfolioTwr)}</span></span>
          <span><span className="muted">S&amp;P 500</span> <strong className="tt-num">{money(p.benchmarkValue)}</strong> <span className={p.benchmarkTwr >= 0 ? "pos" : "neg"}>{percent(p.benchmarkTwr)}</span></span>
        </div>
      )}
    />
  ) },
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
  const points = useMemo(() => generatePoints(), []);
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
            <p className="chart-card-eyebrow">Portefeuillewaarde</p>
            <h2 className="chart-card-title">Versus S&amp;P 500</h2>
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
