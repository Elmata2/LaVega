import { useMemo } from "react";
import type { Account, OwnAccounts, Rule, Tx } from "@lavega/core";
import { enrichTxs, monthlyTotals, categoryTotals, forecastCashflow } from "@lavega/core";
import type { View } from "../App";
import { formatEuro } from "../format";

type OverzichtProps = {
  accounts: Account[];
  txs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  asOf: string;
  onNavigate: (view: View) => void;
};

// Identity color per entity row — reused for the row's dot, its sparkline,
// and its segment in the proportion bar so the three stay visually linked.
// Cycles through design-system tokens rather than inventing new colors.
const ENTITY_COLORS = ["var(--accent)", "var(--pos)", "var(--warn)", "var(--muted)"];
function entityColor(index: number): string {
  return ENTITY_COLORS[index % ENTITY_COLORS.length];
}

/** Small inline-SVG sparkline of a per-entity monthly net series. Fewer than
 *  two points can't draw a trend, so it renders a flat baseline instead of
 *  an empty box — an honest "not enough history yet", not a blank gap. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 110;
  const h = 30;
  const pad = 3;
  if (values.length < 2) {
    return (
      <svg width={w} height={h} role="img" aria-label="Onvoldoende geschiedenis voor een trend">
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="var(--line)" strokeWidth={1.5} />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label="Trend van maandelijkse nettostroom">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type ForecastChartPoint = {
  date: string;
  projectedClosingCents: number | null;
  lowerCents: number | null;
  upperCents: number | null;
};

/** Mini 13-week cashflow chart: filled P-band, a dashed buffer(0) line, and
 *  the median projected-closing line (red once a shortfall exists, mint
 *  otherwise — money semantics, not decoration). */
function CashflowMiniChart({
  points,
  bufferCents,
  shortfallDate,
}: {
  points: ForecastChartPoint[];
  bufferCents: number;
  shortfallDate: string | null;
}) {
  const w = 320;
  const h = 96;
  const padX = 6;
  const padY = 10;
  const values = points
    .flatMap((p) => [p.projectedClosingCents, p.lowerCents, p.upperCents])
    .concat(bufferCents)
    .filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (i: number) => padX + (i / Math.max(1, points.length - 1)) * (w - padX * 2);
  const y = (v: number) => h - padY - ((v - min) / range) * (h - padY * 2);

  const medianPoints = points.map((p, i) => `${x(i)},${y(p.projectedClosingCents ?? 0)}`).join(" ");
  const bandTop = points.map((p, i) => `${x(i)},${y(p.upperCents ?? p.projectedClosingCents ?? 0)}`);
  const bandBottom = points
    .map((p, i) => `${x(i)},${y(p.lowerCents ?? p.projectedClosingCents ?? 0)}`)
    .reverse();
  const bandPath = `M ${[...bandTop, ...bandBottom].join(" L ")} Z`;
  const lineColor = shortfallDate ? "var(--neg)" : "var(--pos)";
  const shortfallIndex = shortfallDate ? points.findIndex((p) => p.date === shortfallDate) : -1;

  return (
    <svg width={w} height={h} role="img" aria-label="Verwachte kaspositie komende 13 weken">
      <path d={bandPath} fill="rgba(138,143,163,0.16)" stroke="none" />
      <line
        x1={padX}
        y1={y(bufferCents)}
        x2={w - padX}
        y2={y(bufferCents)}
        stroke="var(--warn)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
      <polyline
        points={medianPoints}
        fill="none"
        stroke={lineColor}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {shortfallIndex >= 0 && (
        <circle cx={x(shortfallIndex)} cy={y(points[shortfallIndex].projectedClosingCents ?? 0)} r={3.5} fill="var(--neg)" />
      )}
    </svg>
  );
}

const FORECAST_BUFFER_CENTS = 0;

