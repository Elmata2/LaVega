import { useMemo } from "react";
import type { Account } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";

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
        const balance = entityAccounts.some((a) => a.balance === null)
          ? null
          : entityAccounts.reduce((s, a) => s + (a.balance as number), 0);
        return { entity, color: entityColor(i), count: entityAccounts.length, balance };
      })
      .sort((a, b) => (b.balance ?? -Infinity) - (a.balance ?? -Infinity));
  }, [accounts]);

  const positiveTotal = rows.reduce((s, r) => s + (r.balance !== null && r.balance > 0 ? r.balance : 0), 0);
  const shown = rows.slice(0, ROWS);
  const hidden = rows.length - shown.length;
  const unknown = rows.filter((r) => r.balance === null).length;

  return (
    <Module
      title="Positie per bedrijf"
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
            {unknown > 0
              ? `${unknown} bedrijf${unknown === 1 ? "" : "ven"} zonder compleet saldo`
              : "Alle saldo's bekend"}
          </>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <p className="block-empty">Nog geen rekeningen met een entiteit — importeer eerst een bestand.</p>
      ) : (
        <>
          <div className="proportion-bar" role="img" aria-label="Verhouding van positieve posities per bedrijf">
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
