import { useEffect, useState } from "react";
import {
  RISK_SCALE,
  type AdvisorProfile,
  type AdvisorProfileStore,
  type Goal,
} from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import { intakeCopy } from "../copy/intake.js";
import { wizardCopy } from "../copy/wizard.js";
import { formatWholeEuroIn } from "../format.js";
import {
  applyBuffer,
  applyChildren,
  applyHousehold,
  applyKnowledge,
  applyRiskAnswers,
  applyStatedCards,
  applyStatedDebitCards,
  applyStatedHousing,
  applyStatedRange,
  applyStatedSavings,
  applyWork,
  applyChargesVat,
} from "../intake/state.js";
import { useProfileCommit } from "../intake/useProfileCommit.js";
import ChoiceTiles from "../intake/wizard/ChoiceTiles.js";
import WizardFrame from "../intake/wizard/WizardFrame.js";
import {
  answerCards,
  answerDebts,
  answerHasChildren,
  answerNoChildren,
  markDone,
  resumeScreen,
  screensFor,
  sectionOf,
  type ScreenId,
} from "../intake/wizard/screens.js";
import {
  AmountScreen,
  CardsScreen,
  ChildYearsScreen,
  DebtScreen,
  GoalScreen,
  HousingScreen,
  SpendScreen,
  UploadScreen,
  WorkScreen,
} from "../intake/wizard/screenViews.js";

export type IntakeWizardProps = {
  store: AdvisorProfileStore | null;
  corrupt?: boolean;
  asOf: string;
  onSave: (next: AdvisorProfileStore) => Promise<void>;
  onImport: (file: File) => Promise<{ ok: true; count: number } | { ok: false }>;
  onFinish: () => void;
  onExit: () => void;
  now?: () => string;
};

const WIZARD_GOAL = "wizard-goal";
const WIZARD_DEBT = "wizard-debt";
const BUFFER_CHOICES = [0, 1, 2, 3, 4, 5, 6, 9, 12];

/** The wizard owns the debt with this id whatever its source: Nee removes it. */
const dropWizardDebt = (p: AdvisorProfile): AdvisorProfile => ({
  ...p,
  debts: (p.debts ?? []).filter((d) => d.id !== WIZARD_DEBT),
});

/** Replaces the wizard debt in place, keeping any balance, rate and source the
 *  plan filled in; appends it when absent. */
function saveWizardDebt(
  p: AdvisorProfile,
  d: { lender: string; monthlyCents: number },
  asOf: string,
): AdvisorProfile {
  const debts = p.debts ?? [];
  if (!debts.some((x) => x.id === WIZARD_DEBT)) {
    return {
      ...p,
      debts: [...debts, { id: WIZARD_DEBT, ...d, source: "stated", at: asOf }],
    };
  }
  return {
    ...p,
    debts: debts.map((x) =>
      x.id === WIZARD_DEBT ? { ...x, ...d, at: asOf } : x,
    ),
  };
}

