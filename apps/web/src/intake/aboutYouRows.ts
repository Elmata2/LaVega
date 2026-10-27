import {
  AdvisorProfile,
  fingerprint,
  removeDerived,
  type Debt,
  type FieldSource,
  type Goal,
} from "@lavega/core";
import type { AboutYouCopy, ProfileSection } from "../copy/intake.js";
import { formatDate, formatEuroIn } from "../format.js";
import type { Locale } from "../locale.js";
import { cardLabel } from "./wizard/cardOptions.js";
import { WORK_ORDER, answerCards, reopenRisk } from "./wizard/screens.js";
import { applyChargesVat, applyStatedCards, applyStatedDebitCards, applyWork } from "./state.js";

type Fact<T> = {
  value: T;
  source: FieldSource;
  at: string;
  evidence?: readonly string[] | undefined;
};

/** What the user may type to change a row. Every edit turns the fact into a
 *  stated one dated today, whatever it was before. */
export type Editor =
  | {
      kind: "euros";
      initial: number;
      apply: (p: AdvisorProfile, cents: number) => AdvisorProfile;
    }
  | {
      kind: "months";
      initial: number;
      apply: (p: AdvisorProfile, months: number) => AdvisorProfile;
    }
  | {
      kind: "years";
      initial: readonly number[];
      apply: (p: AdvisorProfile, years: number[]) => AdvisorProfile;
    }
  | {
      kind: "text";
      initial: string;
      apply: (p: AdvisorProfile, text: string) => AdvisorProfile;
    }
  | {
      kind: "range";
      initial: { lowCents: number; highCents: number };
      apply: (p: AdvisorProfile, r: { lowCents: number; highCents: number }) => AdvisorProfile;
    }
  | {
      /** Several of a fixed list: tiles. */
      kind: "multi";
      options: { id: string; label: string }[];
      initial: readonly string[];
      apply: (p: AdvisorProfile, ids: string[]) => AdvisorProfile;
    }
  | {
      /** Several cards from the catalogue: search plus tiles. */
      kind: "cards";
      /** Credit cards unless "debit". */
      cardKind?: "credit" | "debit";
      initial: readonly string[];
      apply: (p: AdvisorProfile, ids: string[]) => AdvisorProfile;
    }
  | {
      kind: "choice";
      options: { id: string; label: string }[];
      initial: string;
      apply: (p: AdvisorProfile, id: string) => AdvisorProfile;
    };

export type Row = {
  key: string;
  section: ProfileSection;
  /** Which item of a list section; empty for a single fact. */
  detail: string;
  value: string;
  source: FieldSource;
  at: string;
  /** Null: this fact is changed where it was answered, not here. */
  editor: Editor | null;
  /** Set on facts that are answered as a block of questions: reopens that block. */
  redo?: (p: AdvisorProfile) => AdvisorProfile;
  remove: (p: AdvisorProfile) => AdvisorProfile;
};

export type RowContext = { c: AboutYouCopy; locale: Locale; asOf: string };

const rebuild = (p: AdvisorProfile, patch: Record<string, unknown>) =>
  new AdvisorProfile({ ...p, ...patch } as never);

const without = (p: AdvisorProfile, key: ProfileSection): AdvisorProfile => {
  const { [key]: _gone, ...rest } = p;
  return new AdvisorProfile(rest as never);
};

/** Remove a fact. A derived one also leaves its evidence fingerprint behind, so
 *  the same data is not proposed again; a confirmed or stated one is simply
 *  deleted, and may be proposed again from the data. */
const dropped = (p: AdvisorProfile, source: FieldSource, evidence?: readonly string[]) =>
  source === "derived" && evidence !== undefined && evidence.length > 0
    ? removeDerived(p, fingerprint(evidence))
    : p;

const stated = <T>(f: Fact<T>, value: T, asOf: string): Fact<T> => ({
  ...f,
  value,
  source: "stated",
  at: asOf,
});

const eur = (ctx: RowContext, cents: number) => formatEuroIn(ctx.locale, cents / 100);
const perMonth = (ctx: RowContext, cents: number) => ctx.c.perMonth(eur(ctx, cents));
const join = (...parts: (string | undefined)[]) => parts.filter((x) => x).join(" · ");

