import type { Account, ScheduledFlow } from "./model.js";
import type { EntityForecast } from "./forecast.js";
import type { TrackedStatus } from "./tracking.js";

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
  scheduledFlows?: ScheduledFlow[];
  /** Hand-kept numbers that have gone stale (from `dueTrackers`). The alert
   *  center is LaVega's notification surface, so this is where item 7's
   *  low-trust ask lands: one row per number, carrying its own question. */
  tracking?: TrackedStatus[];
};

/** Ranked alerts (critical → warning → info):
 *  - critical: a forecast shortfall (saldo dips below the buffer)
 *  - warning:  a recurring stream whose next payment is overdue (recently)
 *  - info:     accounts still missing a saldo
 *  Missed-payment detection uses each stream's lastDate: a real arrival would
 *  have extended it. Only flagged when overdue past a grace window and by no
 *  more than two cadence cycles (older ⇒ assume the stream simply ended). */
export function computeAlerts({ accounts, forecast, asOf, bufferCents, scheduledFlows, tracking }: ComputeAlertsInput): Alert[] {
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

  for (const f of scheduledFlows ?? []) {
    const isVat = f.source === "vat";
    const isPrepayment = f.source === "prepayment";
    if ((!isVat && !isPrepayment) || f.status === "paid" || f.status === "cancelled") continue;
    const days = daysBetween(asOf, f.dueDate); // dueDate - asOf
    if (days < 0 || days > 30) continue;
    const severity: AlertSeverity = days <= 3 ? "critical" : days <= 14 ? "warning" : "info";
    alerts.push({
      id: `${isVat ? "vat" : "tax"}:${f.id}`,
      severity,
      title: `${f.label} — betaal vóór ${f.dueDate}`,
      detail: isVat
        ? `Zet ${eur(f.amountCents)} klaar; de BTW-aangifte + betaling moet uiterlijk ${f.dueDate} (over ${days} dagen).`
        : `Zet ${eur(f.amountCents)} klaar; deze vooruitbetaling winstbelasting moet uiterlijk ${f.dueDate} betaald zijn (over ${days} dagen).`,
    });
  }

  // Hand-kept numbers that have gone stale. `warning` once genuinely overdue,
  // `info` while merely due — this must never outrank a real cash problem. The
  // detail IS the question, so answering is one number away.
  for (const t of tracking ?? []) {
    if (t.state !== "due" && t.state !== "overdue") continue;
    alerts.push({
      id: `tracking:${t.source}:${t.id}`,
      severity: t.state === "overdue" ? "warning" : "info",
      title: `${t.label} — saldo bijwerken`,
      detail: `Laatst bijgewerkt op ${t.updatedAt} (${t.ageDays} dagen geleden). ${t.question}`,
    });
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
