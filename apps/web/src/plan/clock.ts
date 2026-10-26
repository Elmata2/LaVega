import { DateTime, Effect } from "effect";

/* The web boundary's only clock. Core takes `asOf`; this is where "now" comes
 * from, through Effect's Clock rather than `new Date()`. */

const nowUtc = (): Promise<DateTime.Utc> => Effect.runPromise(DateTime.now);

/** Current instant as an ISO string (UTC), e.g. 2026-10-24T09:30:00.000Z. */
export const nowIso = async (): Promise<string> => DateTime.formatIso(await nowUtc());

/** Current calendar day, ISO (UTC), e.g. 2026-10-24. */
export const todayIso = async (): Promise<string> => (await nowIso()).slice(0, 10);