/** A single fact held as `Field<T>`: edit replaces its value, remove deletes it. */
function single<T>(
  ctx: RowContext,
  section: ProfileSection,
  f: Fact<T> | undefined,
  text: (v: T) => string,
  editor: (f: Fact<T>, set: (p: AdvisorProfile, v: T) => AdvisorProfile) => Editor | null,
): Row[] {
  if (f === undefined) return [];
  const set = (p: AdvisorProfile, v: T) => rebuild(p, { [section]: stated(f, v, ctx.asOf) });
  return [
    {
      key: section,
      section,
      detail: "",
      value: text(f.value),
      source: f.source,
      at: f.at,
      editor: editor(f, set),
      remove: (p) => dropped(without(p, section), f.source, f.evidence),
    },
  ];
}

/** One row per item of a list of `Field<T>` (income streams, fixed costs, goals). */
function items<T extends { id: string }>(
  ctx: RowContext,
  section: ProfileSection,
  list: readonly Fact<T>[] | undefined,
  detail: (v: T) => string,
  text: (v: T) => string,
  editor: (f: Fact<T>, set: (p: AdvisorProfile, v: T) => AdvisorProfile) => Editor | null,
): Row[] {
  return (list ?? []).map((f) => {
    const replace = (p: AdvisorProfile, v: T) =>
      rebuild(p, {
        [section]: ((p as unknown as Record<string, readonly Fact<T>[]>)[section] ?? []).map((x) =>
          x.value.id === f.value.id ? stated(x, v, ctx.asOf) : x,
        ),
      });
    return {
      key: `${section}:${f.value.id}`,
      section,
      detail: detail(f.value),
      value: text(f.value),
      source: f.source,
      at: f.at,
      editor: editor(f, replace),
      remove: (p: AdvisorProfile) => {
        const left = ((p as unknown as Record<string, readonly Fact<T>[]>)[section] ?? []).filter(
          (x) => x.value.id !== f.value.id,
        );
        const next = left.length === 0 ? without(p, section) : rebuild(p, { [section]: left });
        return dropped(next, f.source, f.evidence);
      },
    };
  });
}

const eurosEditor =
  <T>(cents: (v: T) => number, withCents: (v: T, c: number) => T) =>
  (f: Fact<T>, set: (p: AdvisorProfile, v: T) => AdvisorProfile): Editor => ({
    kind: "euros",
    initial: cents(f.value),
    apply: (p, c) => set(p, withCents(f.value, c)),
  });

function debtRows(ctx: RowContext, p: AdvisorProfile): Row[] {
  return (p.debts ?? []).map((d: Debt) => ({
    key: `debts:${d.id}`,
    section: "debts" as const,
    detail: d.lender,
    value: join(
      perMonth(ctx, d.monthlyCents),
      d.balanceCents === undefined ? undefined : ctx.c.values.debtBalance(eur(ctx, d.balanceCents)),
    ),
    source: d.source,
    at: d.at,
    editor: {
      kind: "euros" as const,
      initial: d.monthlyCents,
      apply: (q: AdvisorProfile, cents: number) =>
        rebuild(q, {
          debts: (q.debts ?? []).map((x) =>
            x.id === d.id ? { ...x, monthlyCents: cents, source: "stated", at: ctx.asOf } : x,
          ),
        }),
    },
    remove: (q: AdvisorProfile) => {
      const left = (q.debts ?? []).filter((x) => x.id !== d.id);
      const next = left.length === 0 ? without(q, "debts") : rebuild(q, { debts: left });
      return dropped(next, d.source, d.evidence);
    },
  }));
}

/** One builder per profile section. `Record<ProfileSection, …>` makes a new
 *  section without a builder a type error. */
