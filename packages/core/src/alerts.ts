import type { Account } from "./model.js";
import type { EntityForecast } from "./forecast.js";

/* The "Aandacht" alert-center. Pure + deterministic: derives a ranked list of
 * things worth the owner's attention from the already-computed forecast +
 * accounts. No I/O, no clock (asOf is passed in). The forecast must be built
 * with the user's buffer so `shortfall` reflects it. */

export type AlertSeverity = "critical" | "warning" | "info";
export type Alert = { id: string; severity: AlertSeverity; title: string; detail: string };

/** Whole days from ISO `a` to ISO `b` (b - a), via Date.UTC (locale/TZ-safe). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
function eur(cents: number): string {
  return "€ " + (cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type ComputeAlertsInput = {
  accounts: Account[];
  forecast: EntityForecast; // consolidated, built with the user's bufferCents
  asOf: string;
  bufferCents: number;
};

/** Ranked alerts (critical → warning → info):
 *  - critical: a forecast shortfall (saldo dips below the buffer)
 *  - warning:  a recurring stream whose next payment is overdue (recently)
 *  - info:     accounts still missing a saldo
 *  Missed-payment detection uses each stream's lastDate: a real arrival would
 *  have extended it. Only flagged when overdue past a grace window and by no
 *  more than two cadence cycles (older ⇒ assume the stream simply ended). */
export function computeAlerts({ accounts, forecast, asOf, bufferCents }: ComputeAlertsInput): Alert[] {
  const alerts: Alert[] = [];

  if (forecast.shortfall) {
    alerts.push({
      id: "shortfall",
      severity: "critical",
      title: "Verwacht tekort",
      detail: `Rond ${forecast.shortfall.date} zakt je saldo naar ${eur(forecast.shortfall.balanceCents)} — onder je buffer van ${eur(bufferCents)}.`,
    });
  }

  for (const s of forecast.streams) {
    const expectedNext = addDays(s.lastDate, s.cadenceDays);
    const overdueDays = daysBetween(expectedNext, asOf);
    const grace = Math.max(3, Math.round(s.cadenceDays * 0.2));
    if (overdueDays > grace && overdueDays <= s.cadenceDays * 2) {
      const kind = s.sign === 1 ? "inkomst" : "betaling";
      const prep = s.sign === 1 ? "van" : "aan";
      alerts.push({
        id: `missed:${s.key}`,
        severity: "warning",
        title: `Verwachte ${kind} niet gezien`,
        detail: `${kind[0].toUpperCase() + kind.slice(1)} ${prep} ${s.counterparty} (~${eur(s.amountCents)}) werd rond ${expectedNext} verwacht, maar is nog niet binnen.`,
      });
    }
  }

  const noBalance = accounts.filter((a) => a.balance === null).length;
  if (noBalance > 0) {
    alerts.push({
      id: "no-balance",
      severity: "info",
      title: "Onbekend saldo",
      detail: `${noBalance} rekening${noBalance > 1 ? "en" : ""} zonder saldo — vul in bij Rekeningen voor een compleet beeld.`,
    });
  }

  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
