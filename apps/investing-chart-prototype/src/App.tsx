import { useEffect, useState } from "react";
import { InteractionChart } from "./InteractionChart";

// Question: how does the portfolio chart behave under the pointer? (issue #77)
// Two variants of the one fork that genuinely needs a reaction — brush-to-zoom
// against the range switcher, and how you get back out of a zoom. Crosshair,
// tooltip, keyboard nav, and click-to-drill are shared and NOT variant-specific;
// react to those on either tab.
const VARIANTS = [
  { key: "combined", label: "A — Drag-to-zoom on chart" },
  { key: "separate", label: "B — Brush strip below chart" },
] as const;
type VariantKey = (typeof VARIANTS)[number]["key"];

function readVariant(): VariantKey {
  const value = new URLSearchParams(location.search).get("variant");
  return value === "separate" ? "separate" : "combined";
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
      if (target.closest(".chart")) return; // chart owns ←→ for crosshair nav while it has focus
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = VARIANTS.find((item) => item.key === variant)!;

  return <div className="page">
    <p className="eyebrow">PROTOTYPE — issue #77</p>
    <h1>Interaction model for the portfolio chart</h1>
    <p className="intro">
      Crosshair + tooltip across up to four series, keyboard and screen-reader support, and
      click-to-drill on a trade marker are the same on both tabs. What differs is whether
      brush-to-zoom is one control (drag the chart itself) or two (a separate brush strip,
      like the range switcher's sibling). Try dragging across the plot, then Escape or the
      zoom pill to get back out. Tab into the chart and use ← → Home End to drive it by
      keyboard; a trade marker (small circle near the line) is clickable.
    </p>

    <div className="frame-label">{current.label}</div>
    <div className="card">
      <InteractionChart zoomMode={variant} />
    </div>

    <div className="switcher">
      <button type="button" aria-label="Vorige variant" onClick={() => cycle(-1)}>←</button>
      <span>{current.label}</span>
      <button type="button" aria-label="Volgende variant" onClick={() => cycle(1)}>→</button>
    </div>
  </div>;
}
