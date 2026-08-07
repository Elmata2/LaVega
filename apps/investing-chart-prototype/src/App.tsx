import { lazy, Suspense, useCallback, useEffect } from "react";
import { eur, pctGain, points } from "./data";

const RechartsChart = lazy(() => import("./RechartsChart").then((module) => ({ default: module.RechartsChart })));
const ShadcnChart = lazy(() => import("./ShadcnChart").then((module) => ({ default: module.ShadcnChart })));
const VisxChart = lazy(() => import("./VisxChart").then((module) => ({ default: module.VisxChart })));

type Library = "recharts" | "shadcn" | "visx";
type Variant = "compare" | Library;
const variants: Variant[] = ["compare", "recharts", "shadcn", "visx"];
const labels: Record<Variant, string> = { compare: "Compare all", recharts: "Raw Recharts", shadcn: "shadcn/ui Charts", visx: "visx primitives" };

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card"><div className="card-head"><div><h3>Portfolio value</h3><p className="value">{eur.format(points.at(-1)!.portfolio)}</p><span className="change">+{pctGain}% all time</span></div><span className="range">5Y</span></div><div className="chart"><Suspense fallback={<span>Loading chart…</span>}>{children}</Suspense></div><div className="legend"><span><i style={{ background: "var(--prototype-portfolio)" }} />Portfolio</span><span><i style={{ background: "var(--prototype-benchmark)" }} />MSCI World</span></div></div>;
}

function Column({ library }: { library: Library }) {
  const Chart = library === "recharts" ? RechartsChart : library === "shadcn" ? ShadcnChart : VisxChart;
  const name = library === "recharts" ? "Raw Recharts" : library === "shadcn" ? "shadcn/ui Charts" : "visx";
  return <section className="column"><div className="column-head"><h2>{name}</h2><span>{library === "shadcn" ? "Recharts engine" : "same 1,827 points"}</span></div><p className="frame-label">Desktop width</p><div className="viewport"><Card><Chart /></Card></div><p className="frame-label">Narrow width · 390 px</p><div className="viewport narrow"><Card><Chart /></Card></div></section>;
}

export default function App() {
  const params = new URLSearchParams(location.search);
  const raw = params.get("variant") as Variant | null;
  const current = variants.includes(raw as Variant) ? raw! : "compare";
  const setVariant = useCallback((next: Variant) => {
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState({}, "", url);
    location.reload();
  }, []);
  const cycle = useCallback((step: number) => {
    setVariant(variants[(variants.indexOf(current) + step + variants.length) % variants.length]);
  }, [current, setVariant]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    addEventListener("keydown", handler);
    return () => removeEventListener("keydown", handler);
  }, [cycle]);
  const shown: readonly Library[] = current === "compare" ? ["recharts", "shadcn", "visx"] : [current];
  return <main className="page"><p className="eyebrow">Prototype · chart library decision</p><h1>Same data. Same palette. Different machinery.</h1><p className="intro">Five years of daily portfolio and benchmark values. Hover each chart and resize the browser. shadcn/ui Charts is shown separately, but it uses Recharts as its engine.</p><div className="comparison">{shown.map((library) => <Column key={library} library={library} />)}</div><div className="metrics"><div className="metric"><strong>Raw Recharts · 95 kB gzip · 19 LOC</strong><span>Fastest implementation. The library supplied responsive layout, axes, grid, lines, and tooltip state.</span></div><div className="metric"><strong>shadcn/ui · 95 kB gzip · 37 LOC</strong><span>The same Recharts engine. The extra layer centralizes series labels and CSS-variable colors. It adds almost no bundle cost.</span></div><div className="metric"><strong>visx · 35 kB gzip · 67 LOC</strong><span>Smaller and more controllable. Resize measurement, scales, axes, point lookup, portal tooltip, and hover state needed manual wiring.</span></div></div>{import.meta.env.DEV && <nav className="switcher" aria-label="Prototype variant"><button onClick={() => cycle(-1)} aria-label="Previous variant">←</button><span>{current} — {labels[current]}</span><button onClick={() => cycle(1)} aria-label="Next variant">→</button></nav>}</main>;
}
