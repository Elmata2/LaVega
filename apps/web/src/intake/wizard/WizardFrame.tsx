import { useEffect, useRef, type ReactNode } from "react";

export type WizardFrameProps = {
  step: number;
  total: number;
  section: string;
  question: string;
  onBack: (() => void) | null;
  backLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Top-row extras (the view's close control), right of the counter. */
  topRight?: ReactNode;
  counter?: string;
};

export default function WizardFrame(p: WizardFrameProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    h1.current?.focus();
  }, [p.step]);
  return (
    <div className="wz-root">
      <div className="wz-col">
        <div
          className="wz-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuenow={p.step}
          aria-valuemax={p.total}
        >
          {Array.from({ length: p.total }, (_, i) => (
            <i
              key={i}
              className={i < p.step ? "wz-seg is-on" : "wz-seg"}
              style={
                i < p.step
                  ? {
                      backgroundSize: `${p.total * 100}% 100%`,
                      backgroundPosition: `${p.total > 1 ? (i / (p.total - 1)) * 100 : 0}% 0`,
                    }
                  : undefined
              }
            />
          ))}
        </div>
        <div className="wz-top">
          {p.onBack ? (
            <button type="button" className="wz-back" aria-label={p.backLabel} onClick={p.onBack}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M15 5l-7 7 7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : (
            <span className="wz-back-spacer" />
          )}
          <span className="wz-counter">{p.counter ?? `${p.step} / ${p.total}`}</span>
          <span className="wz-top-right">{p.topRight}</span>
        </div>
        <div className="wz-screen" key={p.step}>
          <p className="wz-section">{p.section}</p>
          <h1 className="wz-question" ref={h1} tabIndex={-1}>
            {p.question}
          </h1>
          <div className="wz-body">{p.children}</div>
          {p.footer ? <div className="wz-footer">{p.footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
