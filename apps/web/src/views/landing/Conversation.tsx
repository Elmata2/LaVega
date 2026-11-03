import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { LandingCopy } from "../../landingCopy.js";

type Acts = LandingCopy["acts"];

type Frame = {
  talk: number;
  ask: string;
  ans: string;
  typing: "ask" | "ans" | null;
  think: boolean;
  /** One flag per row: still a skeleton. */
  pending: [boolean, boolean, boolean];
};

const SKELETON: Frame["pending"] = [true, true, true];

/** How long a finished exchange stays before the next one starts: long enough
 *  to read the answer, so it scales with its length. */
export const holdMs = (answer: string): number =>
  Math.min(9000, Math.max(5000, answer.trim().split(/\s+/).length * 300));

const idle = (talk: number): Frame => ({
  talk,
  ask: "",
  ans: "",
  typing: null,
  think: true,
  pending: SKELETON,
});

/** The adviser conversation. Static (the first exchange, complete) unless
 *  `animated`; then it loops through every exchange, typing each one when the
 *  block is on screen and parking while it is off screen. Hidden ghost copies
 *  of every exchange size the layout, so nothing jumps while text is typed. */
export default function Conversation({ copy, animated }: { copy: Acts; animated: boolean }) {
  const { talks } = copy;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<Frame>(() =>
    animated
      ? idle(0)
      : {
          talk: 0,
          ask: talks[0].q,
          ans: talks[0].a,
          typing: null,
          think: false,
          pending: [false, false, false],
        },
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!animated || !root) return;
    let dead = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          timers.delete(t);
          resolve();
        }, ms);
        timers.add(t);
      });
    let onScreen = false;
    let resume = () => {};
    const visible = () =>
      onScreen
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            resume = resolve;
          });
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries[entries.length - 1]?.isIntersecting ?? false;
        if (onScreen) resume();
      },
      { threshold: 0.35 },
    );
    io.observe(root);

    const type = async (field: "ask" | "ans", text: string, ms: number) => {
      for (let i = 1; i <= text.length && !dead; i++) {
        setFrame((f) => ({ ...f, [field]: text.slice(0, i), typing: field }));
        await wait(ms);
      }
      if (!dead) setFrame((f) => ({ ...f, typing: null }));
    };

    void (async () => {
      for (let i = 0; !dead; i = (i + 1) % talks.length) {
        const t = talks[i]!;
        await visible();
        if (dead) return;
        setFrame(idle(i));
        await type("ask", t.q, 32);
        await wait(500);
        setFrame((f) => ({ ...f, think: false }));
        await type("ans", t.a, 20);
        await wait(200);
        for (let r = 0; r < 3 && !dead; r++) {
          setFrame((f) => ({
            ...f,
            pending: f.pending.map((p, j) => (j === r ? false : p)) as Frame["pending"],
          }));
          await wait(160);
        }
        await wait(holdMs(t.a));
      }
    })();

    return () => {
      dead = true;
      io.disconnect();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [animated, talks]);

  const current = talks[frame.talk]!;
  return (
    <div className="split acts" id="acts" ref={rootRef}>
      <div>
        <h2 className="r">{copy.title}</h2>
        <p className="ask r" style={{ "--d": 1 } as CSSProperties}>
          {animated &&
            talks.map((t) => (
              <span className="ghost" aria-hidden="true" key={t.q}>
                {copy.hey} {t.q}
              </span>
            ))}
          <span className="sr">
            {copy.hey} {current.q} {current.a}
          </span>
          <span aria-hidden="true">
            <span className="hey">{copy.hey}</span>{" "}
            <span className={frame.typing === "ask" ? "typing" : undefined}>{frame.ask}</span>
          </span>
        </p>
      </div>
      <div>
        <p className="who r" style={{ "--d": 2 } as CSSProperties}>
          {copy.who}
        </p>
        <p
          className={`bubble r${frame.think ? " think" : ""}`}
          style={{ "--d": 3 } as CSSProperties}
        >
          {animated &&
            talks.map((t) => (
              <span className="ghost" aria-hidden="true" key={t.a}>
                {t.a}
              </span>
            ))}
          <span className="dots" aria-hidden="true">
            {[0, 1, 2].map((n) => (
              <i key={n} style={{ "--n": n } as CSSProperties} />
            ))}
          </span>
          <span aria-hidden="true" className={frame.typing === "ans" ? "typing" : undefined}>
            {frame.ans}
          </span>
        </p>
        <p className="label r" style={{ "--d": 4 } as CSSProperties}>
          {current.label}
        </p>
        {current.rows.map((row, i) => (
          <div
            className={`row r${frame.pending[i] ? " sk" : ""}`}
            style={{ "--d": 5 + i } as CSSProperties}
            key={i}
          >
            <em>{row[0]}</em>
            <span>{row[1]}</span>
            <b>{row[2]}</b>
          </div>
        ))}
        <p className="soon r" style={{ "--d": 8 } as CSSProperties}>
          {copy.soon}
        </p>
      </div>
    </div>
  );
}
