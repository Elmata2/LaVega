import { useMemo, useState, type FormEvent } from "react";
import { accountType, type CardCriteriaRow, type CardsFigures, type CriteriaValue } from "@lavega/core";
import Button from "../../components/ui/Button.js";
import CardLink from "../../components/ui/CardLink.js";
import { Table, TableWrap, Td, Th } from "../../components/ui/Table.js";
import { cardsCopy, factLine } from "../../copy/plan/index.js";
import { cardLabel } from "../../intake/wizard/cardOptions.js";
import SectionCard from "../SectionCard.js";
import {
  CalcList,
  Group,
  Lines,
  Sources,
  StatusBody,
  ValueInput,
  useSectionCopy,
} from "./common.js";
import { parseDate, parseEuros, parseWholeNumber, type ParseError } from "./parse.js";
import { dropKey } from "./profileEdits.js";
import type { SectionProps } from "./types.js";

const COLUMNS = [
  "name",
  "annualFee",
  "cashback",
  "fxFee",
  "pointsPerEuro",
  "pointsExpiry",
  "transferRatio",
  "insurance",
] as const;
type Column = (typeof COLUMNS)[number];

/** A sortable value for a column: a number, a string, or null (always last). */
function sortValue(r: CardCriteriaRow, c: Column): number | string | null {
  switch (c) {
    case "name":
      return r.name;
    case "annualFee":
      return r.annualFee.cents;
    case "cashback":
      return r.cashbackPct.value;
    case "fxFee":
      return r.fxFeePct.value;
    case "pointsPerEuro":
      return r.pointsPerEuro.value;
    case "pointsExpiry":
      return r.pointsExpiry;
    case "transferRatio":
      return null;
    case "insurance":
      return null;
  }
}

function compare(a: CardCriteriaRow, b: CardCriteriaRow, c: Column, dir: 1 | -1, locale: string) {
  const x = sortValue(a, c);
  const y = sortValue(b, c);
  if (x === null && y === null) return a.name.localeCompare(b.name, locale);
  if (x === null) return 1;
  if (y === null) return -1;
  const d =
    typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y), locale);
  return d === 0 ? a.name.localeCompare(b.name, locale) : d * dir;
}

type Entry = { program: string; points: string; cash: string };

/** Section 6: card features from the catalogue in a table the person sorts.
 *  The default order is the name; no row is ranked, marked or pre-selected. */
