import { useMemo } from "react";
import type { Account } from "@lavega/core";
import { isEurCurrency } from "@lavega/core";
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
 * One unknown balance inside an entity makes that entity's position unknown —
 * never a partial sum presented as a position, and never a zero. */

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
};

export default function PositieBlock({ accounts, onNavigate }: PositieBlockProps) {
  const rows = useMemo(() => {
    const entities = Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0)));
    return entities
      .map((entity, i) => {
        const entityAccounts = accounts.filter((a) => a.entity === entity);
        // A balance in another currency is just as unknown here as a missing
        // one: adding its face value into a EUR total is what produced
        // "384.500" out of a real 4.500 + a Revolut HUF pocket of 380.000. The
        // two reasons are tracked separately, though — the footer says which
        // one it is, and a genuinely missing balance always wins the label
        // when both are present (mirrors SaldoBlock's excludedCurrencyKeys,
        // which only counts accounts that DO have a balance).
        const missingBalance = entityAccounts.some((a) => a.balance === null);
        const foreignCurrency =
          !missingBalance && entityAccounts.some((a) => !isEurCurrency(a.currency));
        const balance =
          missingBalance || foreignCurrency
            ? null
            : entityAccounts.reduce((s, a) => s + (a.balance as number), 0);
        return {
          entity,
          color: entityColor(i),
          count: entityAccounts.length,
          balance,
          missingBalance,
          foreignCurrency,
        };
      })
      .sort((a, b) => (b.balance ?? -Infinity) - (a.balance ?? -Infinity));
  }, [accounts]);

  const positiveTotal = rows.reduce(
    (s, r) => s + (r.balance !== null && r.balance > 0 ? r.balance : 0),
    0,
  );
  const shown = rows.slice(0, ROWS);
  const hidden = rows.length - shown.length;
  // Two different facts, worded differently in the footer (mirrors
  // SaldoBlock's currencyCount / noBalanceCount split): a company with no
  // balance at all is not the same claim as one whose only balance is in a
  // currency LaVega does not convert.
  const noBalanceCount = rows.filter((r) => r.missingBalance).length;
  const currencyCount = rows.filter((r) => r.foreignCurrency).length;

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
                `${currencyCount} bedrijf${currencyCount === 1 ? "" : "ven"} in vreemde valuta — LaVega rekent nog niet om naar euro's`,
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
