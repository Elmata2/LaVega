import { useId, useState } from "react";
import type { AdvisorProfile, Goal } from "@lavega/core";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import Field from "../components/ui/Field.js";
import Pill from "../components/ui/Pill.js";
import type { IntakeCopy } from "../copy/intake.js";
import { formatDate, formatWholeEuroIn } from "../format.js";
import type { Locale } from "../locale.js";
import { toCents } from "./money.js";
import {
  applyBuffer,
  applyChildren,
  applyGoals,
  applyHousehold,
  addUserDebt,
  isUserDebt,
  removeUserDebt,
} from "./state.js";

type Props = {
  copy: IntakeCopy;
  locale: Locale;
  asOf: string;
  profile: AdvisorProfile;
  /** The block 1 child question was answered Yes (nothing is stored for it). */
  saidChildren: boolean;
  update: (fn: (p: AdvisorProfile) => AdvisorProfile) => Promise<boolean>;
  onDone: () => void;
};

const BUFFER_CHOICES = [0, 1, 2, 3, 4, 5, 6, 9, 12];

const nextId = (prefix: string, existing: readonly string[]): string => {
  let n = existing.length + 1;
  while (existing.includes(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
};

/** Goal ids are random, never counted from the list: a goal's plan anchors are
 *  keyed by its id, so a removed goal's id must not come back. */
const newGoalId = (): string =>
  `goal-${
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  }`;

export default function Block2(p: Props) {
  const { copy: c, locale, profile } = p;
  const b = c.block2;
  const eur = (cents: number) => formatWholeEuroIn(locale, cents / 100);
  const household = profile.household?.value;
  const children = profile.children?.value ?? [];
  const goals = profile.goals ?? [];
  const debts = (profile.debts ?? []).filter(isUserDebt);

  return (
    <>
      <Card as="section" aria-label={b.title}>
        <h2>{b.title}</h2>
        <p className="text-muted text-[0.85rem]">{b.intro}</p>
      </Card>

      <Card as="section" aria-label={b.household.title}>
        <h3 className="m-0">{b.household.title}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["alone", "together"] as const).map((k) => (
            <Pill
              key={k}
              active={household?.kind === k}
              aria-pressed={household?.kind === k}
              onClick={() => void p.update((pr) => applyHousehold(pr, { kind: k }, p.asOf))}
            >
              {b.household[k]}
            </Pill>
          ))}
        </div>
        {household?.kind === "together" && (
          <label className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={household.partnerIncomeInScope === true}
              onChange={(e) => {
                // Read before the save is queued: the event is gone by then.
                const inScope = e.target.checked;
                void p.update((pr) =>
                  applyHousehold(pr, { kind: "together", partnerIncomeInScope: inScope }, p.asOf),
                );
              }}
            />
            {b.household.partnerIncome}
          </label>
        )}
      </Card>

      <ChildrenCard {...p} childrenList={children} />

      <GoalsCard {...p} goals={goals.map((g) => g.value)} eur={eur} />

      <Card as="section" aria-label={b.debts.title}>
        <h3 className="m-0">{b.debts.title}</h3>
        <p className="text-muted text-[0.85rem]">{b.debts.intro}</p>
        {debts.length === 0 ? (
          <p className="text-muted text-[0.85rem]">{b.debts.empty}</p>
        ) : (
          <ul className="list-none p-0">
            {debts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span>{b.debts.item(d.lender, eur(d.monthlyCents))}</span>
                <Button onClick={() => void p.update((pr) => removeUserDebt(pr, d.id))}>
                  {c.common.remove}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DebtForm {...p} />
      </Card>

      <Card as="section" aria-label={b.buffer.title}>
        <h3 className="m-0">{b.buffer.title}</h3>
        <Field className="mt-2">
          <label htmlFor="in-buffer">{b.buffer.intro}</label>
          <select
            id="in-buffer"
            value={profile.buffer === undefined ? "" : String(profile.buffer.value.months)}
            onChange={(e) => {
              const months = e.target.value === "" ? null : Number(e.target.value);
              if (months !== null) void p.update((pr) => applyBuffer(pr, months, p.asOf));
            }}
          >
            <option value="">{b.buffer.unset}</option>
            {BUFFER_CHOICES.map((m) => (
              <option key={m} value={m}>
                {b.buffer.option(m)}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <div className="mt-4">
        <Button variant="primary" onClick={p.onDone}>
          {c.common.continue}
        </Button>
      </div>
    </>
  );
}

function ChildrenCard(p: Props & { childrenList: readonly { id: string; birthYear: number }[] }) {
  const b = p.copy.block2.children;
  const id = useId();
  const [year, setYear] = useState("");
  const thisYear = Number(p.asOf.slice(0, 4));
  const y = Number(year);
  const valid = Number.isInteger(y) && y >= thisYear - 40 && y <= thisYear;
  return (
    <Card as="section" aria-label={b.title}>
      <h3 className="m-0">{b.title}</h3>
      <p className="text-muted text-[0.85rem]">{b.intro}</p>
      {p.saidChildren && <p>{b.saidYes}</p>}
      {p.childrenList.length === 0 ? (
        <p className="text-muted text-[0.85rem]">{b.none}</p>
      ) : (
        <ul className="list-none p-0">
          {p.childrenList.map((ch) => (
            <li key={ch.id} className="flex flex-wrap items-center gap-2">
              <span>{b.item(ch.birthYear)}</span>
              <Button
                onClick={() =>
                  void p.update((pr) =>
                    applyChildren(
                      pr,
                      (pr.children?.value ?? []).filter((x) => x.id !== ch.id),
                      p.asOf,
                    ),
                  )
                }
              >
                {p.copy.common.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          setYear("");
          void p.update((pr) => {
            const list = pr.children?.value ?? [];
            return applyChildren(
              pr,
              [
                ...list,
                {
                  id: nextId(
                    "child",
                    list.map((x) => x.id),
                  ),
                  birthYear: y,
                },
              ],
              p.asOf,
            );
          });
        }}
      >
        <Field className="mb-0">
          <label htmlFor={`${id}-year`}>{b.birthYear}</label>
          <input
            id={`${id}-year`}
            type="number"
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={!valid}>
          {b.add}
        </Button>
      </form>
    </Card>
  );
}

function GoalsCard(p: Props & { goals: Goal[]; eur: (cents: number) => string }) {
  const b = p.copy.block2.goals;
  const id = useId();
  const kids = p.profile.children?.value ?? [];
  const [purpose, setPurpose] = useState("");
  const [kind, setKind] = useState<"general" | "child">("general");
  const [childId, setChildId] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [priority, setPriority] = useState<Goal["priority"]>("important");
  const [planned, setPlanned] = useState("");
  const [error, setError] = useState(false);

  function add() {
    const t = toCents(target);
    const planCents = toCents(planned);
    const kidId = kind === "child" ? childId || kids[0]?.id || "" : "";
    if (
      purpose.trim() === "" ||
      t === null ||
      t === 0 ||
      date === "" ||
      (kind === "child" && kidId === "")
    )
      return setError(true);
    setError(false);
    const goal: Goal = {
      id: newGoalId(),
      purpose: purpose.trim(),
      kind,
      ...(kind === "child" ? { childId: kidId } : {}),
      targetCents: t,
      targetDate: date,
      priority,
      ...(planCents === null ? {} : { plannedMonthlyCents: planCents }),
      accountRefs: [],
    };
    setPurpose("");
    setTarget("");
    setDate("");
    setPlanned("");
    void p.update((pr) => applyGoals(pr, [...(pr.goals ?? []).map((g) => g.value), goal], p.asOf));
  }

  return (
    <Card as="section" aria-label={b.title}>
      <h3 className="m-0">{b.title}</h3>
      <p className="text-muted text-[0.85rem]">{b.intro}</p>
      {p.goals.length === 0 ? (
        <p className="text-muted text-[0.85rem]">{b.empty}</p>
      ) : (
        <ul className="list-none p-0">
          {p.goals.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2">
              <span>
                {b.item(
                  g.purpose,
                  p.eur(g.targetCents),
                  formatDate(p.locale, g.targetDate),
                  b.priorities[g.priority],
                )}
              </span>
              <Button
                onClick={() =>
                  void p.update((pr) =>
                    applyGoals(
                      pr,
                      (pr.goals ?? []).map((x) => x.value).filter((x) => x.id !== g.id),
                      p.asOf,
                    ),
                  )
                }
              >
                {p.copy.common.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field>
          <label htmlFor={`${id}-purpose`}>{b.purpose}</label>
          <input
            id={`${id}-purpose`}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </Field>
        <Field>
          <label htmlFor={`${id}-kind`}>{b.kind}</label>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(e) => setKind(e.target.value as "general" | "child")}
          >
            <option value="general">{b.kinds.general}</option>
            {kids.length > 0 && <option value="child">{b.kinds.child}</option>}
          </select>
        </Field>
        {kind === "child" && (
          <Field>
            <label htmlFor={`${id}-child`}>{b.child}</label>
            <select
              id={`${id}-child`}
              value={childId || kids[0]?.id}
              onChange={(e) => setChildId(e.target.value)}
            >
              {kids.map((k) => (
                <option key={k.id} value={k.id}>
                  {p.copy.block2.children.item(k.birthYear)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field>
          <label htmlFor={`${id}-target`}>{b.target}</label>
          <input
            id={`${id}-target`}
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field>
          <label htmlFor={`${id}-date`}>{b.date}</label>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field>
          <label htmlFor={`${id}-priority`}>{b.priority}</label>
          <select
            id={`${id}-priority`}
            value={priority}
            onChange={(e) => setPriority(e.target.value as Goal["priority"])}
          >
            {(["flexible", "important", "must"] as const).map((k) => (
              <option key={k} value={k}>
                {b.priorities[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <label htmlFor={`${id}-planned`}>{b.planned}</label>
          <input
            id={`${id}-planned`}
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
          />
        </Field>
        <div>
          <Button type="submit">{b.add}</Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-warn">
          {b.error}
        </p>
      )}
    </Card>
  );
}

function DebtForm(p: Props) {
  const b = p.copy.block2.debts;
  const id = useId();
  const [lender, setLender] = useState("");
  const [monthly, setMonthly] = useState("");
  const [balance, setBalance] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState(false);
  return (
    <>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const m = toCents(monthly);
          const bal = toCents(balance);
          const r = rate.trim() === "" ? null : Number(rate);
          if (lender.trim() === "" || m === null || (r !== null && !Number.isFinite(r)))
            return setError(true);
          setError(false);
          const entry = {
            id: nextId(
              "debt",
              (p.profile.debts ?? []).map((d) => d.id),
            ),
            lender: lender.trim(),
            monthlyCents: m,
            ...(bal === null ? {} : { balanceCents: bal }),
            ...(r === null ? {} : { ratePct: r }),
          };
          setLender("");
          setMonthly("");
          setBalance("");
          setRate("");
          void p.update((pr) => addUserDebt(pr, entry, p.asOf));
        }}
      >
        <Field>
          <label htmlFor={`${id}-lender`}>{b.lender}</label>
          <input id={`${id}-lender`} value={lender} onChange={(e) => setLender(e.target.value)} />
        </Field>
        <Field>
          <label htmlFor={`${id}-monthly`}>{b.monthly}</label>
          <input
            id={`${id}-monthly`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
        </Field>
        <Field>
          <label htmlFor={`${id}-balance`}>{b.balance}</label>
          <input
            id={`${id}-balance`}
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </Field>
        <Field>
          <label htmlFor={`${id}-rate`}>{b.rate}</label>
          <input
            id={`${id}-rate`}
            type="number"
            inputMode="decimal"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </Field>
        <div>
          <Button type="submit">{b.add}</Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-warn">
          {b.error}
        </p>
      )}
    </>
  );
}
