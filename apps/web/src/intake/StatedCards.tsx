import { useId, useState } from "react";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import Field from "../components/ui/Field.js";
import type { IntakeCopy } from "../copy/intake.js";
import { centsToInput, toCents } from "./money.js";

type Shell = {
  title: string;
  question: string;
  note?: string;
  saved?: string;
  children: React.ReactNode;
};

function StatedShell({ title, question, note, saved, children }: Shell) {
  return (
    <Card as="section" aria-label={title} data-testid="stated-card" className="mb-[var(--sp-3)]">
      <h3 className="m-0">{title}</h3>
      {note !== undefined && <p className="text-muted text-[0.85rem]">{note}</p>}
      <p className="m-0 mt-1">{question}</p>
      <div className="mt-3">{children}</div>
      {saved !== undefined && (
        <p className="text-muted text-[0.85rem] mt-2" role="status">
          {saved}
        </p>
      )}
    </Card>
  );
}

type Range = { lowCents: number; highCents: number };

/** "Between X and Y" in whole euros, for income or spending with no data. */
export function StatedRangeCard({
  copy: c,
  title,
  question,
  note,
  initial,
  summary,
  onSave,
}: {
  copy: IntakeCopy;
  title: string;
  question: string;
  note?: string;
  initial: Range | undefined;
  summary: (r: Range) => string;
  onSave: (r: Range) => void;
}) {
  const id = useId();
  const [low, setLow] = useState(initial ? centsToInput(initial.lowCents) : "");
  const [high, setHigh] = useState(initial ? centsToInput(initial.highCents) : "");
  const [error, setError] = useState(false);
  return (
    <StatedShell
      title={title}
      question={question}
      {...(note === undefined ? {} : { note })}
      {...(initial ? { saved: c.block1.stated.saved(summary(initial)) } : {})}
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const l = toCents(low);
          const h = toCents(high);
          if (l === null || h === null || l > h) return setError(true);
          setError(false);
          onSave({ lowCents: l, highCents: h });
        }}
      >
        <Field className="mb-0">
          <label htmlFor={`${id}-low`}>{c.common.from}</label>
          <input
            id={`${id}-low`}
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={low}
            onChange={(e) => setLow(e.target.value)}
          />
        </Field>
        <Field className="mb-0">
          <label htmlFor={`${id}-high`}>{c.common.to}</label>
          <input
            id={`${id}-high`}
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={high}
            onChange={(e) => setHigh(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary">
          {c.common.save}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-warn">
          {c.block1.stated.rangeError}
        </p>
      )}
    </StatedShell>
  );
}

type HousingKind = "rent" | "mortgage" | "other";

export function StatedHousingCard({
  copy: c,
  note,
  initial,
  summary,
  onSave,
}: {
  copy: IntakeCopy;
  note?: string;
  initial: { kind: HousingKind; monthlyCents: number } | undefined;
  summary: (v: { kind: HousingKind; monthlyCents: number }) => string;
  onSave: (kind: HousingKind, monthlyCents: number) => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<HousingKind>(initial?.kind ?? "rent");
  const [amount, setAmount] = useState(initial ? centsToInput(initial.monthlyCents) : "");
  const [error, setError] = useState(false);
  const s = c.block1.stated;
  return (
    <StatedShell
      title={s.housingTitle}
      question={s.housingQuestion}
      {...(note === undefined ? {} : { note })}
      {...(initial ? { saved: s.saved(summary(initial)) } : {})}
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const cents = toCents(amount);
          if (cents === null) return setError(true);
          setError(false);
          onSave(kind, cents);
        }}
      >
        <Field className="mb-0">
          <label htmlFor={`${id}-kind`}>{c.block1.sections.housing}</label>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(e) => setKind(e.target.value as HousingKind)}
          >
            {(Object.keys(s.housingKinds) as HousingKind[]).map((k) => (
              <option key={k} value={k}>
                {s.housingKinds[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field className="mb-0">
          <label htmlFor={`${id}-amt`}>{c.block1.amountLabel}</label>
          <input
            id={`${id}-amt`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary">
          {c.common.save}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-warn">
          {s.amountError}
        </p>
      )}
    </StatedShell>
  );
}

export function StatedSavingsCard({
  copy: c,
  initialCents,
  summary,
  onSave,
}: {
  copy: IntakeCopy;
  initialCents: number | undefined;
  summary: (cents: number) => string;
  onSave: (cents: number) => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState(
    initialCents === undefined ? "" : centsToInput(initialCents),
  );
  const [error, setError] = useState(false);
  const s = c.block1.stated;
  return (
    <StatedShell
      title={s.savingsTitle}
      question={s.savingsQuestion}
      {...(initialCents === undefined ? {} : { saved: s.saved(summary(initialCents)) })}
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const cents = toCents(amount);
          if (cents === null) return setError(true);
          setError(false);
          onSave(cents);
        }}
      >
        <Field className="mb-0">
          <label htmlFor={`${id}-amt`}>{c.common.euros}</label>
          <input
            id={`${id}-amt`}
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary">
          {c.common.save}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-warn">
          {s.amountError}
        </p>
      )}
    </StatedShell>
  );
}