export default function Overzicht({ accounts, txs, rules, own, asOf, onNavigate }: OverzichtProps) {
  // Per-category in/out (rules + built-in defaults + own-transfer detection) —
  // biggest categories first.
  const catRows = useMemo(() => {
    const totals = categoryTotals(txs, rules, own);
    return Object.entries(totals).sort(
      (a, b) => Math.abs(b[1].in) + Math.abs(b[1].out) - (Math.abs(a[1].in) + Math.abs(a[1].out)),
    );
  }, [txs, rules, own]);

  const entities = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0))),
    [accounts],
  );
  const unknownCount = useMemo(() => accounts.filter((a) => a.balance === null).length, [accounts]);
  // Sum of the KNOWN balances — so Totaalpositie always shows a number, even
  // when some accounts (CSV imports) have no saldo yet. When unknownCount is 0
  // this equals consolidate()'s totalBalance (a complete, exact position).
  const knownSum = useMemo(() => accounts.reduce((s, a) => s + (a.balance ?? 0), 0), [accounts]);

  const recent = useMemo(
    () =>
      enrichTxs(txs, accounts)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 6),
    [txs, accounts],
  );

  const forecast = useMemo(
    () => forecastCashflow(txs, accounts, { asOf, bufferCents: FORECAST_BUFFER_CENTS }).consolidated,
    [txs, accounts, asOf],
  );

  const positionRows = useMemo(
    () =>
      entities.map((entity, i) => {
        const entityAccounts = accounts.filter((a) => a.entity === entity);
        const entityKeys = new Set(entityAccounts.map((a) => a.key));
        const entityTxs = txs.filter((t) => entityKeys.has(t.accountKey));
        const banks = Array.from(new Set(entityAccounts.map((a) => a.bank).filter((b) => b.length > 0)));
        const balance = entityAccounts.some((a) => a.balance === null)
          ? null
          : entityAccounts.reduce((s, a) => s + (a.balance as number), 0);
        const net = monthlyTotals(entityTxs).map((m) => m.in + m.out);
        return { entity, color: entityColor(i), banks, count: entityAccounts.length, balance, net };
      }),
    [entities, accounts, txs],
  );
  const positiveTotal = positionRows.reduce(
    (s, r) => s + (r.balance !== null && r.balance > 0 ? r.balance : 0),
    0,
  );

  const shortfallWeek =
    forecast.shortfall !== null
      ? forecast.points.findIndex((p) => p.date === forecast.shortfall!.date) + 1
      : null;

  return (
    <>
      <div className="kpi-row">
        <div className="kpi highlight">
          <div className="kpi-label">Totaalpositie{unknownCount > 0 ? " (deels)" : ""}</div>
          <div className={`kpi-value ${accounts.length === 0 ? "" : knownSum >= 0 ? "text-pos" : "text-neg"}`}>
            {accounts.length === 0 ? "—" : formatEuro(knownSum)}
          </div>
          <div className="eyebrow">
            {accounts.length === 0
              ? "importeer of vul saldo's in"
              : unknownCount > 0
                ? `${unknownCount} rekening${unknownCount > 1 ? "en" : ""} nog zonder saldo — vul in bij Rekeningen`
                : "compleet"}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Rekeningen</div>
          <div className="kpi-value">{accounts.length}</div>
          <div className="eyebrow">over {entities.length} entiteiten</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Entiteiten</div>
          <div className="kpi-value">{entities.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Aandacht</div>
          <div className={`kpi-value ${unknownCount > 0 ? "text-warn" : ""}`}>{unknownCount}</div>
          <div className="eyebrow">ter info</div>
        </div>
      </div>

      <div className="card-grid">
        <section className="card span-2" aria-label="Positie over je bedrijven">
          <div className="card-header">
            <h2>Positie over je bedrijven</h2>
            <button type="button" className="card-link" onClick={() => onNavigate("accounts")}>
              Rekeningen →
            </button>
          </div>
          {positionRows.length === 0 ? (
            <p>Nog geen rekeningen — importeer eerst een bestand.</p>
          ) : (
            <>
              <div className="position-rows">
                {positionRows.map((r) => (
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
                    <div className={`position-row-balance ${r.balance === null ? "" : r.balance >= 0 ? "text-pos" : "text-neg"}`}>
                      {r.balance === null ? "onbekend" : formatEuro(r.balance)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="proportion-bar" role="img" aria-label="Verhouding van positieve posities per bedrijf">
                {positionRows
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
        </section>

        <section className="card" aria-label="Cashflow komende 13 weken">
          <div className="card-header">
            <h2>Cashflow · komende 13 weken</h2>
            <button type="button" className="card-link" onClick={() => onNavigate("forecast")}>
              Forecast →
            </button>
          </div>
          {forecast.openingCents === null ? (
            <p>Positie onbekend — nog geen betrouwbare prognose mogelijk.</p>
          ) : forecast.points.length === 0 ? (
            <p>Onvoldoende historie voor een prognose.</p>
          ) : (
            <>
              <CashflowMiniChart
                points={forecast.points}
                bufferCents={FORECAST_BUFFER_CENTS}
                shortfallDate={forecast.shortfall?.date ?? null}
              />
              <p className="cashflow-caption">
                {forecast.shortfall && shortfallWeek !== null ? (
                  <>
                    Krapste week:{" "}
                    <strong className="text-warn">
                      week {shortfallWeek} — {formatEuro(forecast.shortfall.balanceCents / 100)}
                    </strong>
                  </>
                ) : (
                  "Geen tekort verwacht in de komende 13 weken."
                )}
              </p>
            </>
          )}
        </section>

        <section className="card" aria-label="Recente transacties">
          <div className="card-header">
            <h2>Recente transacties</h2>
            <button type="button" className="card-link" onClick={() => onNavigate("transactions")}>
              alle →
            </button>
          </div>
          {recent.length === 0 ? (
            <p>Nog geen transacties.</p>
          ) : (
            <div className="tx-list">
              {recent.map((t) => (
                <div className="tx-row" key={t.id}>
                  <div className="tx-row-info">
                    <div className="tx-desc">{t.description || t.counterparty}</div>
                    <div className="eyebrow">
                      {t.entity} · {t.bank} · {t.date}
                    </div>
                  </div>
                  <div className={`tx-amount ${t.amount >= 0 ? "text-pos" : "text-neg"}`}>
                    {formatEuro(t.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card" aria-label="Per categorie">
          <div className="card-header">
            <h2>Per categorie</h2>
            <button type="button" className="card-link" onClick={() => onNavigate("rules")}>
              regels →
            </button>
          </div>
          {catRows.length === 0 ? (
            <p>Nog geen transacties.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Categorie</th>
                    <th>In</th>
                    <th>Uit</th>
                  </tr>
                </thead>
                <tbody>
                  {catRows.map(([cat, b]) => (
                    <tr key={cat}>
                      <td>{cat}</td>
                      <td><span className="text-pos">{formatEuro(b.in)}</span></td>
                      <td><span className="text-neg">{formatEuro(b.out)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
