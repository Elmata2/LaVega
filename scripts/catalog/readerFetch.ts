export type ReaderFailureKind = "network" | "timeout" | "http";
export type ReaderResult =
  | { ok: true; text: string }
  | { ok: false; reason: string; kind?: ReaderFailureKind };

const READER = "https://r.jina.ai/";
const UA = "lavega-catalog-sweep/1.0 (+https://www.lavega.dev)";
const MIN_CHARS = 400;
const BLOCK_PAGE_MAX_CHARS = 3_000;
const BLOCK_MARKERS = [
  "captcha",
  "access denied",
  "verify you are human",
  "enable javascript",
  "attention required",
  "just a moment",
];

/** Fetch `url` through https://r.jina.ai/<url>. Only the provider's public URL
 *  leaves the machine: no key, no cookies, no other headers. */
export async function readThroughReader(
  url: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ReaderResult> {
  const { fetchImpl = fetch, timeoutMs = 45_000 } = opts;
  try {
    const res = await fetchImpl(`${READER}${url}`, {
      headers: { Accept: "text/plain", "User-Agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `reader ${res.status}`, kind: "http" };
    return { ok: true, text: await res.text() };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, reason: `reader timeout after ${timeoutMs} ms`, kind: "timeout" };
    }
    return {
      ok: false,
      reason: `reader ${e instanceof Error ? e.message : String(e)}`,
      kind: "network",
    };
  }
}

/** Pure: is this reader output a real document? */
export function looksLikeDocument(text: string): { ok: boolean; reason?: string } {
  const t = text.trim();
  if (t.length < MIN_CHARS) return { ok: false, reason: `only ${t.length} chars` };
  if (/^error\b/i.test(t)) return { ok: false, reason: "reader error body" };
  // The reader's own failure line, whatever the length of what follows it.
  if (/^Warning: Target URL returned error/im.test(t)) {
    return { ok: false, reason: "reader reported the target page failed" };
  }
  if (t.startsWith("{") && /"code"\s*:/.test(t) && /"message"\s*:/.test(t)) {
    return { ok: false, reason: "reader error body" };
  }
  if (t.length < BLOCK_PAGE_MAX_CHARS) {
    const lower = t.toLowerCase();
    const hit = BLOCK_MARKERS.find((m) => lower.includes(m));
    if (hit) return { ok: false, reason: `block page ("${hit}")` };
  }
  return { ok: true };
}

export type DocKind = "pdf" | "html";

/** Which reader a document needs. An explicit docKind wins; otherwise a `.pdf`
 *  path means pdf, then the response content-type, then html. The sweep's html
 *  reader sniffs `%PDF-` in the body, so the html default is safe for a URL whose
 *  type is only known after fetching. */
export function resolveDocKind(input: {
  url: string;
  docKind?: string | null;
  contentType?: string | null;
}): DocKind {
  if (input.docKind === "pdf" || input.docKind === "html") return input.docKind;
  let path = input.url;
  try {
    path = new URL(input.url).pathname;
  } catch {
    // keep the raw string
  }
  if (/\.pdf$/i.test(path)) return "pdf";
  const ct = (input.contentType ?? "").toLowerCase();
  if (ct.includes("application/pdf")) return "pdf";
  return "html";
}

/** Which of a product's own URLs the reader should be offered. HTML pages always
 *  (the page may render client-side); a PDF only when plain fetch could not read
 *  it, because pdftotext stays the reader of record for a PDF that came through. */
export function readerCandidates(
  p: {
    docUrl?: string | null;
    docKind?: string | null;
    docFetch?: string | null;
    termsUrl?: string | null;
    foundUrl?: string | null;
    foundKind?: string | null;
    pdfUrl?: string | null;
  },
  plainFailed: ReadonlySet<string>,
): string[] {
  if (p.docFetch === "jina") return [];
  const entries: { url: string; kind: DocKind }[] = [];
  // The tariff or agreement document is the document of record; the marketing page is the last resort.
  if (p.docUrl)
    entries.push({ url: p.docUrl, kind: resolveDocKind({ url: p.docUrl, docKind: p.docKind }) });
  if (p.pdfUrl) entries.push({ url: p.pdfUrl, kind: "pdf" });
  if (p.foundUrl)
    entries.push({
      url: p.foundUrl,
      kind: resolveDocKind({ url: p.foundUrl, docKind: p.foundKind }),
    });
  if (p.termsUrl)
    entries.push({ url: p.termsUrl, kind: resolveDocKind({ url: p.termsUrl, docKind: "html" }) });
  const urls = entries.filter((e) => e.kind === "html" || plainFailed.has(e.url)).map((e) => e.url);
  return [...new Set(urls)];
}

export const BREAKER_LIMIT = 5;
export type BreakerOutcome = "success" | "network" | "timeout" | "http-error" | "not-document";
export type BreakerState = { consecutive: number; open: boolean };

/** Run-level circuit breaker for a down reader. Only network errors and timeouts
 *  count; a fast HTTP error or a rejected non-document says the reader is up, so it
 *  neither counts nor resets. A real document resets. Once open it stays open. */
export function nextBreakerState(state: BreakerState, outcome: BreakerOutcome): BreakerState {
  if (state.open) return state;
  if (outcome === "success") return { consecutive: 0, open: false };
  if (outcome === "network" || outcome === "timeout") {
    const consecutive = state.consecutive + 1;
    return { consecutive, open: consecutive >= BREAKER_LIMIT };
  }
  return state;
}

/** Walk candidates in order; the first one that yields a document wins and the walk
 *  stops there, so a product costs at most one reader model call. */
export async function firstDocument(
  urls: readonly string[],
  get: (url: string) => Promise<string>,
): Promise<{ url: string | null; text: string | null; failures: string[] }> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      return { url, text: await get(url), failures };
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { url: null, text: null, failures };
}
