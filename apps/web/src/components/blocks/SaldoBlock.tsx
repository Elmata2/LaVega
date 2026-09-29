import { useMemo } from "react";
import type { ScheduledFlow, Tx } from "@lavega/core";
import {
  availableBalanceCents,
  isEurCurrency,
  reservedCents,
  type Account,
  type ConversionMode,
} from "@lavega/core";
import type { View } from "../../App";
import { formatEuroIn } from "../../format.js";
import Module from "../Module.js";
import TrendChart from "../TrendChart.js";
import CardLink from "../ui/CardLink.js";
import DeltaPill from "./DeltaPill.js";
import type { Locale } from "../../locale.js";
import { useAppLocale } from "../../appLocale.js";
import { moneyCopy, dayLabelIn } from "../../copy/money.js";
import { accountGaps } from "@lavega/core";
import { POSITION_WINDOW_DAYS, positionSeries, type PositionSeries } from "../../totalePositie.js";

export { POSITION_WINDOW_DAYS, positionSeries, type PositionPoint, type PositionSeries } from "../../totalePositie.js";

/** Below this much transaction history there is no line worth drawing — two or
 *  three days of movement is a squiggle, not a trend. */
export const MIN_HISTORY_DAYS = 7;

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
  /* WAT DE REKENINGEN NOG NIET HEBBEN VERTELD. Zijn vraag bij de UI-ronde:
   * vraag het in plaats van stilzwijgend minder te kunnen. Hier en niet in een
   * eigen kaart, omdat dit dezelfde vraag is als de saldoregel hierboven —
   * "deze kaart weet nog niet alles, en dit is wat eraan ontbreekt". De
   * saldo-gaten zitten er met opzet niet in: die staan al in de regel erboven. */
  const gaps = useMemo(() => accountGaps(accounts), [accounts]);
  const missingIban = gaps.filter((g) => g.gaps.includes("iban"));
  const missingType = gaps.filter((g) => g.gaps.includes("type"));
  const nameList = (rows: typeof gaps) => rows.map((g) => g.name).join(", ");

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
      title={c.title(unknownCount)}
      span={span}
      height="tall"
      menu={<CardLink onClick={() => onNavigate("accounts")}>{c.rekeningenArrow}</CardLink>}
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
      {missingIban.length > 0 && (
        <p className="module-figure-label">
          {c.ibanOntbreekt(missingIban.length, nameList(missingIban))}
        </p>
      )}
      {missingType.length > 0 && (
        <p className="module-figure-label">
          {c.typeOntbreekt(missingType.length, nameList(missingType))}
        </p>
      )}

      {hasGraph ? (
        <div className="position-graph">
          <TrendChart
            points={series.points.map((p) => ({
              label: dayLabelIn(locale, p.date),
              value: p.value,
            }))}
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
