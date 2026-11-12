import { useId, useState, type ReactNode } from "react";
import type { WizardCopy } from "../../copy/wizard.js";
import ChoiceTiles from "./ChoiceTiles.js";
import { parseEuros } from "./parseEuros.js";
import {
  collectDetails,
  initialState,
  rowIssues,
  type DetailRowInit,
  type DetailsResult,
  type RowState,
} from "./cardDetails.js";

export type CardDetailsFormProps = {
  copy: WizardCopy;
  rows: readonly DetailRowInit[];
  busy: boolean;
  submitLabel: string;
  /** Wizard only: continue without changing anything. */
  onSkip?: () => void;
  onSubmit: (result: DetailsResult) => void;
  /** In a page, not in the wizard: the button is not pinned to the screen bottom. */
  inline?: boolean;
  /** Extra content under the rows (the plan's editor puts its error here). */
  footer?: ReactNode;
};

/** One compact block per credit card: balance, paid in full, rate and (where the
 *  card earns points) the points balance. An empty block skips the card. Shared
 *  by the intake wizard and the editor in the cards section of the plan. */
export default function CardDetailsForm(p: CardDetailsFormProps) {
  const id = useId();
  const t = p.copy.cardDetails;
  const [states, setStates] = useState<RowState[]>(() => p.rows.map(initialState));
  const [touched, setTouched] = useState(false);
  const patch = (k: number, change: Partial<RowState>) =>
    setStates((cur) => cur.map((s, i) => (i === k ? { ...s, ...change } : s)));
  const issues = p.rows.map((r, k) => rowIssues(states[k]!, r.programName !== null));
  const ok = issues.every((x) => x.length === 0);

  return (
    <form
      className="wz-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (ok && !p.busy) p.onSubmit(collectDetails(p.rows, states));
      }}
    >
      <div className="wz-cardrows">
        {p.rows.map((r, k) => {
          const s = states[k]!;
          const own = issues[k]!;
          const show = (i: (typeof own)[number]) => touched && own.includes(i);
          const at = `${id}-${k}`;
          const cents = s.balance.trim() === "" ? null : parseEuros(s.balance);
          const hasBalance = cents !== null && cents > 0;
          return (
            <fieldset key={r.cardId} className="wz-cardrow" data-testid="wz-cardrow">
              <legend>{r.name}</legend>
              <div className="wz-field">
                <label htmlFor={`${at}-balance`}>{t.balance}</label>
                <input
                  id={`${at}-balance`}
                  className="wz-text-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="€"
                  value={s.balance}
                  aria-invalid={show("balance")}
                  onChange={(e) => patch(k, { balance: e.target.value })}
                />
                {show("balance") ? (
                  <p role="alert" className="wz-error">
                    {t.errors.balance}
                  </p>
                ) : null}
              </div>
              {hasBalance ? (
                <div className="wz-field">
                  <p className="wz-field-label">{t.paysInFull}</p>
                  <ChoiceTiles
                    label={`${r.name}: ${t.paysInFull}`}
                    options={[
                      { value: "yes", label: t.payYes },
                      { value: "no", label: t.payNo },
                    ]}
                    selected={s.paysInFull === null ? null : s.paysInFull ? "yes" : "no"}
                    onPick={(v) => patch(k, { paysInFull: v === "yes" })}
                    disabled={p.busy}
                  />
                  {show("pays-in-full") ? (
                    <p role="alert" className="wz-error">
                      {t.errors.paysInFull}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {hasBalance && s.paysInFull === false ? (
                <div className="wz-field">
                  <label htmlFor={`${at}-rate`}>{t.rate}</label>
                  <input
                    id={`${at}-rate`}
                    className="wz-text-input"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="%"
                    value={s.rate}
                    aria-invalid={show("rate")}
                    onChange={(e) => patch(k, { rate: e.target.value })}
                  />
                  <p className="wz-hint">{t.rateHint}</p>
                  {show("rate") ? (
                    <p role="alert" className="wz-error">
                      {t.errors.rate}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {r.programName !== null ? (
                <div className="wz-field">
                  <label htmlFor={`${at}-points`}>{t.points(r.programName)}</label>
                  <input
                    id={`${at}-points`}
                    className="wz-text-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={s.points}
                    aria-invalid={show("points")}
                    onChange={(e) => patch(k, { points: e.target.value })}
                  />
                  <p className="wz-hint">{t.pointsHint}</p>
                  {show("points") ? (
                    <p role="alert" className="wz-error">
                      {t.errors.points}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <p className="wz-hint">{t.skipHint}</p>
      {p.footer}
      <div className={p.inline ? "wz-footer wz-footer--inline" : "wz-footer"}>
        <button type="submit" className="wz-next" disabled={p.busy}>
          {p.submitLabel}
        </button>
        {p.onSkip ? (
          <div>
            <button type="button" className="wz-link" disabled={p.busy} onClick={p.onSkip}>
              {t.skip}
            </button>
          </div>
        ) : null}
      </div>
    </form>
  );
}
