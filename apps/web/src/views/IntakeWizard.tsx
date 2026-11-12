import { useEffect, useState } from "react";
import {
  AdvisorProfile,
  REWARD_PROGRAMS,
  RISK_SCALE,
  type AdvisorProfileStore,
  type Goal,
  type RewardsBalance,
} from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import { intakeCopy } from "../copy/intake.js";
import { wizardCopy } from "../copy/wizard.js";
import { formatWholeEuroIn } from "../format.js";
import {
  applyBirthYear,
  applyBuffer,
  applyCardBalances,
  applyCardRepayment,
  applyCheckInCadence,
  applyChildren,
  applyConfidence,
  applyCutTargets,
  applyFlightsPerYear,
  applyPointsGoal,
  applyStatedPrograms,
  applyForeignSpend,
  applyHousehold,
  applyIncomeRegularity,
  applyKnowledge,
  applyMoneySharing,
  applyPriorities,
  applySpendMix,
  applyStatedBanks,
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
import { applyPoints, cardName, detailRows } from "../intake/wizard/cardDetails.js";
import CardDetailsForm from "../intake/wizard/CardDetailsForm.js";
import { bankBrandIds } from "../intake/wizard/cardOptions.js";
import SummaryScreen from "../intake/wizard/SummaryScreen.js";
import { summaryRows } from "../intake/wizard/summaryRows.js";
import WizardFrame from "../intake/wizard/WizardFrame.js";
import {
  answerCards,
  answerDebts,
  answerHasChildren,
  answerNoChildren,
  isAnswered,
  isFinishedIntake,
  isSelfEmployed,
  markDone,
  markRound2Done,
  pendingNewQuestions,
  resumeScreen,
  round2Pending,
  ROUND2,
  screensFor,
  sectionOf,
  WIZARD_DEBT,
  WIZARD_GOAL,
  type ScreenId,
} from "../intake/wizard/screens.js";
import { upsertBalance } from "./Punten.js";
import {
  AmountScreen,
  BirthYearScreen,
  CardsScreen,
  ChildYearsScreen,
  ChoiceScreen,
  DebtScreen,
  GoalScreen,
  HousingScreen,
  MultiScreen,
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
  /** 2 runs only the coaching questions (no summary) and leaves round 1's
   *  bookkeeping alone. Defaults to 1. */
  round?: 1 | 2;
  now?: () => string;
  /** The manual points balances and how to store them (the Punten tab's store).
   *  Without the saver the points are not asked. */
  rewards?: RewardsBalance[];
  onSaveRewards?: (next: RewardsBalance[]) => Promise<void>;
};

/** A copy record as tile options, in the record's own order. */
const tilesOf = <T extends string>(r: Record<T, string>) =>
  (Object.keys(r) as T[]).map((value) => ({ value, label: r[value] }));

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
  const round2 = props.round === 2;
  const [screen, setScreen] = useState<ScreenId | "done">(() =>
    round2 ? (round2Pending(profile)[0] ?? ROUND2[0] ?? "done") : resumeScreen(profile),
  );
  /** A finished user runs only the questions that are new to them, then the
   *  summary. Fixed when the wizard opens so answered screens stay in the run. */
  const [run] = useState<ScreenId[] | null>(() => {
    if (round2 || !isFinishedIntake(profile)) return null;
    const fresh = pendingNewQuestions(profile);
    return fresh.length === 0 ? null : [...fresh, "summary"];
  });
  const [busy, setBusy] = useState(false);
  /** Set when a summary line sent the user to edit; Verder goes back there. */
  const [returnTo, setReturnTo] = useState<ScreenId | null>(null);
  /** Screens an edit made newly required, still to be visited before returnTo. */
  const [pending, setPending] = useState<ScreenId[]>([]);

  useEffect(() => {
    if (screen === "done") props.onFinish();
    // onFinish is the parent's; fire once when the wizard reaches the end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  if (screen === "done") return <></>;

  const fullList = round2 ? [...ROUND2] : screensFor(profile);
  /** What Back and the counter walk: the whole flow, or a finished user's run. */
  const walk = (all: ScreenId[]) =>
    run === null ? all : run.filter((x) => x === "summary" || all.includes(x));
  const list = walk(fullList);
  const at = list.indexOf(screen);
  const total = list.length;
  const step = at >= 0 ? at + 1 : total;
  const eur = (n: number) => formatWholeEuroIn(locale, n);
  const together = profile.household?.value.kind === "together";

  /** Save one screen, then move on only when the store took it. */
  async function save(apply: (p: AdvisorProfile) => AdvisorProfile) {
    if (screen === "done" || busy) return;
    const id = screen;
    if (round2) {
      // Answers are saved screen by screen; only the last one marks round 2 done.
      const isLast = id === ROUND2[ROUND2.length - 1];
      setBusy(true);
      const ok = await update((p) => (isLast ? markRound2Done(apply(p)) : apply(p)));
      setBusy(false);
      if (!ok) return;
      setScreen(ROUND2[ROUND2.indexOf(id) + 1] ?? "done");
      return;
    }
    // In a finished user's run, and in edits from the summary, lastScreen stays
    // as stored (the run ends on "upload"), so a later open resumes correctly.
    const keepLast = run !== null || returnTo !== null;
    const change = (p: AdvisorProfile) => {
      const marked = markDone(apply(p), id);
      if (!keepLast) return marked;
      const { lastScreen: _l, ...intake } = marked.intake;
      const last = run !== null && returnTo === null && id === "summary" ? "upload" : p.intake.lastScreen;
      return new AdvisorProfile({
        ...marked,
        intake: last === undefined ? intake : { ...intake, lastScreen: last },
      });
    };
    const after = screensFor(change(profile));
    const afterWalk = walk(after);
    setBusy(true);
    const ok = await update(change);
    setBusy(false);
    if (!ok) return;
    if (returnTo !== null) {
      const changed = change(profile);
      const fresh = after.filter((x) => !fullList.includes(x) && !isAnswered(changed, x));
      const lost = after.filter(
        (x) => x !== id && isAnswered(profile, x) && !isAnswered(changed, x),
      );
      const queue = [
        ...new Set([...pending.filter((x) => after.includes(x) && !isAnswered(changed, x)), ...fresh, ...lost]),
      ];
      const [head, ...rest] = queue;
      setPending(rest);
      if (head !== undefined) {
        setScreen(head);
        return;
      }
      setScreen(returnTo);
      setReturnTo(null);
      return;
    }
    const next = afterWalk[afterWalk.indexOf(id) + 1];
    setScreen(next ?? "done");
  }

  const back =
    at > 0 || returnTo !== null
      ? () => {
          setSaveFailed(false);
          if (returnTo !== null) {
            setScreen(returnTo);
            setReturnTo(null);
            setPending([]);
          } else setScreen(list[at - 1] as ScreenId);
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
    <ChoiceScreen<T>
      key={screen}
      copy={w}
      busy={busy}
      label={label}
      options={options}
      initial={selected}
      onSubmit={onPick}
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
  } else if (screen === "money-sharing") {
    question = q.moneySharing;
    body = choice(
      question,
      tilesOf(w.moneySharing),
      profile.household?.value.moneySharing ?? null,
      (v) => void save((p) => applyMoneySharing(p, v, asOf)),
    );
  } else if (screen === "birth-year") {
    question = q.birthYear;
    body = (
      <BirthYearScreen
        key={screen}
        copy={w}
        busy={busy}
        label={question}
        initial={profile.birthYear?.value ?? null}
        currentYear={new Date(asOf).getFullYear()}
        onSubmit={(y) => void save((p) => applyBirthYear(p, y, asOf))}
      />
    );
  } else if (screen === "income-regularity") {
    question = q.incomeRegularity;
    body = choice(
      question,
      tilesOf(w.incomeRegularity),
      profile.incomeRegularity?.value ?? (isSelfEmployed(profile) ? "varies" : null),
      (v) => void save((p) => applyIncomeRegularity(p, v, asOf)),
    );
  } else if (screen === "banks") {
    question = q.banks;
    body = (
      <MultiScreen<string>
        key={screen}
        copy={w}
        busy={busy}
        label={question}
        initial={profile.statedBanks?.value ?? []}
        options={[...bankBrandIds(), "other"].map((id) => ({
          value: id,
          label: w.bankNames[id] ?? id,
        }))}
        onSubmit={(ids) => void save((p) => applyStatedBanks(p, ids, asOf))}
      />
    );
  } else if (screen === "card-repayment") {
    question = q.cardRepayment;
    body = choice(
      question,
      tilesOf(w.cardRepayment),
      profile.cardRepayment?.value ?? null,
      (v) => void save((p) => applyCardRepayment(p, v, asOf)),
    );
  } else if (screen === "spend-mix") {
    question = q.spendMix;
    body = (
      <MultiScreen
        key={screen}
        copy={w}
        busy={busy}
        label={question}
        initial={profile.spendMix?.value ?? []}
        options={tilesOf(w.spendAreas)}
        max={3}
        hint={w.spendMixHint}
        onSubmit={(v) => void save((p) => applySpendMix(p, v, asOf))}
      />
    );
  } else if (screen === "foreign-spend") {
    question = q.foreignSpend;
    body = choice(
      question,
      tilesOf(w.foreignSpend),
      profile.foreignSpend?.value ?? null,
      (v) => void save((p) => applyForeignSpend(p, v, asOf)),
    );
  } else if (screen === "priorities") {
    question = q.priorities;
    body = (
      <MultiScreen
        key={screen}
        copy={w}
        busy={busy}
        label={question}
        initial={profile.priorities?.value ?? []}
        options={tilesOf(w.priorities)}
        onSubmit={(v) => void save((p) => applyPriorities(p, v, asOf))}
      />
    );
  } else if (screen === "cut-targets") {
    question = q.cutTargets;
    body = (
      <MultiScreen
        key={screen}
        copy={w}
        busy={busy}
        label={question}
        initial={profile.cutTargets?.value ?? []}
        options={tilesOf(w.cutTargets)}
        onSubmit={(v) => void save((p) => applyCutTargets(p, v, asOf))}
      />
    );
  } else if (screen === "check-in") {
    question = q.checkInCadence;
    body = choice(
      question,
      tilesOf(w.checkInCadence),
      profile.checkInCadence?.value ?? null,
      (v) => void save((p) => applyCheckInCadence(p, v, asOf)),
    );
  } else if (screen === "confidence") {
    question = q.confidence;
    const stored = profile.confidence?.value;
    body = choice(
      question,
      ([1, 2, 3, 4] as const).map((n) => ({ value: String(n), label: w.confidence[n] })),
      stored === undefined ? null : String(stored),
      (v) => void save((p) => applyConfidence(p, Number(v) as 1 | 2 | 3 | 4, asOf)),
    );
  } else if (screen === "programs") {
    question = q.programs;
    body = (
      <MultiScreen<string>
        key={screen}
        copy={w}
        busy={busy}
        label={question}
        initial={profile.statedPrograms?.value ?? []}
        options={REWARD_PROGRAMS.map((r) => ({ value: r.name, label: r.name }))}
        allowEmpty
        onSubmit={(v) => void save((p) => applyStatedPrograms(p, v, asOf))}
      />
    );
  } else if (screen === "points-goal") {
    question = q.pointsGoal;
    body = choice(
      question,
      tilesOf(w.pointsGoal),
      profile.pointsGoal?.value ?? null,
      (v) => void save((p) => applyPointsGoal(p, v, asOf)),
    );
  } else if (screen === "flights") {
    question = q.flights;
    body = choice(
      question,
      tilesOf(w.flights),
      profile.flightsPerYear?.value ?? null,
      (v) => void save((p) => applyFlightsPerYear(p, v, asOf)),
    );
  } else if (screen === "summary") {
    question = q.summary;
    body = (
      <SummaryScreen
        copy={w}
        busy={busy}
        rows={summaryRows(profile, fullList, { c: ic.aboutYou, locale, asOf })}
        onEdit={(s) => {
          setReturnTo("summary");
          setScreen(s);
        }}
        onSubmit={() => void save((p) => p)}
      />
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
        key={screen}
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
        initialCents={h?.monthlyCents ?? null}
        onSubmit={(c) =>
          void save((p) => applyStatedHousing(p, h?.kind ?? "other", c, asOf))
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
        key={screen}
        copy={w}
        busy={busy}
        kind="debit"
        label={question}
        initial={profile.statedDebitCards?.value ?? []}
        onSubmit={(ids) => void save((p) => applyStatedDebitCards(p, ids, asOf))}
      />
    );
  } else if (screen === "cards") {
    question = q.cards(together);
    body = (
      <CardsScreen
        key={screen}
        copy={w}
        busy={busy}
        label={question}
        initial={profile.statedCards?.value ?? []}
        noneLabel={w.noneCard}
        initialNone={profile.intake.noCards === true}
        onNone={() => void save((p) => answerCards(p, false, asOf))}
        onSubmit={(ids) =>
          void save((p) => applyStatedCards(answerCards(p, true, asOf), ids, asOf))
        }
      />
    );
  } else if (screen === "card-balances") {
    question = q.cardDetails(together);
    const rewards = props.rewards ?? [];
    body = (
      <CardDetailsForm
        key="card-balances"
        copy={w}
        busy={busy}
        submitLabel={w.next}
        rows={detailRows({
          cardIds: profile.statedCards?.value ?? [],
          balances: profile.cardBalances?.value ?? [],
          rewards,
          nameOf: (id) => cardName(id, w.otherCard, w.cardDetails.unknownCard),
          askPoints: props.onSaveRewards !== undefined,
          repayment: profile.cardRepayment?.value ?? null,
        })}
        onSkip={() => void save((p) => p)}
        onSubmit={(result) => {
          void (async () => {
            try {
              if (props.onSaveRewards !== undefined) {
                const next = applyPoints(rewards, result.points, asOf, upsertBalance);
                if (next !== null) await props.onSaveRewards(next);
              }
            } catch {
              setSaveFailed(true);
              return;
            }
            await save((p) => applyCardBalances(p, result.balances, asOf));
          })();
        }}
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
      m !== undefined ? String(m) : profile.incomeRegularity?.value === "varies" ? "6" : null,
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
      counter={at >= 0 ? w.counter(step, total) : ""}
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
