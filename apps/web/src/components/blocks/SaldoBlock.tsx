import { useMemo } from "react";
import type { Account, ConversionMode, ScheduledFlow, Tx } from "@lavega/core";
import { availableBalanceCents, isEurCurrency, reservedCents, toEur } from "@lavega/core";
import type { View } from "../../App";
import { formatEuroIn } from "../../format.js";
import Module from "../Module.js";
import TrendChart from "../TrendChart.js";
import DeltaPill from "./DeltaPill.js";
import { daysBetween, shiftDate } from "./dates.js";
import type { Locale } from "../../locale.js";
import { useAppLocale } from "../../appLocale.js";
import { moneyCopy, dayLabelIn } from "../../copy/money.js";

/* Totale positie — the most important number on the homescreen, and now the
 * line behind it.
 *
 * The number is the sum of the balances LaVega actually knows. The graph is
 * that number walked BACKWARDS through the transactions of those same
 * accounts: the closing position on day d is today's position minus everything
 * that landed after d. That makes the line exact for every day the transaction
 * history covers — and undefined before it.
 *
 * The undefined part is the whole reason this block is careful. Walking back
 * past the oldest transaction we hold would draw a perfectly flat line, and a
 * flat line reads as "your position did not move", which is a claim about
 * money we cannot make. So the series STOPS at the oldest transaction, the
 * week/month comparisons are null rather than 0% when the history is shorter
 * than the period they name, and the card says so in words.
 *
 * Accounts without a saldo are excluded from BOTH the number and the walk, so
 * the two can never disagree; the card names how many were left out. */

/** How far back the graph draws, at most. A month is the longest comparison
 *  the card makes, so there is nothing to gain from a longer line. */
export const POSITION_WINDOW_DAYS = 30;

/** Below this much transaction history there is no line worth drawing — two or
 *  three days of movement is a squiggle, not a trend. */
export const MIN_HISTORY_DAYS = 7;

export type PositionPoint = { date: string; value: number };

export type PositionSeries = {
  /** Daily closing positions, oldest first. Empty when there is no history. */
  points: PositionPoint[];
  /** The position now, in euros: the sum of the KNOWN balances. */
  current: number;
  /** The position exactly 7 / 30 days ago, or null when the transaction
   *  history does not reach that far back. Never 0 as a stand-in. */
  weekAgo: number | null;
  monthAgo: number | null;
  /** How far back EVERY contributing account has history — not the union.
   *  Rolling the position back past the shortest-covered account treats a
   *  newly imported balance as if it had been constant all along, which is how
   *  a comparison invents a change nobody made. */
  coverageDays: number;
  /** Accounts whose history is what limits `coverageDays`, so the card can say
   *  which import would unlock the comparison instead of just refusing it. */
  limitedBy: string[];
  /** Accounts left out because their saldo is unknown, OR because it is in a
   *  currency other than EUR (see `isEurCurrency`) — a balance LaVega cannot
   *  fold into this total honestly, so it stays out instead of being added at
   *  face value. */
  excluded: number;
  /** Of `excluded`, the ones WITH a known balance that is simply not in EUR —
   *  named separately so the card can say "vreemde valuta" instead of the
   *  misleading "zonder saldo" it would otherwise print for them. */
  excludedCurrencyKeys: string[];
};

/** The total position over time, derived from the transactions alone. Pure, so
 *  the numbers under the graph are testable without a DOM. */
