import { useEffect, useState } from "react";
import type { PersonalNetWorthTotal } from "@lavega/core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPersonalNetWorthTotal(value: unknown): value is PersonalNetWorthTotal {
  return isRecord(value) && typeof value.date === "string" && typeof value.totalCents === "number";
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

/**
 * The owner's opted-in Personal totals for the net worth chart
 * (docs/investing/DASHBOARD.md). Deliberately fails open to an empty list on
 * any error — a 401, a network failure, an unreadable body — rather than
 * surfacing an error state: this is optional, additive data, and "nothing
 * shared" is a legitimate state the chart already renders correctly.
 */
async function fetchPersonalNetWorthTotals(signal: AbortSignal): Promise<PersonalNetWorthTotal[]> {
  try {
    const response = await fetch("/api/investing/personal-net-worth", { signal });
    if (!response.ok) return [];
    const payload: unknown = await response.json().catch(() => undefined);
    if (!isRecord(payload) || !Array.isArray(payload.totals)) return [];
    return payload.totals.filter(isPersonalNetWorthTotal);
  } catch (reason) {
    if (isAbortError(reason)) throw reason;
    return [];
  }
}

export function usePersonalNetWorthTotals(): PersonalNetWorthTotal[] {
  const [totals, setTotals] = useState<PersonalNetWorthTotal[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchPersonalNetWorthTotals(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setTotals(result);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return totals;
}
