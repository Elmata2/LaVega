import { useId, useState, type ReactNode } from "react";
import type { WizardCopy } from "../../copy/wizard.js";
import AmountField from "./AmountField.js";
import ChoiceTiles from "./ChoiceTiles.js";

type Kind = "rent" | "mortgage" | "other";
type Busy = { busy: boolean };

/** One screen body: Enter submits it when Verder is enabled. */
function Form(p: { ok: boolean; onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="wz-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (p.ok) p.onSubmit();
      }}
    >
      {p.children}
    </form>
  );
}

function Next(p: { label: string; disabled: boolean }) {
  return (
    <div className="wz-footer">
      <button type="submit" className="wz-next" disabled={p.disabled}>
        {p.label}
      </button>
    </div>
  );
}

export function AmountScreen(
  p: Busy & {
    copy: WizardCopy;
    label: string;
    initialCents: number | null;
    /** Zero is a valid answer (savings) or not (income, spend). */
    allowZero: boolean;
    onSubmit: (cents: number) => void;
  },
) {
  const [cents, setCents] = useState<number | null>(p.initialCents);
  const valid = cents !== null && (p.allowZero || cents > 0);
  return (
    <Form ok={valid && !p.busy} onSubmit={() => valid && p.onSubmit(cents)}>
      <AmountField
        label={p.label}
        valueCents={cents}
        onChange={setCents}
        hint={p.copy.estimateHint}
      />
      <Next label={p.copy.next} disabled={!valid || p.busy} />
    </Form>
  );
}

export function HousingScreen(
  p: Busy & {
    copy: WizardCopy;
    label: string;
    initial: { kind: Kind; monthlyCents: number } | null;
    onSubmit: (kind: Kind, monthlyCents: number) => void;
  },
) {
  const [kind, setKind] = useState<Kind | null>(p.initial?.kind ?? null);
  const [cents, setCents] = useState<number | null>(
    p.initial?.monthlyCents ?? null,
  );
  const valid = kind !== null && cents !== null;
  const k = p.copy.housingKinds;
  return (
    <Form ok={valid && !p.busy} onSubmit={() => valid && p.onSubmit(kind, cents)}>
      <ChoiceTiles<Kind>
        label={p.label}
        selected={kind}
        onPick={setKind}
        options={[
          { value: "rent", label: k.rent },
          { value: "mortgage", label: k.mortgage },
          { value: "other", label: k.other },
        ]}
      />
      <AmountField label={p.label} valueCents={cents} onChange={setCents} />
      <Next label={p.copy.next} disabled={!valid || p.busy} />
    </Form>
  );
}

type Row = { id: string; year: string };

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

