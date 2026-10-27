import type { AdvisorProfileStore, MonthFigures, SectionResult, WorkKind } from "@lavega/core";
import type { View } from "../App";
import { useAppLocale } from "../appLocale.js";
import Card from "../components/ui/Card.js";
import CardLink from "../components/ui/CardLink.js";
import { fromAnswersCopy, planFmt, type PlanFmt } from "../copy/plan/index.js";
import { intakeCopy } from "../copy/intake.js";
import { wizardCopy } from "../copy/wizard.js";
import { SPEND_BANDS } from "../intake/wizard/screenViews.js";

type Range = { lowCents: number; highCents: number };

/** The month the middle figure comes from. With three months it is the one
 *  whose net and income are the middle; with two it is their mean, so both
 *  months are named. */
function measuredSource(
  room: Extract<MonthFigures["room"], { kind: "computed" }>,
  fmt: PlanFmt,
  copy: (typeof fromAnswersCopy)["nl"],
): string {
  const hit = room.months.find(
    (m) => m.netCents === room.middleCents && m.incomingCents === room.middleIncomeCents,
  );
  if (room.months.length === 1) return copy.measuredOne(fmt.monthLabel(room.months[0]!.month));
  if (hit !== undefined && room.months.length === 3)
    return copy.measuredIn(fmt.monthLabel(hit.month));
  return copy.measuredMean(room.months.map((m) => fmt.monthLabel(m.month)).join(", "));
}

/** A stated spend equal to a wizard band reads as that band's own label. */
const rangeText = (r: Range, fmt: PlanFmt, bandLabels: readonly string[] | null): string => {
  const band = SPEND_BANDS.findIndex(
    (b) => b.lowCents === r.lowCents && b.highCents === r.highCents,
  );
  if (bandLabels !== null && band >= 0) return bandLabels[band] ?? "";
  return r.lowCents === r.highCents
    ? fmt.eur(r.lowCents)
    : `${fmt.eur(r.lowCents)} – ${fmt.eur(r.highCents)}`;
};

/** What the person said in the intake, set beside what their accounts show.
 *  The two are only placed next to each other with their own labels: nothing
 *  here says whether they agree, because the stated figure may cover a
 *  household while the imported accounts cover one person. The measured
 *  values are the Je maand section's own figures, not recomputed. */
export default function FromAnswers({
  store,
  hasAccounts,
  month,
  onNavigate,
}: {
  store: AdvisorProfileStore | null;
  /** Personal accounts exist: tells "no accounts yet" from "too little history". */
  hasAccounts: boolean;
  month: SectionResult<MonthFigures>;
  onNavigate: (view: View) => void;
}) {
  const [locale] = useAppLocale();
  const copy = fromAnswersCopy[locale];
  const fmt = planFmt(locale);
  const p = store?.current;
  const household = p?.household?.value;
  const children = p?.children?.value;
  const work = p?.work?.value ?? [];
  const stated = p?.statedRanges?.value;
  if (
    p === undefined ||
    (household === undefined && children === undefined && work.length === 0 && stated === undefined)
  ) {
    return null;
  }
  const workLabels = intakeCopy[locale].aboutYou.values.workKinds;
  const room = month.figures.room;
  const measured = room.kind === "computed" ? room : null;
  const incomeMiddle = month.figures.incomeMiddleCents;
  const statedLabel = household?.kind === "together" ? copy.statedTogether : copy.statedAlone;
  const rows: {
    key: "income" | "spend";
    stated: Range | undefined;
    measured: number | null;
  }[] = [
    {
      key: "income",
      stated: stated?.income,
      measured: measured === null ? null : measured.middleIncomeCents,
    },
    {
      key: "spend",
      stated: stated?.spend,
      measured:
        measured === null || incomeMiddle === null ? null : incomeMiddle - measured.middleCents,
    },
  ];
  const years = (children ?? []).map((c) => c.birthYear).join(", ");
  return (
    <Card as="section" aria-label={copy.title} data-testid="plan-from-answers">
      <h3 className="m-0 mb-2">{copy.title}</h3>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.95rem]">
        {household !== undefined && (
          <span data-testid="plan-from-answers-household">{copy.household[household.kind]}</span>
        )}
        {children !== undefined && (
          <span data-testid="plan-from-answers-children">
            {children.length === 0 ? copy.noChildren : copy.children(children.length, years)}
          </span>
        )}
        {work.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label={copy.workLabel}>
            {work.map((w: WorkKind) => (
              <li
                key={w}
                data-testid="plan-from-answers-work"
                className="rounded-full border border-border px-2 text-[0.85rem]"
              >
                {workLabels[w]}
              </li>
            ))}
          </ul>
        )}
      </div>
      {rows.map((r) => (
        <div key={r.key} className="mb-2 text-[0.95rem]" data-testid={`plan-from-answers-${r.key}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="m-0 text-[0.95rem] font-semibold">{copy.rows[r.key]}</h4>
            <CardLink
              data-testid={`plan-from-answers-change-${r.key}`}
              onClick={() => onNavigate("about-you")}
            >
              {copy.change}
            </CardLink>
          </div>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt className="text-muted">{statedLabel}</dt>
            <dd className="m-0 text-right" data-testid={`plan-from-answers-${r.key}-stated`}>
              {r.stated === undefined
                ? copy.notStated
                : rangeText(
                    r.stated,
                    fmt,
                    r.key === "spend" ? wizardCopy[locale].spendBands : null,
                  )}
            </dd>
            <dt className="text-muted">{copy.measured[r.key]}</dt>
            <dd className="m-0 text-right" data-testid={`plan-from-answers-${r.key}-measured`}>
              {measured === null || r.measured === null ? (
                hasAccounts ? (
                  copy.shortHistory
                ) : (
                  <>
                    {copy.noBankData}{" "}
                    <CardLink
                      data-testid="plan-from-answers-import"
                      onClick={() => onNavigate("profiel")}
                    >
                      {copy.importLink}
                    </CardLink>
                  </>
                )
              ) : (
                <>
                  {fmt.eur(r.measured)}
                  <span className="block text-muted text-[0.75rem]">
                    {measuredSource(measured, fmt, copy)}
                  </span>
                </>
              )}
            </dd>
          </dl>
        </div>
      ))}
      {household?.kind === "together" && measured !== null && (
        <p data-testid="plan-from-answers-partial" className="m-0 text-muted text-[0.85rem]">
          {copy.togetherPartial}
        </p>
      )}
    </Card>
  );
}

/** One paragraph about how the person's kind of work changes a reading of
 *  the figures next to it. Null when their work kinds do not call for it. */
export function workNoteFor(
  store: AdvisorProfileStore | null,
  section: "month" | "buffer",
  locale: "nl" | "en",
): string | null {
  const work = store?.current.work?.value ?? [];
  const kinds: readonly WorkKind[] =
    section === "month" ? ["freelance", "business"] : ["freelance", "business", "jobseeking"];
  return work.some((w) => kinds.includes(w)) ? fromAnswersCopy[locale].notes[section] : null;
}
