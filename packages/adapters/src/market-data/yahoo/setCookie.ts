const COOKIE_BOUNDARY = /,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/;

export function cookieHeaderFromSetCookie(headers: Headers): string {
  const lines = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const sources = lines.length > 0 ? lines : splitCombinedSetCookie(headers.get("set-cookie"));
  const pairs = sources
    .map((line) => line.split(";")[0]!.trim())
    .filter((pair) => pair.includes("="));
  if (pairs.length === 0) throw new Error("Failed to get Yahoo cookie");
  return pairs.join("; ");
}

function splitCombinedSetCookie(combined: string | null): string[] {
  if (!combined) return [];
  return combined.split(COOKIE_BOUNDARY);
}