export const FIELD_ROWS: Record<ProfileSection, (p: AdvisorProfile, ctx: RowContext) => Row[]> = {
  household: (p, ctx) =>
    single(
      ctx,
      "household",
      p.household,
      (v) => ctx.c.values.household[v.kind],
      (f, set) => ({
        kind: "choice",
        options: [
          { id: "alone", label: ctx.c.values.household.alone },
          { id: "together", label: ctx.c.values.household.together },
        ],
        initial: f.value.kind,
        apply: (q, id) => {
          const kind = id === "together" ? "together" : "alone";
          const { partnerIncomeInScope: _p, ...rest } = f.value;
          return set(q, kind === "together" ? { ...f.value, kind } : { ...rest, kind });
        },
      }),
    ),
  children: (p, ctx) =>
    single(
      ctx,
      "children",
      p.children,
      (kids) =>
        kids.length === 0
          ? ctx.c.values.noChildren
          : ctx.c.values.childYears(kids.map((k) => k.birthYear).join(", ")),
      (f, set) => ({
        kind: "years",
        initial: f.value.map((k) => k.birthYear),
        apply: (q, years) =>
          set(
            q,
            years.map((y, i) => ({
              id: f.value[i]?.id ?? `child-${y}-${i + 1}`,
              birthYear: y,
            })),
          ),
      }),
    ),
  incomeStreams: (p, ctx) =>
    items(
      ctx,
      "incomeStreams",
      p.incomeStreams,
      (v) => v.label,
      (v) =>
        join(
          perMonth(ctx, v.monthlyCents),
          v.regular ? ctx.c.values.regular : ctx.c.values.irregular,
        ),
      eurosEditor(
        (v) => v.monthlyCents,
        (v, c) => ({ ...v, monthlyCents: c }),
      ),
    ),
  housing: (p, ctx) =>
    single(
      ctx,
      "housing",
      p.housing,
      (v) => join(ctx.c.values.housing[v.kind], perMonth(ctx, v.monthlyCents)),
      eurosEditor(
        (v) => v.monthlyCents,
        (v, c) => ({ ...v, monthlyCents: c }),
      ),
    ),
  fixedCosts: (p, ctx) =>
    items(
      ctx,
      "fixedCosts",
      p.fixedCosts,
      (v) => v.label,
      (v) => perMonth(ctx, v.monthlyCents),
      eurosEditor(
        (v) => v.monthlyCents,
        (v, c) => ({ ...v, monthlyCents: c }),
      ),
    ),
  debts: (p, ctx) => debtRows(ctx, p),
  savings: (p, ctx) =>
    single(
      ctx,
      "savings",
      p.savings,
      (v) => eur(ctx, v.totalCents),
      eurosEditor(
        (v) => v.totalCents,
        (v, c) => ({ ...v, totalCents: c }),
      ),
    ),
  goals: (p, ctx) =>
    items<Goal>(
      ctx,
      "goals",
      p.goals,
      (v) => v.purpose,
      (v) => ctx.c.values.goalBy(eur(ctx, v.targetCents), formatDate(ctx.locale, v.targetDate)),
      eurosEditor(
        (v) => v.targetCents,
        (v, c) => ({ ...v, targetCents: c }),
      ),
    ),
  buffer: (p, ctx) =>
    single(
      ctx,
      "buffer",
      p.buffer,
      (v) => ctx.c.values.months(String(Math.round(v.months * 10) / 10)),
      (f, set) => ({
        kind: "months",
        initial: f.value.months,
        apply: (q, months) => set(q, { months }),
      }),
    ),
  // Risk is answered item by item against a scale; knowledge likewise. They
  // have no free value to type over, so they list and remove but do not edit.
  risk: (p, ctx) =>
    p.risk === undefined
      ? []
      : [
          {
            key: "risk",
            section: "risk",
            detail: "",
            value:
              p.risk.score === undefined
                ? ctx.c.values.toleranceUnknown
                : ctx.c.values.tolerance(p.risk.score),
            source: "stated",
            at: p.risk.at,
            editor: null,
            redo: reopenRisk,
            remove: (q) => reopenRisk(without(q, "risk")),
          },
        ],
  knowledge: (p, ctx) =>
    single(
      ctx,
      "knowledge",
      p.knowledge,
      (v) => ctx.c.values.knowledge(v.correct, v.of),
      () => null,
    ).map((row) => ({ ...row, redo: reopenRisk, remove: (q) => reopenRisk(row.remove(q)) })),
  experience: (p, ctx) =>
    single(
      ctx,
      "experience",
      p.experience,
      (v) => ctx.c.values.experience[v],
      (f, set) => ({
        kind: "choice",
        options: (["beginner", "some", "experienced"] as const).map((id) => ({
          id,
          label: ctx.c.values.experience[id],
        })),
        initial: f.value,
        apply: (q, id) =>
          set(q, id === "experienced" ? "experienced" : id === "some" ? "some" : "beginner"),
      }),
    ),
  worries: (p, ctx) =>
    single(
      ctx,
      "worries",
      p.worries,
      (v) => v,
      (f, set) => ({
        kind: "text",
        initial: f.value,
        apply: (q, text) => set(q, text),
      }),
    ),
  work: (p, ctx) =>
    single(
      ctx,
      "work",
      p.work,
      (v) => v.map((k) => ctx.c.values.workKinds[k]).join(", "),
      (f) => ({
        kind: "multi",
        options: WORK_ORDER.map((k) => ({ id: k, label: ctx.c.values.workKinds[k] })),
        initial: f.value,
        apply: (q, ids) =>
          applyWork(
            q,
            WORK_ORDER.filter((k) => ids.includes(k)),
            ctx.asOf,
          ),
      }),
    ),
  chargesVat: (p, ctx) => {
    const options = [
      { id: "yes", label: ctx.c.values.yes },
      { id: "no", label: ctx.c.values.no },
    ];
    const selfEmployed = (p.work?.value ?? []).some((w) => w === "freelance" || w === "business");
    // Freelance and business work are asked this; someone who finished the
    // intake before it existed can still answer it here.
    if (p.chargesVat === undefined)
      return selfEmployed
        ? [
            {
              key: "chargesVat",
              section: "chargesVat",
              detail: "",
              value: ctx.c.values.notAnswered,
              source: "stated",
              at: ctx.asOf,
              editor: {
                kind: "choice",
                options,
                initial: "",
                apply: (q, id) => applyChargesVat(q, id === "yes", ctx.asOf),
              },
              remove: (q) => q,
            },
          ]
        : [];
    return single(
      ctx,
      "chargesVat",
      p.chargesVat,
      (v) => (v ? ctx.c.values.yes : ctx.c.values.no),
      (f) => ({
        kind: "choice",
        options,
        initial: f.value ? "yes" : "no",
        apply: (q, id) => applyChargesVat(q, id === "yes", ctx.asOf),
      }),
    );
  },
  statedCards: (p, ctx) =>
    single(
      ctx,
      "statedCards",
      p.statedCards,
      (v) =>
        v.length === 0
          ? ctx.c.values.noCards
          : v.map((id) => cardLabel(id, ctx.c.values.otherCard)).join(", "),
      (f) => ({
        kind: "cards",
        initial: f.value,
        // Picking cards after a Nee takes the Nee back.
        apply: (q, ids) => applyStatedCards(answerCards(q, true, ctx.asOf), ids, ctx.asOf),
      }),
    ).map((row) => ({
      ...row,
      // Removing the list also removes a Nee, so the question is asked again.
      remove: (q) => {
        const gone = row.remove(q);
        const { noCards: _n, ...intake } = gone.intake;
        return new AdvisorProfile({ ...gone, intake });
      },
    })),
  statedDebitCards: (p, ctx) =>
    single(
      ctx,
      "statedDebitCards",
      p.statedDebitCards,
      (v) => v.map((id) => cardLabel(id, ctx.c.values.otherDebitCard, "debit")).join(", "),
      (f) => ({
        kind: "cards",
        cardKind: "debit",
        initial: f.value,
        apply: (q, ids) => applyStatedDebitCards(q, ids, ctx.asOf),
      }),
    ),
  statedRanges: (p, ctx) => {
    const f = p.statedRanges;
    if (f === undefined) return [];
    const parts = [
      ["income", ctx.c.values.incomeRange],
      ["spend", ctx.c.values.spendRange],
    ] as const;
    return parts.flatMap(([which, label]) => {
      const r = f.value[which];
      if (r === undefined) return [];
      return [
        {
          key: `statedRanges:${which}`,
          section: "statedRanges" as const,
          detail: label,
          value: ctx.c.values.range(eur(ctx, r.lowCents), eur(ctx, r.highCents)),
          source: f.source,
          at: f.at,
          editor: {
            kind: "range" as const,
            initial: r,
            apply: (q: AdvisorProfile, next: { lowCents: number; highCents: number }) =>
              rebuild(q, {
                statedRanges: stated(q.statedRanges ?? f, { ...f.value, [which]: next }, ctx.asOf),
              }),
          },
          remove: (q: AdvisorProfile) => {
            const cur = q.statedRanges ?? f;
            const { [which]: _gone, ...rest } = cur.value;
            return Object.keys(rest).length === 0
              ? without(q, "statedRanges")
              : rebuild(q, { statedRanges: { ...cur, value: rest } });
          },
        },
      ];
    });
  },
};

export const profileRows = (p: AdvisorProfile, ctx: RowContext): Row[] =>
  (Object.keys(FIELD_ROWS) as ProfileSection[]).flatMap((s) => FIELD_ROWS[s](p, ctx));
