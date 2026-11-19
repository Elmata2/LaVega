import { useCallback, useEffect, useRef, useState } from "react";

export type ScrollFade = "none" | "start" | "end" | "both";

/** Measures a sideways-scrolling row so the `scroll-fade-x` mask can show
 *  which edge has more content. `key` re-measures (and re-centres the
 *  `[aria-current="page"]` or `[data-checked]` child) when the selection moves. */
export function useScrollFade<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  const [fade, setFade] = useState<ScrollFade>("none");
  const measure = useCallback(() => {
    const row = ref.current;
    if (!row) return;
    const start = row.scrollLeft > 1;
    const end = row.scrollWidth - row.clientWidth - row.scrollLeft > 1;
    setFade(start && end ? "both" : start ? "start" : end ? "end" : "none");
  }, []);
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const active = row.querySelector<HTMLElement>('[aria-current="page"], [data-checked]');
    // jsdom has no scrollIntoView.
    if (row.scrollWidth > row.clientWidth && typeof active?.scrollIntoView === "function")
      active.scrollIntoView({ inline: "center", block: "nearest" });
    measure();
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [key, measure]);
  return { ref, fade, measure };
}
