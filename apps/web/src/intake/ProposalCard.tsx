import { useId, useState } from "react";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import Field from "../components/ui/Field.js";
import type { IntakeCopy } from "../copy/intake.js";
import { centsToInput, toCents } from "./money.js";
import type { AnswerStatus, ProposalAnswer } from "./state.js";

type Props = {
  copy: IntakeCopy;
  /** The "We think ..." sentence, already built from copy and the proposal. */
  sentence: string;
  /** Pre-formatted evidence lines (a transaction, or an account balance). */
  evidenceLines: string[];
  evidenceTotal: number;
  /** "Based on N ...", worded for transactions or for account balances. */
  evidenceSummary: string;
  status: AnswerStatus;
  /** The figure the Correct field starts from, in cents. */
  figureCents: number;
  disabled?: boolean;
  onAnswer: (answer: ProposalAnswer) => void;
};

/** One "We think ..." card: the sentence, the evidence behind it (expandable),
 *  and Confirm / Correct / Not mine. */
export default function ProposalCard({
  copy: c,
  sentence,
  evidenceLines,
  evidenceTotal,
  evidenceSummary,
  status,
  figureCents,
  disabled,
  onAnswer,
}: Props) {
  const amountId = useId();
  const [editing, setEditing] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [text, setText] = useState(centsToInput(figureCents));
  const cents = toCents(text);
  const answered = status !== "open" && !reopened;
  const more = evidenceTotal - evidenceLines.length;

  function answer(a: ProposalAnswer) {
    setEditing(false);
    setReopened(false);
    onAnswer(a);
  }

  return (
    <Card
      as="article"
      data-testid="proposal-card"
      data-status={status}
      className="mb-[var(--sp-3)]"
    >
      <p className="text-muted m-0">{c.block1.weThink}</p>
      <p className="m-0 mt-1 text-[1.05rem]">{sentence}</p>
      {evidenceTotal > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted">{evidenceSummary}</summary>
          <ul className="mt-2 list-none p-0">
            {evidenceLines.map((l, i) => (
              <li key={i} className="text-muted text-[0.85rem]">
                {l}
              </li>
            ))}
            {more > 0 && (
              <li className="text-muted text-[0.85rem]">{c.block1.evidenceMore(more)}</li>
            )}
          </ul>
        </details>
      )}

      {editing ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (cents !== null) answer({ kind: "correct", value: { cents } });
          }}
        >
          <Field className="mb-0">
            <label htmlFor={amountId}>{c.block1.amountLabel}</label>
            <input
              id={amountId}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={cents === null || disabled}>
            {c.common.save}
          </Button>
          <Button onClick={() => setEditing(false)}>{c.common.cancel}</Button>
        </form>
      ) : answered ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-muted" data-testid="proposal-status">
            {c.block1.status[status as Exclude<AnswerStatus, "open">]}
          </span>
          <Button disabled={disabled} onClick={() => setReopened(true)}>
            {c.common.change}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={disabled} onClick={() => answer({ kind: "confirm" })}>
            {c.common.confirm}
          </Button>
          <Button disabled={disabled} onClick={() => setEditing(true)}>
            {c.common.correct}
          </Button>
          <Button disabled={disabled} onClick={() => answer({ kind: "notMine" })}>
            {c.common.notMine}
          </Button>
        </div>
      )}
    </Card>
  );
}
