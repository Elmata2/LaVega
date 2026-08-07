import { useEffect, useRef } from "react";

const N = 14;
const KINDS = ["a", "b", "c"] as const; // espresso / tan / cream

/** The signature scroll section: a giant serif wordmark + a deck of bank cards
 *  that curls from a fan into a 3D arc as you scroll (GSAP ScrollTrigger, pinned
 *  + scrubbed). GSAP is dynamically imported so the app bundle never pays for
 *  it. Falls back to a static CSS fan on reduced-motion or if GSAP fails. */
export default function CardSpiral() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // CSS shows a resting fan
    let killed = false;
    let ctx: { revert: () => void } | null = null;

    (async () => {
      try {
        const gsapMod = await import("gsap");
        const stMod = await import("gsap/ScrollTrigger");
        if (killed || !stageRef.current || !sectionRef.current) return;
        const gsap = (gsapMod as { gsap?: typeof import("gsap").gsap; default?: unknown }).gsap ?? (gsapMod.default as typeof import("gsap").gsap);
        const ScrollTrigger = (stMod as { ScrollTrigger?: unknown; default?: unknown }).ScrollTrigger ?? stMod.default;
        gsap.registerPlugin(ScrollTrigger as Parameters<typeof gsap.registerPlugin>[0]);
        const cards = Array.from(stageRef.current.querySelectorAll<HTMLElement>(".lp-card3d"));
        stageRef.current.classList.add("lp-anim"); // hand control to GSAP (drop the CSS fan)

        ctx = gsap.context(() => {
          const apply = (p: number) => {
            cards.forEach((card, i) => {
              const t = i / (N - 1); // 0..1 (N is fixed > 1)
              const c = t - 0.5; // -0.5..0.5
              const spread = 70 + p * 220;
              const curl = 0.18 + p * 1.5; // total arc (radians) grows on scroll
              const ang = c * Math.PI * curl;
              const R = spread * (N - 1) * 0.5;
              const x = Math.sin(ang) * R;
              const y = (1 - Math.cos(ang)) * R - 30;
              gsap.set(card, {
                xPercent: -50,
                yPercent: -50,
                x,
                y,
                rotationZ: (ang * 180) / Math.PI,
                rotationY: c * 55 * p,
                z: i * 8 * p,
                transformPerspective: 1100,
                transformOrigin: "50% 50%",
              });
            });
          };
          apply(0);
          (ScrollTrigger as typeof import("gsap/ScrollTrigger").ScrollTrigger).create({
            trigger: sectionRef.current!,
            start: "top top",
            end: "+=170%",
            pin: stageRef.current!,
            scrub: 0.6,
            onUpdate: (self: { progress: number }) => apply(self.progress),
          });
        }, sectionRef);
      } catch {
        /* GSAP failed to load — the CSS fan stays as a graceful fallback */
      }
    })();

    return () => {
      killed = true;
      ctx?.revert();
    };
  }, []);

  return (
    <section className="lp-spiral" ref={sectionRef} aria-label="Slimmer met je geld">
      <div className="lp-spiral-stage" ref={stageRef}>
        <div className="lp-spiral-word" aria-hidden="true">LaVega</div>
        <p className="lp-spiral-tag">Niet méér uitgeven — slimmer met je geld.</p>
        <div className="lp-spiral-cards" aria-hidden="true">
          {Array.from({ length: N }).map((_, i) => (
            <div
              className={`lp-card3d lp-card3d-${KINDS[i % 3]}`}
              key={i}
              style={{ ["--i" as string]: String(i) } as React.CSSProperties}
            >
              <span className="lp-card3d-chip" />
              <span className="lp-card3d-num">•••• 4577</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