export default function IntakeWizard(props: IntakeWizardProps) {
  const [locale] = useAppLocale();
  const w = wizardCopy[locale];
  const ic = intakeCopy[locale];
  const now = props.now ?? (() => new Date().toISOString());
  const { store, update, saveFailed, setSaveFailed } = useProfileCommit(
    props.store,
    props.onSave,
    now,
  );
  const profile = store.current;
  const [screen, setScreen] = useState<ScreenId | "done">(() =>
    resumeScreen(profile),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (screen === "done") props.onFinish();
    // onFinish is the parent's; fire once when the wizard reaches the end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  if (screen === "done") return <></>;

  const list = screensFor(profile);
  const at = list.indexOf(screen);
  const step = at + 1;
  const total = list.length;
  const eur = (n: number) => formatWholeEuroIn(locale, n);
  const together = profile.household?.value.kind === "together";

  /** Save one screen, then move on only when the store took it. */
  async function save(apply: (p: AdvisorProfile) => AdvisorProfile) {
    if (screen === "done" || busy) return;
    const id = screen;
    const change = (p: AdvisorProfile) => markDone(apply(p), id);
    const after = screensFor(change(profile));
    setBusy(true);
    const ok = await update(change);
    setBusy(false);
    if (!ok) return;
    setScreen(after[after.indexOf(id) + 1] ?? "done");
  }

  const back =
    at > 0
      ? () => {
          setSaveFailed(false);
          setScreen(list[at - 1] as ScreenId);
        }
      : null;

  const asOf = props.asOf;
  const q = w.questions;
  let question = "";
  let body: React.ReactNode = null;

  const choice = <T extends string>(
    label: string,
    options: { value: T; label: string }[],
    selected: T | null,
    onPick: (v: T) => void,
  ) => (
    <ChoiceTiles
      label={label}
      options={options}
      selected={selected}
      onPick={onPick}
      disabled={busy}
    />
  );

  if (screen === "household") {
    question = q.household;
    const sel = profile.household?.value.kind ?? null;
    body = choice(
      question,
      [
        { value: "alone", label: w.alone },
        { value: "together", label: w.together },
      ],
      sel,
      (kind) =>
        void save((p) =>
          applyHousehold(
            p,
            { kind, partnerIncomeInScope: kind === "together" },
            asOf,
          ),
        ),
    );
  } else if (screen === "children") {
    question = q.children;
    const kids = profile.children?.value;
    const sel = kids === undefined ? null : kids.length === 0 ? "no" : "yes";
    body = choice(
      question,
      [
        { value: "yes", label: w.yes },
        { value: "no", label: w.no },
      ],
      sel,
      (v) =>
        void save((p) =>
          v === "no" ? answerNoChildren(p, asOf) : answerHasChildren(p),
        ),
    );
  } else if (screen === "child-years") {
    question = q.childYears;
    body = (
      <ChildYearsScreen
        copy={w}
        busy={busy}
        initial={profile.children?.value ?? []}
        currentYear={new Date(asOf).getFullYear()}
        onSubmit={(kids) => void save((p) => applyChildren(p, kids, asOf))}
      />
    );
  } else if (screen === "work") {
    question = q.work;
    body = (
      <WorkScreen
        copy={w}
        busy={busy}
        label={question}
        initial={profile.work?.value ?? []}
        onSubmit={(kinds) => void save((p) => applyWork(p, kinds, asOf))}
      />
    );
  } else if (screen === "vat") {
    question = q.vat;
    const sel = profile.chargesVat === undefined ? null : profile.chargesVat.value ? "yes" : "no";
    body = choice(
      question,
      [
        { value: "yes", label: w.yes },
        { value: "no", label: w.no },
      ],
      sel,
      (v) => void save((p) => applyChargesVat(p, v === "yes", asOf)),
    );
  } else if (screen === "spend") {
    question = q.spend(together);
    const stored = profile.statedRanges?.value?.spend ?? null;
    body = (
      <SpendScreen
        copy={w}
        busy={busy}
        label={question}
        stored={stored}
        onExact={(c) =>
          void save((p) =>
            applyStatedRange(p, "spend", { lowCents: c, highCents: c }, asOf),
          )
        }
        onBand={(range) => void save((p) => applyStatedRange(p, "spend", range, asOf))}
      />
    );
  } else if (screen === "income") {
    question = q.income(together);
    const stored = profile.statedRanges?.value?.income?.lowCents ?? null;
    body = (
      <AmountScreen
        copy={w}
        busy={busy}
        label={question}
        initialCents={stored}
        allowZero={false}
        onSubmit={(c) =>
          void save((p) =>
            applyStatedRange(p, "income", { lowCents: c, highCents: c }, asOf),
          )
        }
      />
    );
  } else if (screen === "housing") {
    question = q.housing(together);
    const h = profile.housing?.value;
    body = (
      <HousingScreen
        copy={w}
        busy={busy}
        label={question}
        initial={h ? { kind: h.kind, monthlyCents: h.monthlyCents } : null}
        onSubmit={(kind, c) =>
          void save((p) => applyStatedHousing(p, kind, c, asOf))
        }
      />
    );
  } else if (screen === "savings") {
    question = q.savings(together);
    body = (
      <AmountScreen
        copy={w}
        busy={busy}
        label={question}
        initialCents={profile.savings?.value.totalCents ?? null}
        allowZero
        onSubmit={(c) => void save((p) => applyStatedSavings(p, c, asOf))}
      />
    );
  } else if (screen === "goal") {
    question = q.goal;
    const mine = profile.goals?.find((g) => g.value.id === WIZARD_GOAL)?.value;
    body = (
      <GoalScreen
        copy={w}
        busy={busy}
        asOf={asOf}
        initial={mine ?? null}
        onSkip={() => void save((p) => p)}
        onSubmit={(g) =>
          void save((p) => {
            const goal: Goal = {
              ...g,
              id: WIZARD_GOAL,
              kind: "general",
              priority: "important",
              accountRefs: [],
            };
            const others = (p.goals ?? []).filter(
              (x) => x.value.id !== WIZARD_GOAL,
            );
            return {
              ...p,
              goals: [
                ...others,
                { value: goal, source: "stated" as const, at: asOf },
              ],
            };
          })
        }
      />
    );
  } else if (screen === "debts") {
    question = q.debts;
    const sel =
      profile.intake.noUserDebts === true
        ? "no"
        : (profile.debts ?? []).some((d) => d.id === WIZARD_DEBT)
          ? "yes"
          : null;
    body = choice(
      question,
      [
        { value: "yes", label: w.yes },
        { value: "no", label: w.no },
      ],
      sel,
      (v) =>
        void save((p) =>
          v === "yes"
            ? answerDebts(p, true)
            : answerDebts(dropWizardDebt(p), false),
        ),
    );
  } else if (screen === "debt-details") {
    question = q.debtDetails;
    const mine = (profile.debts ?? []).find((d) => d.id === WIZARD_DEBT);
    body = (
      <DebtScreen
        copy={w}
        busy={busy}
        initial={
          mine ? { lender: mine.lender, monthlyCents: mine.monthlyCents } : null
        }
        onSubmit={(d) =>
          void save((p) => saveWizardDebt(p, d, asOf))
        }
      />
    );
  } else if (screen === "debit-cards") {
    question = q.debitCards(together);
    body = (
      <CardsScreen
        copy={w}
        busy={busy}
        kind="debit"
        label={question}
        initial={profile.statedDebitCards?.value ?? []}
        onSubmit={(ids) => void save((p) => applyStatedDebitCards(p, ids, asOf))}
      />
    );
  } else if (screen === "has-cards") {
    question = q.hasCards(together);
    const sel = profile.intake.noCards === true
        ? "no"
        : profile.intake.noCards === false || (profile.statedCards?.value.length ?? 0) > 0
          ? "yes"
          : null;
    body = choice(
      question,
      [
        { value: "yes", label: w.yes },
        { value: "no", label: w.no },
      ],
      sel,
      (v) => void save((p) => answerCards(p, v === "yes", asOf)),
    );
  } else if (screen === "cards") {
    question = q.cards(together);
    body = (
      <CardsScreen
        copy={w}
        busy={busy}
        label={question}
        initial={profile.statedCards?.value ?? []}
        onSubmit={(ids) => void save((p) => applyStatedCards(p, ids, asOf))}
      />
    );
  } else if (screen === "buffer") {
    question = q.buffer;
    const m = profile.buffer?.value.months;
    body = choice(
      question,
      BUFFER_CHOICES.map((n) => ({
        value: String(n),
        label: w.bufferOption(n),
      })),
      m === undefined ? null : String(m),
      (v) => void save((p) => applyBuffer(p, Number(v), asOf)),
    );
  } else if (screen === "invested") {
    const inv = ic.block3.knowledge.invested;
    question = inv.prompt;
    const stored = profile.knowledge?.value.investedBefore;
    body = choice(
      question,
      [
        { value: "yes", label: inv.yes },
        { value: "no", label: inv.no },
      ],
      stored === undefined ? null : stored ? "yes" : "no",
      (v) =>
        void save((p) =>
          applyKnowledge(
            p,
            p.knowledge?.value.answers ?? {},
            v === "yes",
            asOf,
          ),
        ),
    );
  } else if (screen === "upload") {
    question = q.upload;
    body = (
      <UploadScreen
        copy={w}
        busy={busy}
        onImport={props.onImport}
        onFinish={() => void save((p) => p)}
      />
    );
  } else {
    const itemId = screen.slice("risk:".length);
    const item = ic.block3.risk.items[itemId];
    const scale = RISK_SCALE.items.find((i) => i.id === itemId);
    question = item?.prompt(eur) ?? "";
    const stored = profile.risk?.answers?.[itemId] ?? null;
    body = choice(
      question,
      (scale?.options ?? []).map((o) => ({
        value: o.id,
        label: item?.options[o.id] ?? o.id,
      })),
      stored,
      (v) =>
        void save((p) =>
          applyRiskAnswers(p, { ...p.risk?.answers, [itemId]: v }, asOf),
        ),
    );
  }

  return (
    <WizardFrame
      step={step}
      total={total}
      counter={w.counter(step, total)}
      section={w.sections[sectionOf(screen)]}
      question={question}
      onBack={back}
      backLabel={w.back}
      topRight={
        <button
          type="button"
          className="wz-close"
          aria-label={w.close}
          onClick={props.onExit}
        >
          ×
        </button>
      }
    >
      {props.corrupt ? (
        <p role="status" className="wz-hint">
          {ic.corruptNotice}
        </p>
      ) : null}
      {body}
      {saveFailed ? (
        <p role="alert" className="wz-error">
          {w.saveFailed}
        </p>
      ) : null}
    </WizardFrame>
  );
}