export function positionSeries(
  accounts: Account[],
  txs: Tx[],
  asOf: string,
  windowDays: number = POSITION_WINDOW_DAYS,
  conversion: { fxHistory: Record<string, Record<string, number>>; mode: ConversionMode },
): PositionSeries {
  const eurBalanceOf = (a: Account): number | null => {
    if (a.balance === null) return null;
    if (isEurCurrency(a.currency)) return a.balance;
    return conversion.mode === "convert"
      ? toEur(a.balance, a.currency, asOf, conversion.fxHistory)
      : null;
  };
  const known = accounts.filter((a) => eurBalanceOf(a) !== null);
  const keys = new Set(known.map((a) => a.key));
  // Integer cents throughout the walk: a 30-step float subtraction over a
  // six-figure position drifts into visible cents.
  const currentCents = known.reduce((s, a) => s + Math.round((eurBalanceOf(a) as number) * 100), 0);
  const excluded = accounts.length - known.length;
  // An account that DID convert is no longer "excluded" — the kept-out line
  // is only for a balance that stayed unresolved into EUR.
  const excludedCurrencyKeys = accounts
    .filter((a) => a.balance !== null && !isEurCurrency(a.currency) && eurBalanceOf(a) === null)
    .map((a) => a.key);
  const base = { current: currentCents / 100, excluded, excludedCurrencyKeys };

  const relevant = txs.filter((t) => keys.has(t.accountKey) && t.date <= asOf);
  if (relevant.length === 0) {
    return {
      ...base,
      points: [],
      weekAgo: null,
      monthAgo: null,
      coverageDays: 0,
      limitedBy: known.map((a) => a.key),
    };
  }

  // Coverage is the SHORTEST-covered account, never the union. If ABN reaches
  // back a year and a card was imported yesterday, the position is only known
  // as far back as yesterday: before that, that card's balance is assumed
  // rather than derived. An account with a balance and no transactions at all
  // limits coverage to nothing, because "no movements" and "not imported" are
  // indistinguishable from here — and guessing between them is exactly the
  // mistake the month comparison was just fixed for.
  const startByKey = new Map<string, string>();
  for (const t of relevant) {
    const prev = startByKey.get(t.accountKey);
    if (prev === undefined || t.date < prev) startByKey.set(t.accountKey, t.date);
  }
  const noHistory = known.filter((a) => !startByKey.has(a.key));
  const latestStart = [...startByKey.values()].reduce((a, b) => (a > b ? a : b));
  const earliest = relevant.reduce((a, t) => (t.date < a ? t.date : a), relevant[0].date);
  const coverageDays = noHistory.length > 0 ? 0 : Math.max(0, daysBetween(latestStart, asOf));
  const limitedBy =
    noHistory.length > 0
      ? noHistory.map((a) => a.key)
      : known.filter((a) => startByKey.get(a.key) === latestStart).map((a) => a.key);

  const net = new Map<string, number>();
  for (const t of relevant) {
    const eurAmount = isEurCurrency(t.currency)
      ? t.amount
      : conversion.mode === "convert"
        ? (toEur(t.amount, t.currency, t.date, conversion.fxHistory) ?? 0)
        : 0;
    // A missing single-day rate falls back to 0 rather than breaking the
    // walk: it only smears the SHAPE of the historical line for that one
    // day, not the current total (which comes from eurBalanceOf, not this
    // loop), and rateOn's own 10-day walk-back makes an actual gap rare.
    net.set(t.date, (net.get(t.date) ?? 0) + Math.round(eurAmount * 100));
  }

  // Never earlier than the oldest transaction: before it the position is not
  // known, it is merely unrecorded.
  const start =
    coverageDays >= windowDays
      ? shiftDate(asOf, -windowDays)
      : coverageDays > 0
        ? latestStart
        : earliest;
  const back: PositionPoint[] = [{ date: asOf, value: currentCents / 100 }];
  let cents = currentCents;
  for (let d = shiftDate(asOf, -1); d >= start; d = shiftDate(d, -1)) {
    // Closing on d = closing on d+1 minus what moved on d+1.
    cents -= net.get(shiftDate(d, 1)) ?? 0;
    back.push({ date: d, value: cents / 100 });
  }
  const points = back.reverse();

  const at = (date: string): number | null => points.find((p) => p.date === date)?.value ?? null;
  return {
    ...base,
    points,
    coverageDays,
    limitedBy,
    weekAgo: coverageDays >= 7 ? at(shiftDate(asOf, -7)) : null,
    monthAgo: coverageDays >= 30 ? at(shiftDate(asOf, -30)) : null,
  };
}