export function ChildYearsScreen(
  p: Busy & {
    copy: WizardCopy;
    initial: readonly { id: string; birthYear: number }[];
    currentYear: number;
    onSubmit: (children: { id: string; birthYear: number }[]) => void;
  },
) {
  const [rows, setRows] = useState<Row[]>(() =>
    p.initial.length > 0
      ? p.initial.map((c) => ({ id: c.id, year: String(c.birthYear) }))
      : [{ id: `child-${newId()}`, year: "" }],
  );
  const parsed = rows.map((r) =>
    /^\d{4}$/.test(r.year.trim()) ? Number(r.year) : null,
  );
  const valid = parsed.every(
    (y) => y !== null && y >= 1900 && y <= p.currentYear,
  );
  return (
    <Form
      ok={valid && !p.busy}
      onSubmit={() =>
        valid &&
        p.onSubmit(
          rows.map((r, i) => ({ id: r.id, birthYear: parsed[i] as number })),
        )
      }
    >
      {rows.map((r, i) => (
        <div className="wz-amount" key={r.id}>
          <label className="wz-sr" htmlFor={`${r.id}-year`}>
            {p.copy.childYear(i + 1)}
          </label>
          <input
            id={`${r.id}-year`}
            className="wz-amount-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={p.copy.childYear(i + 1)}
            value={r.year}
            onChange={(e) =>
              setRows((all) =>
                all.map((x) =>
                  x.id === r.id ? { ...x, year: e.target.value } : x,
                ),
              )
            }
          />
          {rows.length > 1 ? (
            <button
              type="button"
              className="wz-link"
              onClick={() =>
                setRows((all) => all.filter((x) => x.id !== r.id))
              }
            >
              {p.copy.removeChild(i + 1)}
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="wz-link"
        onClick={() =>
          setRows((all) => [...all, { id: `child-${newId()}`, year: "" }])
        }
      >
        {p.copy.addChild}
      </button>
      <Next label={p.copy.next} disabled={!valid || p.busy} />
    </Form>
  );
}

export function GoalScreen(
  p: Busy & {
    copy: WizardCopy;
    asOf: string;
    initial: {
      purpose: string;
      targetCents: number;
      targetDate: string;
    } | null;
    onSubmit: (g: {
      purpose: string;
      targetCents: number;
      targetDate: string;
    }) => void;
    onSkip: () => void;
  },
) {
  const id = useId();
  const [purpose, setPurpose] = useState(p.initial?.purpose ?? "");
  const [target, setTarget] = useState<number | null>(
    p.initial?.targetCents ?? null,
  );
  const [date, setDate] = useState(p.initial?.targetDate ?? "");
  const dateOk = date > p.asOf;
  const valid =
    purpose.trim() !== "" && target !== null && target > 0 && dateOk;
  return (
    <Form
      ok={valid && !p.busy}
      onSubmit={() =>
        valid &&
        p.onSubmit({
          purpose: purpose.trim(),
          targetCents: target,
          targetDate: date,
        })
      }
    >
      <div className="wz-field">
        <label htmlFor={`${id}-purpose`}>{p.copy.purpose}</label>
        <input
          id={`${id}-purpose`}
          className="wz-text-input"
          type="text"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
      </div>
      <div className="wz-field">
        <p className="wz-field-label">{p.copy.target}</p>
        <AmountField
          label={p.copy.target}
          valueCents={target}
          onChange={setTarget}
        />
      </div>
      <div className="wz-field">
        <label htmlFor={`${id}-date`}>{p.copy.date}</label>
        <input
          id={`${id}-date`}
          className="wz-text-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {date !== "" && !dateOk ? (
          <p className="wz-hint">{p.copy.dateFuture}</p>
        ) : null}
      </div>
      <Next label={p.copy.next} disabled={!valid || p.busy} />
      <button
        type="button"
        className="wz-link"
        disabled={p.busy}
        onClick={p.onSkip}
      >
        {p.copy.noGoal}
      </button>
    </Form>
  );
}

export function DebtScreen(
  p: Busy & {
    copy: WizardCopy;
    initial: { lender: string; monthlyCents: number } | null;
    onSubmit: (d: { lender: string; monthlyCents: number }) => void;
  },
) {
  const id = useId();
  const [lender, setLender] = useState(p.initial?.lender ?? "");
  const [monthly, setMonthly] = useState<number | null>(
    p.initial?.monthlyCents ?? null,
  );
  const valid = lender.trim() !== "" && monthly !== null;
  return (
    <Form
      ok={valid && !p.busy}
      onSubmit={() =>
        valid && p.onSubmit({ lender: lender.trim(), monthlyCents: monthly })
      }
    >
      <div className="wz-field">
        <label htmlFor={`${id}-lender`}>{p.copy.lender}</label>
        <input
          id={`${id}-lender`}
          className="wz-text-input"
          type="text"
          value={lender}
          onChange={(e) => setLender(e.target.value)}
        />
      </div>
      <div className="wz-field">
        <p className="wz-field-label">{p.copy.monthly}</p>
        <AmountField
          label={p.copy.monthly}
          valueCents={monthly}
          onChange={setMonthly}
        />
      </div>
      <Next label={p.copy.next} disabled={!valid || p.busy} />
    </Form>
  );
}
