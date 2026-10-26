import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { Missing, SectionId, SectionResult } from "@lavega/core";
import type { View } from "../../App";
import { useAppLocale } from "../../appLocale.js";
import Button from "../../components/ui/Button.js";
import CardLink from "../../components/ui/CardLink.js";
import Field from "../../components/ui/Field.js";
import { DASH, assumptionsCopy, planFmt, planShellCopy } from "../../copy/plan/index.js";
import { frameCopyOf } from "../sectionCopy.js";
import type { Parsed } from "./parse.js";
import type { PlanCtx } from "./types.js";

/** The locale-bound pieces every section body needs. */
export function useSectionCopy() {
  const [locale] = useAppLocale();
  return {
    locale,
    fmt: planFmt(locale),
    shell: planShellCopy[locale],
    a: assumptionsCopy[locale],
  };
}

const ACTION_VIEW: Record<Missing["action"], View> = {
  "connect-bank": "koppelingen",
  import: "overview",
  "intake-question": "intake",
  "enter-figure": "about-you",
};

/** Why the status is what it is, and what is missing with its one action each.
 *  Every section starts its figures with this. */
export function StatusBody({
  section,
  result,
  ctx,
}: {
  section: SectionId;
  result: SectionResult<unknown>;
  ctx: PlanCtx;
}) {
  const { locale, shell } = useSectionCopy();
  const copy = frameCopyOf(locale, section);
  const reason = copy.reasons[result.statusReason.key];
  return (
    <>
      {reason !== undefined && <p className="m-0 mb-2">{reason}</p>}
      {result.missing.length > 0 && (
        <ul className="m-0 mb-2 grid list-none gap-3 p-0">
          {result.missing.map((m, i) => (
            <li key={`${m.kind}-${m.ref ?? i}`}>
              <p className="m-0">{copy.empty[m.kind] ?? shell.missing[m.kind]}</p>
              <CardLink
                data-testid="plan-missing-action"
                onClick={() => ctx.onNavigate(ACTION_VIEW[m.action])}
              >
                {shell.actions[m.action]}
              </CardLink>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** "How we calculated this": one plain sentence per calculation step. */
export function CalcList({
  section,
  result,
}: {
  section: SectionId;
  result: SectionResult<unknown>;
}) {
  const { locale } = useSectionCopy();
  const copy = frameCopyOf(locale, section);
  if (result.calc.length === 0) return null;
  return (
    <ul className="m-0 grid list-none gap-1 p-0 text-[0.9rem]">
      {result.calc.map((step, i) => (
        <li key={`${step.id}-${i}`}>{copy.howCalculated[step.id] ?? step.id}</li>
      ))}
    </ul>
  );
}

export type FigureRow = { key: string; label: string; value: string | null };

/** Label and value pairs. A missing value is the dash, never a zero. */
export function Rows({ rows, testId }: { rows: FigureRow[]; testId?: string }) {
  if (rows.length === 0) return null;
  return (
    <dl
      className="m-0 mb-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[0.95rem]"
      data-testid={testId}
    >
      {rows.map((r) => (
        <div key={r.key} className="contents">
          <dt className="text-muted">{r.label}</dt>
          <dd className="m-0 text-right">{r.value ?? DASH}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Plain lines, each as its own paragraph. Text only: names are never HTML. */
export function Lines({ lines }: { lines: (string | null)[] }) {
  const shown = lines.filter((l): l is string => l !== null && l !== "");
  return (
    <>
      {shown.map((l, i) => (
        <p key={`${i}-${l}`} className="m-0 mb-1 text-[0.9rem]">
          {l}
        </p>
      ))}
    </>
  );
}

export function Sources({ lines }: { lines: (string | null)[] }) {
  const shown = lines.filter((l): l is string => l !== null);
  if (shown.length === 0) return null;
  return (
    <ul className="m-0 grid list-none gap-1 p-0 text-[0.9rem]">
      {shown.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

export type ValueInputProps<T> = {
  /** Test id suffix and the input's name. */
  name: string;
  label: string;
  hint?: string;
  /** The stored value as text; "" when nothing is stored. Never a default. */
  stored: string;
  parse: (text: string) => Parsed<T>;
  onSave: (value: T) => Promise<void>;
  onClear?: () => Promise<void>;
};

/** One figure the person types: empty until they have stored one, checked
 *  before it is saved, and an inline error instead of a saved bad value. */
export function ValueInput<T>({
  name,
  label,
  hint,
  stored,
  parse,
  onSave,
  onClear,
}: ValueInputProps<T>) {
  const { a } = useSectionCopy();
  const id = useId();
  const [draft, setDraft] = useState(stored);
  const [seen, setSeen] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (seen !== stored) {
    setSeen(stored);
    setDraft(stored);
  }

  async function run(job: () => Promise<void>) {
    setBusy(true);
    try {
      await job();
      setError(null);
    } catch {
      setError(a.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const r = parse(draft);
    if (!r.ok) {
      setError(a.errors[r.error]);
      return;
    }
    void run(() => onSave(r.value));
  }

  return (
    <form onSubmit={submit} noValidate className="mb-3">
      <Field className="mb-1">
        <label htmlFor={id}>{label}</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft}
            data-testid={`plan-input-${name}`}
            aria-invalid={error !== null}
            aria-describedby={hint === undefined ? `${id}-err` : `${id}-hint ${id}-err`}
            onChange={(e) => setDraft(e.target.value)}
            className="min-w-0 max-w-[12rem] flex-1"
          />
          <Button type="submit" disabled={busy} data-testid={`plan-save-${name}`}>
            {a.save}
          </Button>
          {stored !== "" && onClear !== undefined && (
            <CardLink
              data-testid={`plan-clear-${name}`}
              disabled={busy}
              onClick={() => void run(onClear)}
            >
              {a.clear}
            </CardLink>
          )}
        </div>
      </Field>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="m-0 text-muted text-[0.85rem]">
          {hint}
        </p>
      )}
      <p
        id={`${id}-err`}
        role={error === null ? undefined : "alert"}
        data-testid={`plan-error-${name}`}
        className="m-0 text-warn text-[0.85rem]"
      >
        {error}
      </p>
    </form>
  );
}

/** A labelled group of controls. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <h5 className="m-0 mb-1 text-[0.85rem] font-semibold">{title}</h5>
      {children}
    </div>
  );
}