export default function CardsSection({ result, ctx }: SectionProps<CardsFigures>) {
  const { locale, fmt, a } = useSectionCopy();
  const copy = cardsCopy[locale];
  const f = result.figures;
  const prefs = ctx.plan.preferences;
  const [sort, setSort] = useState<{ column: Column; dir: 1 | -1 }>({ column: "name", dir: 1 });
  const rows = useMemo(
    () => [...f.criteria].sort((x, y) => compare(x, y, sort.column, sort.dir, locale)),
    [f.criteria, sort, locale],
  );
  const nets = [...f.nets].sort((x, y) => x.name.localeCompare(y.name, locale));
  const programs = [
    ...new Set([
      ...f.balances.map((b) => b.programId),
      ...f.nets.flatMap((n) => (n.programId === null ? [] : [n.programId])),
    ]),
  ].sort();
  const header = (c: Column): string => (c === "name" ? copy.labels.card : copy.labels[c]);
  const click = (c: Column) =>
    setSort((s) =>
      s.column === c ? { column: c, dir: s.dir === 1 ? -1 : 1 } : { column: c, dir: 1 },
    );

  /** A catalogue figure in its own unit: percentages for cashback and the
   *  foreign-currency markup, a plain number for points per euro. */
  const crit = (v: CriteriaValue, show: (n: number) => string) =>
    v.value === null || v.tier === "unknown" ? (
      copy.unknownValue
    ) : (
      <>
        {show(v.value)}
        <span className="block text-muted text-[0.75rem]">
          {v.tier === "assumed"
            ? copy.tier.assumed
            : v.asOf === null
              ? ""
              : a.cards.asOf(fmt.date(v.asOf))}
        </span>
      </>
    );
  const cell = (r: CardCriteriaRow, c: Column) => {
    switch (c) {
      case "name":
        return null;
      case "annualFee":
        return r.annualFee.known && r.annualFee.cents !== null ? (
          <>
            {fmt.eurExact(r.annualFee.cents)}
            {r.annualFee.asOf !== null && (
              <span className="block text-muted text-[0.75rem]">
                {a.cards.asOf(fmt.date(r.annualFee.asOf))}
              </span>
            )}
          </>
        ) : (
          copy.unknownValue
        );
      case "cashback":
        return crit(r.cashbackPct, fmt.points);
      case "fxFee":
        return crit(r.fxFeePct, fmt.points);
      case "pointsPerEuro":
        return crit(r.pointsPerEuro, fmt.plain);
      case "pointsExpiry":
        return r.pointsExpiry === null ? copy.unknownValue : fmt.date(r.pointsExpiry);
      case "transferRatio":
      case "insurance":
        return copy.unknownValue;
    }
  };

  const stated = ctx.profile.store?.current.statedCards?.value ?? [];
  // The bank data is the source when it holds a credit card; otherwise the
  // stated cards are shown. A current account is not a credit card.
  const hasCreditcard = ctx.accounts.some((acc) => accountType(acc) === "Creditcard");
  const showStated = stated.length > 0 && !hasCreditcard;

  const terms = factLine("card-nl-terms", copy.facts.cardTerms, ctx.publicFacts);

  return (
    <SectionCard section="cards" result={result}>
      {{
        figures: (
          <div>
            {showStated ? (
              <div data-testid="plan-cards-stated" className="mb-2">
                <p className="m-0 text-muted text-[0.85rem]">{copy.statedCardsLead}</p>
                <ul className="m-0 list-none p-0 text-[0.9rem]">
                  {stated.map((id) => (
                    <li key={id}>{cardLabel(id, copy.otherCard)}</li>
                  ))}
                </ul>
                <p className="m-0 mt-1 text-muted text-[0.85rem]">{copy.statedCardsNote}</p>
              </div>
            ) : null}
            <StatusBody
              section="cards"
              result={result}
              ctx={ctx}
              skipReasons={showStated ? ["in-use-card-unknown", "no-card-data"] : []}
              skipMissing={showStated ? ["cards"] : []}
            />
            {rows.length > 0 ? (
              <>
                <p className="m-0 mb-1 text-muted text-[0.85rem]">{copy.sortNote}</p>
                <TableWrap>
                  <Table data-testid="plan-cards-table" aria-label={a.cards.tableLabel}>
                    <thead>
                      <tr>
                        {COLUMNS.map((c) => (
                          <Th
                            key={c}
                            scope="col"
                            aria-sort={
                              sort.column === c
                                ? sort.dir === 1
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            <CardLink
                              data-testid={`plan-cards-sort-${c}`}
                              aria-label={a.cards.sortBy(header(c))}
                              onClick={() => click(c)}
                              className="whitespace-normal text-left"
                            >
                              {header(c)}
                            </CardLink>
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.cardKey} data-testid="plan-cards-row">
                          <Th scope="row">
                            {r.name}
                            {r.held ? ` (${a.cards.held})` : ""}
                          </Th>
                          {COLUMNS.slice(1).map((c) => (
                            <Td key={c}>{cell(r, c)}</Td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </>
            ) : showStated ? null : (
              <p className="m-0 text-muted">{a.cards.noCards}</p>
            )}
            <Lines
              lines={[
                f.cardableSpendCents > 0 ? copy.feeShareNote(f.months) : null,
                ...nets.flatMap((n) => [copy.netLine(n, fmt), copy.pointsLine(n.name, n, fmt)]),
                ...f.breakEven.map((b) =>
                  copy.breakEvenLine(
                    f.nets.find((n) => n.cardKey === b.cardKey)?.name ?? b.cardKey,
                    b.annualSpendCents,
                    fmt,
                  ),
                ),
                ...f.balances.map(
                  (b) =>
                    `${a.cards.program(b.programId)}: ${copy.balanceLine(b.points, b.expiresOn, b.stale, fmt)}`,
                ),
                f.balances.length > 0 ? copy.noMarketValue : null,
              ]}
            />
          </div>
        ),
        assumptions:
          programs.length === 0 ? null : (
            <Group title={a.groups.yourFigures}>
              <Redemption programs={programs} ctx={ctx} />
              {f.balances.map((b) => (
                <ValueInput
                  key={b.programId}
                  name={`expiry-${b.programId}`}
                  label={a.cards.expiry.label(a.cards.program(b.programId))}
                  hint={a.cards.expiry.hint}
                  stored={prefs.pointsExpiry[b.programId] ?? ""}
                  parse={parseDate}
                  onSave={(date) =>
                    ctx.plan.setPreference((cur) => ({
                      pointsExpiry: { ...cur.pointsExpiry, [b.programId]: date },
                    }))
                  }
                  onClear={() =>
                    ctx.plan.setPreference((cur) => ({
                      pointsExpiry: dropKey(cur.pointsExpiry, b.programId),
                    }))
                  }
                />
              ))}
            </Group>
          ),
        howCalculated: <CalcList section="cards" result={result} />,
        sources: <Sources lines={[terms]} />,
      }}
    </SectionCard>
  );
}

const unique = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

/** The person's own redemption examples: a program, points spent, and the
 *  price they did not pay. Nothing is suggested and nothing is pre-filled. */
function Redemption({
  programs,
  ctx,
}: {
  programs: string[];
  ctx: SectionProps<CardsFigures>["ctx"];
}) {
  const { fmt, a } = useSectionCopy();
  const examples = ctx.plan.preferences.redemptionExamples;
  const [entry, setEntry] = useState<Entry>({ program: "", points: "", cash: "" });
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const points = parseWholeNumber(entry.points, { min: 1, max: 100_000_000 });
    const cash = parseEuros(entry.cash);
    const bad: ParseError | null =
      entry.program === "" ? "required" : !points.ok ? points.error : !cash.ok ? cash.error : null;
    if (bad !== null || !points.ok || !cash.ok) {
      setError(a.errors[bad ?? "required"]);
      return;
    }
    try {
      await ctx.plan.setPreference((cur) => ({
        redemptionExamples: [
          ...cur.redemptionExamples,
          {
            id: `redeem-${unique()}`,
            programId: entry.program,
            pointsSpent: points.value,
            cashPriceSavedCents: cash.value,
            at: ctx.asOf,
          },
        ],
      }));
      setEntry({ program: "", points: "", cash: "" });
      setError(null);
    } catch {
      setError(a.saveFailed);
    }
  }
  const remove = (id: string) =>
    ctx.plan
      .setPreference((cur) => ({
        redemptionExamples: cur.redemptionExamples.filter((x) => x.id !== id),
      }))
      .catch(() => setError(a.saveFailed));

  return (
    <div className="mb-3" data-testid="plan-redemption">
      <h5 className="m-0 mb-1 text-[0.85rem] font-semibold">{a.cards.redemption.title}</h5>
      <p className="m-0 mb-2 text-muted text-[0.85rem]">{a.cards.redemption.hint}</p>
      {examples.length === 0 ? (
        <p className="m-0 mb-2 text-[0.9rem]">{a.cards.redemption.none}</p>
      ) : (
        <ul className="m-0 mb-2 grid list-none gap-1 p-0 text-[0.9rem]">
          {examples.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2">
              <span>
                {a.cards.redemption.entry(
                  a.cards.program(x.programId),
                  fmt.count(x.pointsSpent),
                  fmt.eurExact(x.cashPriceSavedCents),
                )}
              </span>
              <CardLink variant="danger" onClick={() => void remove(x.id)}>
                {a.remove}
              </CardLink>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)} noValidate className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-muted">
          {a.cards.redemption.program}
          <select
            value={entry.program}
            data-testid="plan-input-redeem-program"
            onChange={(e) => setEntry({ ...entry, program: e.target.value })}
          >
            <option value="" />
            {programs.map((p) => (
              <option key={p} value={p}>
                {a.cards.program(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-muted">
          {a.cards.redemption.points}
          <input
            type="text"
            inputMode="numeric"
            value={entry.points}
            data-testid="plan-input-redeem-points"
            onChange={(e) => setEntry({ ...entry, points: e.target.value })}
            className="max-w-[9rem]"
          />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          {a.cards.redemption.cash}
          <input
            type="text"
            inputMode="decimal"
            value={entry.cash}
            data-testid="plan-input-redeem-cash"
            onChange={(e) => setEntry({ ...entry, cash: e.target.value })}
            className="max-w-[9rem]"
          />
        </label>
        <Button type="submit" data-testid="plan-save-redeem">
          {a.add}
        </Button>
      </form>
      <p
        role={error === null ? undefined : "alert"}
        data-testid="plan-error-redeem"
        className="m-0 text-warn text-[0.85rem]"
      >
        {error}
      </p>
    </div>
  );
}