/** Change from `then` to `now` in percent. Null when there is no earlier
 *  figure, or when it was exactly zero — a percentage off zero is not a
 *  number, and "∞%" is not an insight. */
export function changePct(now: number, then: number | null): number | null {
  if (then === null || then === 0) return null;
  return ((now - then) / Math.abs(then)) * 100;
}

/** One "vs. vorige week" cell: the earlier figure and the move since, or the
 *  reason there is nothing to compare with. */
function Comparison({
  locale,
  label,
  now,
  then,
  missing,
}: {
  locale: Locale;
  label: string;
  now: number;
  then: number | null;
  missing: string;
}) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      {then === null ? (
        <div className="mt-[2px] text-muted text-[0.9rem]">{missing}</div>
      ) : (
        <div className="flex items-baseline gap-2 flex-wrap mt-[2px]">
          <span className="font-semibold text-[1.05rem] tabular-nums">
            {formatEuroIn(locale, then)}
          </span>
          <DeltaPill pct={changePct(now, then)} upIsGood={true} />
        </div>
      )}
    </div>
  );
}

type SaldoBlockProps = {
  /** Widened to 3 when the Positie widget is off, so that row has no hole. The
   *  caller decides, because only Overzicht knows what else is on the page. */
  span?: 1 | 2 | 3;
  accounts: Account[];
  txs: Tx[];
  scheduledFlows: ScheduledFlow[];
  asOf: string;
  onNavigate: (view: View) => void;
  fxHistory: Record<string, Record<string, number>>;
  mode: ConversionMode;
};

