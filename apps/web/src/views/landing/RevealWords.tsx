import { Fragment, useEffect, useMemo, useRef, useState } from "react";

/** The sentence lights up word by word as it scrolls through the viewport.
 *  The scroll handler is rAF throttled and only sets state when the count
 *  changes. Under reduced motion CSS shows every word and nothing listens. */
export default function RevealWords({ text, reduce }: { text: string; reduce: boolean }) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const words = useMemo(() => text.split(" "), [text]);
  const [lit, setLit] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (reduce || !el) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const h = window.innerHeight;
      const progress = (h * 0.82 - box.top) / (box.height + h * 0.34);
      setLit(Math.round(Math.min(1, Math.max(0, progress)) * words.length));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    paint();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduce, words]);

  return (
    <p className="reveal" ref={ref}>
      {words.map((word, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className={i < lit ? "on" : undefined}>{word}</span>
        </Fragment>
      ))}
    </p>
  );
}
