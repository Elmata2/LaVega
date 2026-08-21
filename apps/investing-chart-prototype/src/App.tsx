import { useEffect, useState } from "react";
import { VariantHero } from "./VariantHero";
import { VariantRail } from "./VariantRail";
import { VariantMerged } from "./VariantMerged";

// Question: how is the investing dashboard laid out? (issue #78)
// Three variants of the Overview page, switchable via ?variant=. All three
// share the same content widgets (chart, donut, positions list, KPIs, sync/
// vault/cache chips) from pieces.tsx — what differs is arrangement: whether
// the chart stands alone or keeps a rail beside it, where the three headline
// numbers sit, where sync/vault/cache go, and whether the donut and positions
// list are separate cards or one tabbed module.
const VARIANTS = [
  { key: "hero", label: "A — Full-bleed hero", Component: VariantHero },
  { key: "rail", label: "B — Chart + right rail", Component: VariantRail },
  { key: "merged", label: "C — Merged “what I own”", Component: VariantMerged },
] as const;
type VariantKey = (typeof VARIANTS)[number]["key"];

function readVariant(): VariantKey {
  const value = new URLSearchParams(location.search).get("variant");
  return VARIANTS.some((item) => item.key === value) ? (value as VariantKey) : "hero";
}

export default function App() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("variant", variant);
    history.replaceState(null, "", url);
  }, [variant]);

  const cycle = (delta: number) => {
    const index = VARIANTS.findIndex((item) => item.key === variant);
    setVariant(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = VARIANTS.find((item) => item.key === variant)!;

  return <div className="frame">
    <p className="eyebrow">PROTOTYPE — issue #78</p>
    <h1>Dashboard layout</h1>
    <p className="intro">
      Today the chart and the allocation donut sit side by side in a fixed 1.35/0.65 grid,
      with the positions list below and sync banners stacked on top. The chart is meant to
      become the centrepiece. These three lay out portfolio value / day change / total
      return (currently absent), sync + vault + price-cache controls, the chart, and the
      relationship between the allocation donut and the positions list differently.
    </p>

    <div className="frame-label">{current.label}</div>
    <current.Component />

    <div className="switcher">
      <button type="button" aria-label="Vorige variant" onClick={() => cycle(-1)}>←</button>
      <span>{current.label}</span>
      <button type="button" aria-label="Volgende variant" onClick={() => cycle(1)}>→</button>
    </div>
  </div>;
}
