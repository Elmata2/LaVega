import {
  amsterdamDay,
  PLAN_THRESHOLDS,
  type AgentMirror,
  type PlanResult,
  type Rule,
  type ScheduledFlow,
} from "@lavega/core";
import { instinctCopy } from "../copy/instinct.js";

/* The browser half of the daily message (ADR 0010). The server reads the bank
 * itself at night but cannot see the vault, so the browser hands it the three
 * things it needs to phrase a message: the category rules, the dates of coming
 * deadlines, and one card-offer figure. Nothing else goes. No flow amounts, no
 * transactions, no counterparties, no IBANs: the server rejects any other key.
 * Sync runs only for opted-in users and stops the moment the agent is off. */

export const MIRROR_DEBOUNCE_MS = 2000;
export const MAX_YEARLY_GAIN_CENTS = 100_000_000;
const MAX_DUE_DATES = 100;
const MAX_RULES = 500;
const FULL_YEAR_MONTHS = 12;

const clip = (value: string, max: number): string => value.slice(0, max);

export function buildMirror(i: {
  rules: Rule[];
  flows: ScheduledFlow[];
  plan: PlanResult | null;
  now: Date;
  locale?: "nl" | "en";
}): AgentMirror {
  const otherLabel = instinctCopy[i.locale ?? "nl"].mirrorOtherDue;
  // The Amsterdam day, as the server computes it: UTC is a day behind from 00:00 to 02:00 local.
  const today = amsterdamDay(i.now);

  const dueDates = i.flows
    .filter((f) => (f.status === "expected" || f.status === "confirmed") && f.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
    .slice(0, MAX_DUE_DATES)
    .map((f) => ({
      kind: f.source === "vat" ? ("vat" as const) : ("other" as const),
      // VAT keeps its label (BTW Q4 2026); anything else may carry a supplier
      // name the user typed, so it goes as a generic line with the date.
      label: f.source === "vat" ? clip(f.label, 200) : otherLabel,
      date: f.dueDate,
    }));

  return {
    rules: i.rules
      .slice(0, MAX_RULES)
      .map((r) => ({ id: r.id, match: clip(r.match, 200), category: clip(r.category, 100) })),
    dueDates,
    cardOffer: cardOfferOf(i.plan, today),
  };
}

/** The best other card's gain over the card in use, as a yearly figure. */
function cardOfferOf(plan: PlanResult | null, today: string): AgentMirror["cardOffer"] {
  if (!plan) return null;
  const f = plan.sections.cards.figures;
  const inUse = f.nets.find((n) => n.cardKey === f.cardInUseKey);
  if (!inUse || inUse.netCents === null) return null;
  let best: { name: string; netCents: number } | null = null;
  for (const n of f.nets) {
    if (n.cardKey === inUse.cardKey || n.netCents === null) continue;
    if (best === null || n.netCents > best.netCents) best = { name: n.name, netCents: n.netCents };
  }
  if (!best) return null;
  // The same margin cards.ts needs before it calls another card better.
  const margin = PLAN_THRESHOLDS.cards.betterCardMargin * Math.abs(inUse.netCents);
  if (best.netCents - inUse.netCents - margin <= 1e-9) return null;
  // The nets cover `horizon` months; the stated-spend case covers a full year.
  const horizon =
    f.cardableSpendCents === 0
      ? FULL_YEAR_MONTHS
      : Math.max(1, Math.min(f.months, FULL_YEAR_MONTHS));
  const yearly = Math.round(((best.netCents - inUse.netCents) * FULL_YEAR_MONTHS) / horizon);
  if (!Number.isInteger(yearly) || yearly <= 0) return null;
  return {
    name: clip(best.name, 200),
    yearlyGainCents: Math.min(yearly, MAX_YEARLY_GAIN_CENTS),
    computedAt: today,
  };
}

export type MirrorApi = { put(m: AgentMirror): Promise<void> };

export function createMirrorSync(
  api: MirrorApi,
  enabled: () => boolean,
  opts: { debounceMs?: number; onRefused?: () => void } = {},
): { push(m: AgentMirror): void; cancel(): void } {
  const wait = opts.debounceMs ?? MIRROR_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { json: string; mirror: AgentMirror } | undefined;
  let lastSent: string | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  return {
    cancel,
    push(mirror) {
      if (!enabled()) {
        cancel();
        lastSent = undefined;
        return;
      }
      const json = JSON.stringify(mirror);
      if (json === lastSent && pending === undefined) return;
      pending = { json, mirror };
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const job = pending;
        pending = undefined;
        // Re-checked at send time: the agent may have been turned off meanwhile.
        if (!job || !enabled() || job.json === lastSent) return;
        api.put(job.mirror).then(
          () => {
            lastSent = job.json;
          },
          (error: unknown) => {
            lastSent = undefined;
            if (error instanceof MirrorRefused) opts.onRefused?.();
          },
        );
      }, wait);
    },
  };
}

/** The server answered 409: the daily message is off there. */
export class MirrorRefused extends Error {
  constructor() {
    super("mirror-refused");
    this.name = "MirrorRefused";
  }
}

/** Whether the server has the daily message on for this session. False on any failure. */
export async function fetchAgentEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/agent/settings", { credentials: "same-origin" });
    if (!res.ok) return false;
    const body = (await res.json()) as { settings?: { enabled?: boolean } | null };
    return body.settings?.enabled === true;
  } catch {
    return false;
  }
}

export const agentMirrorApi: MirrorApi = {
  async put(m) {
    const res = await fetch("/api/agent/mirror", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(m),
    });
    if (res.status === 409) throw new MirrorRefused();
    if (!res.ok) throw new Error(`mirror put ${res.status}`);
  },
};
