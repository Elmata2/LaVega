import { useMemo } from "react";
import type { Account, ConversionMode } from "@lavega/core";
import { isEurCurrency, toEur } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";

/* Positie over je bedrijven — which BV holds the money.
 *
 * Deliberately the SMALL block on the page now. It used to be a two-column,
 * full-height card with a sparkline per entity, which gave a three-line answer
 * a chart's worth of space; Alexander's review called it "interesting, but far
 * too large". What is left is the answer itself: the split as one bar, and one
 * compact row per entity.
 *
 * A missing balance on any account makes that entity's position unknown —
 * never a partial sum, and never a zero. A foreign-currency balance is
 * different: in convert mode LaVega sums whatever it CAN price and names
 * what it can't (mirrors SaldoBlock's excludedCurrencyKeys), because a
 * missing rate for one date is a gap that might resolve with the next
 * import. Separate mode never converts anything, so there the gap is
 * permanent for as long as that mode is chosen — a foreign balance there
 * still nulls the whole entity, same as before this file's partial-sum fix. */

// One colour per entity, reused for the row's dot and its segment in the
// proportion bar so the two read as the same thing. Design tokens only.
const ENTITY_COLORS = ["var(--accent)", "var(--pos)", "var(--warn)", "var(--muted)"];
function entityColor(index: number): string {
  return ENTITY_COLORS[index % ENTITY_COLORS.length];
}

/** Rows that fit the small card; the rest are counted, not dropped silently. */
const ROWS = 4;

type PositieBlockProps = {
  accounts: Account[];
  onNavigate: (view: View) => void;
  asOf: string;
  fxHistory: Record<string, Record<string, number>>;
  mode: ConversionMode;
};

export default function PositieBlock({
  accounts,
  onNavigate,
  asOf,
  fxHistory,
  mode,
}: PositieBlockProps) {
  const rows = useMemo(() => {
    const eurBalanceOf = (a: Account): number | null => {
      if (a.balance === null) return null;
      if (isEurCurrency(a.currency)) return a.balance;
      return mode === "convert" ? toEur(a.balance, a.currency, asOf, fxHistory) : null;
    };
    const entities = Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0)));
    return entities
      .map((entity, i) => {
        const entityAccounts = accounts.filter((a) => a.entity === entity);
        // A genuinely missing balance always wins the label when it and a
        // foreign-currency gap both exist on the same entity (mirrors
        // SaldoBlock's excludedCurrencyKeys, which only counts accounts that
        // DO have a balance) — so unpricedAccounts stays empty once
        // missingBalance is already true.
        const missingBalance = entityAccounts.some((a) => a.balance === null);
        const unpricedAccounts = missingBalance
          ? []
          : entityAccounts.filter(
              (a) => a.balance !== null && !isEurCurrency(a.currency) && eurBalanceOf(a) === null,
            );
        const pricedAccounts = entityAccounts.filter((a) => eurBalanceOf(a) !== null);
        const balance =
          missingBalance ||
          pricedAccounts.length === 0 ||
          (mode === "separate" && unpricedAccounts.length > 0)
            ? null
            : pricedAccounts.reduce((s, a) => s + (eurBalanceOf(a) as number), 0);
        return {
          entity,
          color: entityColor(i),
          count: entityAccounts.length,
          balance,
          missingBalance,
          unpricedAccounts,
          converted: entityAccounts.some(
            (a) => !isEurCurrency(a.currency) && eurBalanceOf(a) !== null,
          ),
        };
      })
      .sort((a, b) => (b.balance ?? -Infinity) - (a.balance ?? -Infinity));
  }, [accounts, asOf, fxHistory, mode]);

  const positiveTotal = rows.reduce(
    (s, r) => s + (r.balance !== null && r.balance > 0 ? r.balance : 0),
    0,
  );
  const shown = rows.slice(0, ROWS);
  const hidden = rows.length - shown.length;
  // Two different facts, worded differently in the footer (mirrors
  // SaldoBlock's currencyCount / noBalanceCount split): a company with no
  // balance at all is not the same claim as one that still has an unpriced
  // foreign-currency account.
  const noBalanceCount = rows.filter((r) => r.missingBalance).length;
  const currencyCount = rows.filter((r) => r.unpricedAccounts.length > 0).length;
  // Named the same way SaldoBlock names its excludedCurrencyKeys, so "why is
  // this smaller than the account list" has an answer instead of a bare count.
  const currencyNames = rows
    .flatMap((r) => r.unpricedAccounts)
    .map((a) => a.bank || a.name || a.key)
    .join(", ");
  // Whether something WAS actually converted — separate from currencyCount,
  // which counts what is still excluded. Only worth a line once, not per row.
  const anyConverted = rows.some((r) => r.converted);

  return (
    <Module
      title="Positie"
      height="short"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("accounts")}>
          Rekeningen →
        </button>
      }
      footer={
        rows.length > 0 ? (
          <>
            {hidden > 0 && `+${hidden} meer · `}
            {[
              noBalanceCount > 0 &&
                `${noBalanceCount} bedrijf${noBalanceCount === 1 ? "" : "ven"} zonder compleet saldo`,
              currencyCount > 0 &&
                (mode === "convert"
                  ? `${currencyCount} bedrijf${currencyCount === 1 ? "" : "ven"} in vreemde valuta${currencyNames ? ` (${currencyNames})` : ""} — nog geen koers.`
                  : `${currencyCount} bedrijf${currencyCount === 1 ? "" : "ven"} in vreemde valuta${currencyNames ? ` (${currencyNames})` : ""} — LaVega rekent nog niet om naar euro's`),
              anyConverted && "Omgerekend via ECB.",
            ]
              .filter(Boolean)
              .join(" · ") || "Alle saldo's bekend"}
          </>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <p className="block-empty">
          Nog geen rekeningen met een entiteit — importeer eerst een bestand.
        </p>
      ) : (
        <>
          <div
            className="proportion-bar"
            role="img"
            aria-label="Verhouding van positieve posities per bedrijf"
          >
            {rows
              .filter((r) => r.balance !== null && r.balance > 0)
              .map((r) => (
                <span
                  key={r.entity}
                  style={{
                    width: `${positiveTotal > 0 ? ((r.balance as number) / positiveTotal) * 100 : 0}%`,
                    background: r.color,
                  }}
                />
              ))}
          </div>

          <div className="entity-rows">
            {shown.map((r) => (
              <div className="entity-row" key={r.entity}>
                <span className="dot" style={{ background: r.color }} aria-hidden="true" />
                <span className="entity-row-name" title={`${r.entity} · ${r.count} rek.`}>
                  {r.entity}
                </span>
                <span
                  className={`entity-row-balance ${r.balance === null ? "" : r.balance >= 0 ? "text-pos" : "text-neg"}`}
                >
                  {r.balance === null ? "onbekend" : formatEuro(r.balance)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Module>
  );
}

/** The same card as the homescreen should place it: itself when the widget is
 *  switched on in Profiel, and NOTHING at all when it is off — not an empty
 *  card, and not a placeholder telling him where the switch is. He asked for a
 *  widget he can click on and off; off means gone.
 *
 *  The gate sits here rather than in the view so the switch travels with the
 *  card. The block itself stays a pure props-in component, which is what keeps
 *  it testable and reusable somewhere the preference does not apply. */
export function PositieWidget(props: PositieBlockProps) {
  return useWidgetEnabled("positie") ? <PositieBlock {...props} /> : null;
}
