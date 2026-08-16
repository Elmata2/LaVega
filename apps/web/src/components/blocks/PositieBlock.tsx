import { useMemo } from "react";
import type { Account, Tx } from "@lavega/core";
import { monthlyTotals } from "@lavega/core";
import type { View } from "../../App";
import { smoothPath } from "../../chart.js";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";

/* Positie over je bedrijven — one row per entity: its identity colour, the
 * banks behind it, a sparkline of its monthly net flow and its balance, plus a
 * bar showing how the positive positions divide.
 *
 * The one view in the app that answers "which BV holds the money", which is
 * the whole reason LaVega consolidates across entities. */

// One colour per entity, reused for the row's dot, its sparkline and its
// segment in the proportion bar so the three read as the same thing. Cycles
// through design tokens rather than inventing colours.
const ENTITY_COLORS = ["var(--accent)", "var(--pos)", "var(--warn)", "var(--muted)"];
function entityColor(index: number): string {
  return ENTITY_COLORS[index % ENTITY_COLORS.length];
}

/** Sparkline of a per-entity monthly net series. Fewer than two points can't
 *  draw a trend, so it renders a flat baseline instead of an empty box — an
 *  honest "not enough history yet", not a blank gap. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 110;
  const h = 30;
  const pad = 3;
  if (values.length < 2) {
    return (
      <svg className="sparkline" width={w} height={h} role="img" aria-label="Onvoldoende geschiedenis voor een trend">
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="var(--line)" strokeWidth={1.5} />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  // Same monotone curve as the big charts, so a sparkline and the trend it
  // summarises have the same shape language (and neither overshoots a dip).
  const d = smoothPath(
    values.map((v, i) => ({
      x: pad + (i / (values.length - 1)) * (w - pad * 2),
      y: h - pad - ((v - min) / range) * (h - pad * 2),
    })),
  );
  return (
    <svg className="sparkline" width={w} height={h} role="img" aria-label="Trend van maandelijkse nettostroom">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type PositieBlockProps = {
  accounts: Account[];
  txs: Tx[];
  onNavigate: (view: View) => void;
};

export default function PositieBlock({ accounts, txs, onNavigate }: PositieBlockProps) {
  const rows = useMemo(() => {
    const entities = Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0)));
    return entities.map((entity, i) => {
      const entityAccounts = accounts.filter((a) => a.entity === entity);
      const entityKeys = new Set(entityAccounts.map((a) => a.key));
      const entityTxs = txs.filter((t) => entityKeys.has(t.accountKey));
      const banks = Array.from(new Set(entityAccounts.map((a) => a.bank).filter((b) => b.length > 0)));
      // One unknown balance makes the entity's total unknown — never a
      // partial sum presented as a position.
      const balance = entityAccounts.some((a) => a.balance === null)
        ? null
        : entityAccounts.reduce((s, a) => s + (a.balance as number), 0);
      const net = monthlyTotals(entityTxs).map((m) => m.in + m.out);
      return { entity, color: entityColor(i), banks, count: entityAccounts.length, balance, net };
    });
  }, [accounts, txs]);

  const positiveTotal = rows.reduce((s, r) => s + (r.balance !== null && r.balance > 0 ? r.balance : 0), 0);

  return (
    <Module
      title="Positie over je bedrijven"
      span={2}
      height="tall"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("accounts")}>
          Rekeningen →
        </button>
      }
    >
      {rows.length === 0 ? (
        <p className="block-empty">Nog geen rekeningen met een entiteit — importeer eerst een bestand.</p>
      ) : (
        <>
          <div className="position-rows">
            {rows.map((r) => (
              <div className="position-row" key={r.entity}>
                <span className="dot" style={{ background: r.color }} aria-hidden="true" />
                <div className="position-row-info">
                  <div className="position-row-name">{r.entity}</div>
                  <div className="eyebrow">
                    {r.banks.join(" · ")}
                    {r.banks.length > 0 ? " · " : ""}
                    {r.count} rek.
                  </div>
                </div>
                <Sparkline values={r.net} color={r.color} />
                <div
                  className={`position-row-balance ${r.balance === null ? "" : r.balance >= 0 ? "text-pos" : "text-neg"}`}
                >
                  {r.balance === null ? "onbekend" : formatEuro(r.balance)}
                </div>
              </div>
            ))}
          </div>
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
        </>
      )}
    </Module>
  );
}