export default function SaldoBlock({
  accounts,
  txs,
  scheduledFlows,
  asOf,
  onNavigate,
  span = 2,
  fxHistory,
  mode,
}: SaldoBlockProps) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale].saldo;
  const series = useMemo(
    () => positionSeries(accounts, txs, asOf, POSITION_WINDOW_DAYS, { fxHistory, mode }),
    [accounts, txs, asOf, fxHistory, mode],
  );

  const entities = Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0)));
  const unknownCount = series.excluded;
  const currencyCount = series.excludedCurrencyKeys.length;
  const noBalanceCount = unknownCount - currencyCount;
  const currencyNames = series.excludedCurrencyKeys
    .map((key) => accounts.find((a) => a.key === key))
    .filter((a): a is NonNullable<typeof a> => a != null)
    .map((a) => a.bank || a.name || a.key)
    .join(", ");
  const knownSum = series.current;
  // Something WAS actually converted: a non-EUR account with a balance that
  // is not on the excluded list, so it fed the total via eurBalanceOf.
  const excludedKeys = new Set(series.excludedCurrencyKeys);
  const anyConverted =
    mode === "convert" &&
    accounts.some(
      (a) => a.balance !== null && !isEurCurrency(a.currency) && !excludedKeys.has(a.key),
    );
  // Money already earmarked for unpaid BTW. Only worth a line when there is
  // some — otherwise "beschikbaar" would just repeat the number above it.
  const reserved = reservedCents(scheduledFlows, asOf);

  // Which account is holding the comparison back, by its own name — "wait for
  // more data" is useless advice; "import Amex" is actionable.
  const limitLabel = series.limitedBy
    .map((key) => accounts.find((a) => a.key === key))
    .filter((a): a is NonNullable<typeof a> => a != null)
    .map((a) => a.bank || a.name || a.key)
    .join(", ");
  const hasGraph = series.coverageDays >= MIN_HISTORY_DAYS && series.points.length >= 2;
  /** The pill beside the big number: the move against ONE WEEK AGO. Null when
   *  the history does not reach back a week — then nothing is shown. */
  const weekPct = changePct(knownSum, series.weekAgo);

  return (
    <Module
      title={c.title(unknownCount > 0)}
      span={span}
      height="tall"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("accounts")}>
          {c.rekeningenArrow}
        </button>
      }
      footer={
        <>
          {c.rekeningenEntiteiten(accounts.length, entities.length)}
          {accounts.length > 0 && reserved > 0 && (
            <>
              {c.beschikbaarNaBtw(
                formatEuroIn(locale, availableBalanceCents(knownSum, scheduledFlows, asOf) / 100),
              )}
            </>
          )}
        </>
      }
    >
      <div className="module-figure">
        <span
          className={`module-figure-value ${accounts.length === 0 ? "" : knownSum >= 0 ? "text-pos" : "text-neg"}`}
        >
          {accounts.length === 0 ? "—" : formatEuroIn(locale, knownSum)}
        </span>
        <DeltaPill pct={weekPct} upIsGood={true} />
        {/* A bare "▲ 3%" is unreadable: three percent since WHEN? The pill is
            the move against the position one week ago, so the card says so
            next to it — and says nothing at all when there is no week to
            compare against. */}
        {weekPct !== null && <span className="text-muted text-[0.8rem]">{c.tOvVorigeWeek}</span>}
      </div>
      <p className="module-figure-label">
        {accounts.length === 0
          ? c.importeerOfVulSaldos
          : noBalanceCount > 0
            ? c.rekeningNogZonderSaldo(noBalanceCount)
            : c.compleetElkeRekeningHeeftSaldo}
      </p>
      {currencyCount > 0 && (
        <p className="module-figure-label">
          {mode === "convert"
            ? c.vreemdeValutaConvert(currencyCount, currencyNames)
            : c.vreemdeValutaSeparate(currencyCount, currencyNames)}
        </p>
      )}
      {anyConverted && <p className="module-figure-label">{c.omgerekendViaEcb}</p>}

      {hasGraph ? (
        <div className="position-graph">
          <TrendChart
            points={series.points.map((p) => ({ label: dayLabelIn(locale, p.date), value: p.value }))}
            color="var(--accent)"
            format={(v) => formatEuroIn(locale, v)}
            ariaLabel={c.positiePerDagAria}
            readoutLabel={c.positieOpReadout}
            height={132}
            /* DE Y-AS AAN, op zijn verzoek. TrendChart kon dit al; hij stond hier
             * uit omdat de as in een SMALLE kaart de plot opeet. Dit blok staat
             * standaard op span 2, dus er is ruimte — maar iemand kan het op 1
             * zetten, en dan is een as die de helft van de breedte kost erger dan
             * geen as. Vandaar de voorwaarde in plaats van een vast true.
             *
             * Wat de as toevoegt is niet decoratief: zonder ijkpunten vertelt een
             * lijn alleen de VORM, en op een positiegrafiek is het verschil tussen
             * een dal van honderd euro en een van tienduizend precies wat je wilt
             * weten. */
            showAxis={span >= 2}
          />
        </div>
      ) : (
        <p className="block-empty mt-4 p-4 border border-dashed border-line rounded bg-surface-2">
          {series.coverageDays === 0
            ? limitLabel
              ? c.heeftNogGeenTransacties(limitLabel)
              : c.geenTransactiesOpRekeningenMetSaldo
            : c.pasNDagenTransactiegeschiedenis(series.coverageDays, MIN_HISTORY_DAYS)}
        </p>
      )}

      <div className="flex flex-wrap gap-8 mt-4 pt-3 border-t border-line">
        <Comparison
          locale={locale}
          label={c.vorigeWeek}
          now={knownSum}
          then={series.weekAgo}
          missing={c.nogGeenWeekGeschiedenis}
        />
        <Comparison
          locale={locale}
          label={c.vorigeMaand}
          now={knownSum}
          then={series.monthAgo}
          missing={c.nogGeenMaandGeschiedenis}
        />
      </div>
    </Module>
  );
}
