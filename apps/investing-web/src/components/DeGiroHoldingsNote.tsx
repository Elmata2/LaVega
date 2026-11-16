import type { DeGiroDataState } from "@lavega/core";
import { deGiroDaysSince } from "@lavega/core";
import { shortDate } from "../lib/dates.js";

/* A DeGiro import is a dated snapshot: our prices move every day, the
 * quantities do not. This note says which day the quantities belong to, so a
 * holdings figure can never read as live (D13, #325). */
export function DeGiroHoldingsNote({
  degiro,
  today,
}: {
  degiro?: DeGiroDataState | undefined;
  /** Test seam; the app uses the reader's own day. */
  today?: string;
}) {
  if (!degiro) return null;
  const day = today ?? new Date().toISOString().slice(0, 10);
  const importedAge = deGiroDaysSince(degiro.importedAt, day);
  const quantitiesDay = degiro.positionsAsOf ?? degiro.coversTo;
  const quantitiesAge = deGiroDaysSince(quantitiesDay, day);
  const age = (days: number | null) =>
    days === null ? "" : days === 0 ? " (today)" : ` (${days} ${days === 1 ? "day" : "days"} old)`;
  if (degiro.importedAt === null && quantitiesDay === null) return null;
  return (
    <p
      role="note"
      data-degiro-age={quantitiesAge ?? importedAge ?? undefined}
      className="rounded-tile border border-border bg-secondary/40 px-4 py-2.5 text-xs leading-5 text-muted-foreground"
    >
      <span className="font-semibold text-foreground">DeGiro</span>
      {degiro.importedAt === null
        ? null
        : ` · imported ${shortDate(degiro.importedAt.slice(0, 10))}${age(importedAge)}`}
      {quantitiesDay === null
        ? null
        : ` · quantities from ${shortDate(quantitiesDay)}${age(quantitiesAge)}`}
      . Prices update daily; quantities are not live.
    </p>
  );
}
