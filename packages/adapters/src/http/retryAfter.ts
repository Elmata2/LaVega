/** Parse an HTTP `Retry-After` header (seconds or HTTP-date) into milliseconds. */
export function retryAfterMsOf(header: string | null, nowMs = Date.now()): number | undefined {
  const raw = header?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1_000 : undefined;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > nowMs ? at - nowMs : undefined;
}
