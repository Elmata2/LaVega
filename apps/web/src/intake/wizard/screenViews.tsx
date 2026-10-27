import { useId, useState, type ReactNode } from "react";
import type { WorkKind } from "@lavega/core";
import type { WizardCopy } from "../../copy/wizard.js";
import AmountField from "./AmountField.js";
import ChoiceTiles from "./ChoiceTiles.js";
import CardPicker, { orderedCardIds } from "./CardPicker.js";
import type { CardKind } from "./cardOptions.js";
import MultiTiles from "./MultiTiles.js";
import { WORK_ORDER } from "./screens.js";

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

export function WorkScreen(
  p: Busy & {
    copy: WizardCopy;
    label: string;
    initial: readonly WorkKind[];
    onSubmit: (kinds: WorkKind[]) => void;
  },
) {
  const [picked, setPicked] = useState<readonly WorkKind[]>(p.initial);
  const valid = picked.length > 0;
  return (
    <Form
      ok={valid && !p.busy}
      onSubmit={() => valid && p.onSubmit(WORK_ORDER.filter((k) => picked.includes(k)))}
    >
      <MultiTiles<WorkKind>
        label={p.label}
        disabled={p.busy}
        selected={picked}
        onToggle={(k) =>
          setPicked((all) => (all.includes(k) ? all.filter((x) => x !== k) : [...all, k]))
        }
        options={WORK_ORDER.map((k) => ({ value: k, label: p.copy.workKinds[k] }))}
      />
      <Next label={p.copy.next} disabled={!valid || p.busy} />
    </Form>
  );
}

/** Spend bands in cents, low to high; labels come from copy.spendBands. */
export const SPEND_BANDS: readonly { lowCents: number; highCents: number }[] = [
  { lowCents: 75000, highCents: 150000 },
  { lowCents: 150000, highCents: 250000 },
  { lowCents: 250000, highCents: 350000 },
  { lowCents: 350000, highCents: 500000 },
  { lowCents: 500000, highCents: 750000 },
];

type StoredRange = { lowCents: number; highCents: number } | null;

export function SpendScreen(
  p: Busy & {
    copy: WizardCopy;
    label: string;
    stored: StoredRange;
    onExact: (cents: number) => void;
    onBand: (range: { lowCents: number; highCents: number }) => void;
  },
) {
  const bandAt = p.stored
    ? SPEND_BANDS.findIndex(
        (b) => b.lowCents === p.stored!.lowCents && b.highCents === p.stored!.highCents,
      )
    : -1;
  const [bands, setBands] = useState(bandAt >= 0);
  if (!bands) {
    return (
      <>
        <AmountScreen
          copy={p.copy}
          busy={p.busy}
          label={p.label}
          initialCents={
            p.stored !== null && p.stored.highCents === p.stored.lowCents
              ? p.stored.lowCents
              : null
          }
          allowZero
          onSubmit={p.onExact}
        />
        <button
          type="button"
          className="wz-link"
          disabled={p.busy}
          onClick={() => setBands(true)}
        >
          {p.copy.spendUnknown}
        </button>
      </>
    );
  }
  return (
    <>
      <ChoiceTiles<string>
        label={p.label}
        disabled={p.busy}
        selected={bandAt >= 0 ? String(bandAt) : null}
        onPick={(v) => p.onBand(SPEND_BANDS[Number(v)] as (typeof SPEND_BANDS)[number])}
        options={SPEND_BANDS.map((_, i) => ({
          value: String(i),
          label: p.copy.spendBands[i] as string,
        }))}
      />
      <button
        type="button"
        className="wz-link"
        disabled={p.busy}
        onClick={() => setBands(false)}
      >
        {p.copy.spendExact}
      </button>
    </>
  );
}

export function CardsScreen(
  p: Busy & {
    copy: WizardCopy;
    label: string;
    initial: readonly string[];
    kind?: CardKind;
    onSubmit: (ids: string[]) => void;
  },
) {
  const [picked, setPicked] = useState<readonly string[]>(p.initial);
  const valid = picked.length > 0;
  return (
    <Form ok={valid && !p.busy} onSubmit={() => valid && p.onSubmit(orderedCardIds(picked, p.kind))}>
      <CardPicker
        copy={p.copy}
        kind={p.kind}
        label={p.label}
        disabled={p.busy}
        picked={picked}
        onChange={setPicked}
      />
      <Next label={p.copy.next} disabled={!valid || p.busy} />
    </Form>
  );
}

/** Optional last screen: hand a statement to the app's import. The wizard is
 *  full-screen, so a failure is shown here, not in the page banner. */
export function UploadScreen(
  p: Busy & {
    copy: WizardCopy;
    onImport: (file: File) => Promise<{ ok: true; count: number } | { ok: false }>;
    onFinish: () => void;
  },
) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "working" } | { kind: "ok"; count: number } | { kind: "failed" }
  >({ kind: "idle" });
  const u = p.copy.upload;
  const working = state.kind === "working";

  async function pick(file: File) {
    setState({ kind: "working" });
    try {
      const r = await p.onImport(file);
      setState(r.ok ? { kind: "ok", count: r.count } : { kind: "failed" });
    } catch {
      setState({ kind: "failed" });
    }
  }

  return (
    <div className="wz-form">
      {state.kind === "ok" ? (
        <>
          <p role="status" className="wz-hint">
            {state.count > 0 ? u.imported(state.count) : u.nothingNew}
          </p>
          <div className="wz-footer">
            <button type="button" className="wz-next" disabled={p.busy} onClick={p.onFinish}>
              {u.toPlan}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="wz-footer">
            {/* No `accept`: the format is sniffed from the contents, as in Import. */}
            <div>
              <label className="wz-next wz-upload" aria-disabled={working || p.busy}>
                {u.button}
                <input
                  type="file"
                  className="wz-sr"
                  disabled={working || p.busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void pick(file);
                  }}
                />
              </label>
            </div>
            {state.kind === "failed" ? (
              <p role="alert" className="wz-error">
                {u.failed}
              </p>
            ) : null}
            <div>
              <button
                type="button"
                className="wz-link"
                disabled={working || p.busy}
                onClick={p.onFinish}
              >
                {u.later}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
