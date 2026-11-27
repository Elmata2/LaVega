import {
  amsterdamDay,
  cardOfferOf,
  isRuleV2,
  type AgentMirror,
  type LegacyRule,
  type PlanResult,
  type Rule,
  type ScheduledFlow,
} from "@lavega/core";
import { instinctCopy } from "../copy/instinct.js";

/* The browser half of the daily message (ADR 0014). The server reads the bank
 * itself at night but cannot see the vault, so the browser hands it the three
 * things it needs to phrase a message: the category rules, the dates of coming
 * deadlines, and one card-offer figure. Nothing else goes. No flow amounts, no
 * transactions, no counterparties, no IBANs: the server rejects any other key.
 * Sync runs only for opted-in users and stops the moment the agent is off. */

export const MIRROR_DEBOUNCE_MS = 2000;
const MAX_DUE_DATES = 100;
const MAX_RULES = 500;

const clip = (value: string, max: number): string => value.slice(0, max);

/** The inverse of core's `lowerRule`, for exactly the shape it produces: one text
 *  `contains` condition on `text`, one `setCategory` action, `stopProcessing`,
 *  no `effectiveFrom`. The app holds every legacy rule lowered, and the server
 *  re-lowers a legacy row with the same function, so it matches identically.
 *  Any other v2 rule has semantics a `{match, category}` row cannot carry and is
 *  not mirrored (its transactions use the built-in categories on the server). */
function toLegacyRule(rule: Rule): LegacyRule | null {
  if (!isRuleV2(rule)) return rule;
  const [condition, ...moreConditions] = rule.conditions;
  const [action, ...moreActions] = rule.actions;
  if (
    !condition ||
    !action ||
    moreConditions.length > 0 ||
    moreActions.length > 0 ||
    condition.kind !== "text" ||
    condition.target !== "text" ||
    condition.op !== "contains" ||
    action.kind !== "setCategory" ||
    rule.stopProcessing !== true ||
    rule.effectiveFrom !== undefined
  )
    return null;
  return { id: rule.id, match: condition.value, category: action.category };
}

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
      .flatMap((r) => {
        const legacy = toLegacyRule(r);
        return legacy ? [legacy] : [];
      })
      .slice(0, MAX_RULES)
      .map((r) => ({ id: r.id, match: clip(r.match, 200), category: clip(r.category, 100) })),
    dueDates,
    cardOffer: cardOfferOf(i.plan, today),
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
  let gen = 0;

  const cancel = () => {
    gen += 1;
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
        const sendGen = gen;
        api.put(job.mirror).then(
          () => {
            if (sendGen !== gen) return;
            lastSent = job.json;
          },
          (error: unknown) => {
            if (sendGen !== gen) return;
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

/** Like `fetchAgentEnabled`, but tells "off" from "the server has no such feature" (503)
 *  and from "could not find out" (401, 500, offline): that last one is `unknown`, never off. */
export async function fetchAgentStatus(): Promise<boolean | "unavailable" | "unknown"> {
  try {
    const res = await fetch("/api/agent/settings", { credentials: "same-origin" });
    if (res.status === 503) return "unavailable";
    if (!res.ok) return "unknown";
    const body = (await res.json()) as { settings?: { enabled?: boolean } | null };
    return body.settings?.enabled === true;
  } catch {
    return "unknown";
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
