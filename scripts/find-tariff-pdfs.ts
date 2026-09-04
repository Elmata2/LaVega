/* FINDING EACH ISSUER'S OWN TARIFF DOCUMENT.
 *
 * The first full sweep covered 14 of 124 and the limit was not the extractor —
 * five spot-checks confirmed the model reads these pages correctly. The limit is
 * the SOURCE: 123 of 124 products point at a marketing page, and a marketing page
 * states a rate while saying nothing about caps. That is why 17 figures came back
 * found-but-refused; all 17 are the same sentence — "this page never says whether
 * there is a cap".
 *
 * A bank's Tarievenoverzicht does say. It is a contractual document, so the tiers,
 * packages and allowances are in it — ING's is the one PDF pinned in state.json
 * and the only document that positively settled its conditions.
 *
 * So: find those documents. No model is involved. The search rung tried and went
 * 0-for-4 live, and paying Opus to guess URLs is worse than following the links a
 * bank already publishes. This walks from each issuer's own pages to its own PDFs.
 *
 * A found document is a DURABLE asset, unlike a figure: it does not go stale
 * between sweeps, and every later sweep reads it for free. That is what makes this
 * worth doing once and properly.
 *
 * Discovery is per ISSUER, not per product, because one tariff sheet usually
 * covers a bank's whole range (ING's Kostenoverzicht carries betaalpas AND
 * creditcard). The document is pinned to every product of that issuer and the
 * sweep then asks the model per product, which declines when the document does
 * not cover that one.
 *
 * Writes nothing unless --write is passed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const STATE = "docs/catalog/state.json";
const args = process.argv.slice(2);
const write = args.includes("--write");
const only = args.find((a) => a.startsWith("--only="))?.slice(7) ?? null;
/** Sitemaps, because following links fails exactly where it matters. ABN AMRO
 *  returns zero .pdf hrefs — its pages are rendered client-side, so there is no
 *  anchor to follow — while its sitemap lists the documents plainly. A sitemap is
 *  also the publisher's own index, so it is a better source of truth than whatever
 *  a marketing page happens to link this month. */
const useSitemap = args.includes("--sitemap");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 30_000;
const GAP_MS = 1_200; // polite: one request per issuer-ish, not a crawl

/** A PDF is only a source for fxFeePct if it actually discusses foreign currency.
 *  A bank's mortgage tariff sheet is a tariff sheet and is still the wrong
 *  document, so this is a gate rather than a score — pinning the wrong PDF would
 *  send every later sweep to read it. */
// Vocabulary matters more than it looks. de Volksbank's brands price the same
// thing as "valutawisselkosten" and as "in vreemde valuta ... 1,4% van het
// betaalde bedrag" and never write "koersopslag" at all — a term list built from
// ING's wording alone would have called both documents unusable while they carry
// exactly the rows we need.
const FX_TERMS =
  /koersopslag|wisselkoers|valutakoers|valutawisselkosten|valutakosten|vreemde valuta|buitenlands geld|currency conversion|exchange rate fee|foreign (?:exchange|transaction) fee/gi;
/** Anchor text and filenames that suggest a fee document. Deliberately broad —
 *  verification below is what decides, not this. */
const LINK_HINT = /tarie|kosten|fee|prijs|charges|vergoeding|voorwaarden|productinfo|pricing/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Product = {
  product: string;
  issuer: string;
  termsUrl?: string;
  pdfUrl?: string;
  pdfReason?: string;
  pdfCheckedAt?: string;
  readable?: string;
  [k: string]: unknown;
};
type State = { products: Record<string, Product>; [k: string]: unknown };

const state: State = JSON.parse(readFileSync(STATE, "utf8"));

async function get(
  url: string,
  binary = false,
): Promise<{ ok: boolean; status: number; text: string; bytes?: ArrayBuffer; type: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) return { ok: false, status: res.status, text: "", type };
    if (binary)
      return { ok: true, status: res.status, text: "", bytes: await res.arrayBuffer(), type };
    return { ok: true, status: res.status, text: await res.text(), type };
  } catch (e) {
    return { ok: false, status: 0, text: `${(e as Error).message}`, type: "" };
  }
}

/** Absolute-ise and de-fragment every href on a page. */
function links(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const [, href, label] = m;
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    let abs: string;
    try {
      abs = new URL(href, base).toString();
    } catch {
      continue;
    }
    // Keep a PDF regardless of its label; keep an HTML page only if it looks
    // like a fees page worth one more hop.
    if (/\.pdf(\?|$)/i.test(abs) || LINK_HINT.test(href) || LINK_HINT.test(label)) out.add(abs);
  }
  return [...out];
}

function pdfText(bytes: ArrayBuffer): string {
  writeFileSync("/tmp/find-tariff.pdf", Buffer.from(bytes));
  return execFileSync("pdftotext", ["-layout", "/tmp/find-tariff.pdf", "-"], {
    encoding: "utf8",
    maxBuffer: 64e6,
  });
}

/** VERIFY, do not assume. A candidate is pinned only when it is really a PDF, it
 *  really yields text, and that text really discusses foreign currency. */
async function verify(
  url: string,
): Promise<{ ok: true; chars: number; hits: number } | { ok: false; why: string }> {
  const r = await get(url, true);
  if (!r.ok)
    return { ok: false, why: r.status ? `HTTP ${r.status}` : `fetch: ${r.text.slice(0, 60)}` };
  const buf = Buffer.from(r.bytes!);
  if (buf.subarray(0, 5).toString() !== "%PDF-")
    return { ok: false, why: `not a PDF (${r.type.split(";")[0] || "unknown type"})` };
  let text: string;
  try {
    text = pdfText(r.bytes!);
  } catch (e) {
    return { ok: false, why: `pdftotext failed: ${(e as Error).message.slice(0, 50)}` };
  }
  // THE GATE, and it is deliberately strict. An earlier version accepted any PDF
  // containing a foreign-currency WORD and promptly pinned ICS's
  // "Polisvoorwaarden Reisverzekering" — a travel-insurance policy — as the
  // tariff document for six credit cards. Counting term occurrences is the same
  // mistake as scoring a page by how many "%" characters its CSS contains: the
  // presence of a word is not evidence the document states a price.
  //
  // A tariff sheet reads "koersopslag 1,4%". An insurance policy says
  // "wisselkoers" in a sentence and never puts a rate beside it. So require a
  // PERCENTAGE within a short window of a foreign-currency term, which is the
  // signature of a priced row rather than prose.
  const hits = [...text.matchAll(FX_TERMS)];
  if (!hits.length)
    return {
      ok: false,
      why: `no foreign-currency terms (${Math.round(text.length / 1000)}k chars)`,
    };
  const priced = hits.filter((m) => {
    const at = m.index ?? 0;
    return /\d[\d.,]*\s?%/.test(text.slice(Math.max(0, at - 120), at + 160));
  });
  if (!priced.length) {
    return {
      ok: false,
      why: `${hits.length} fx term(s) but no rate beside any of them — prose, not a tariff`,
    };
  }
  // Reject the documents that pass the window test by accident: a policy or an
  // annual report can quote a rate in passing.
  if (/polisvoorwaarden|verzekering|jaarverslag|annual report|privacy|prospectus/i.test(url)) {
    return { ok: false, why: `filename says policy/report, not tariffs` };
  }
  return { ok: true, chars: text.length, hits: priced.length };
}

/** robots.txt names the sitemaps; the well-known paths cover publishers that do
 *  not. Nested sitemap indexes are followed one level, which is where the PDFs
 *  usually sit. */
async function sitemapPdfs(origin: string): Promise<string[]> {
  const roots = new Set<string>();
  const robots = await get(new URL("/robots.txt", origin).toString());
  if (robots.ok) {
    for (const m of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) roots.add(m[1].trim());
  }
  for (const guess of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]) {
    roots.add(new URL(guess, origin).toString());
  }
  const pdfs = new Set<string>();
  const seen = new Set<string>();
  let queue = [...roots].slice(0, 4);
  // Two passes: an index of sitemaps, then the sitemaps themselves.
  for (let depth = 0; depth < 2 && queue.length; depth++) {
    const next: string[] = [];
    for (const sm of queue.slice(0, 12)) {
      if (seen.has(sm)) continue;
      seen.add(sm);
      await sleep(GAP_MS);
      const r = await get(sm);
      if (!r.ok || !/<(urlset|sitemapindex)/i.test(r.text)) continue;
      for (const m of r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const u = m[1];
        if (/\.pdf(\?|$)/i.test(u)) {
          if (LINK_HINT.test(u)) pdfs.add(u);
          continue;
        }
        if (/sitemap[^/]*\.xml/i.test(u) && depth === 0) next.push(u);
      }
    }
    queue = next;
  }
  return [...pdfs];
}

// ---- group the watchlist by issuer -------------------------------------------
const byIssuer = new Map<string, { id: string; p: Product }[]>();
for (const [id, p] of Object.entries(state.products)) {
  if (only && !p.issuer.toLowerCase().includes(only.toLowerCase())) continue;
  if (!p.termsUrl) continue;
  const list = byIssuer.get(p.issuer) ?? [];
  list.push({ id, p });
  byIssuer.set(p.issuer, list);
}

const today = new Date().toISOString().slice(0, 10);
let pinned = 0,
  issuersDone = 0;
const report: string[] = [];

for (const [issuer, members] of byIssuer) {
  issuersDone++;
  // Already solved for this issuer? Then nothing to find.
  const existing = members.find((m) => m.p.pdfUrl)?.p.pdfUrl;
  if (existing) {
    report.push(`= ${issuer}: already pinned ${existing.slice(0, 70)}`);
    continue;
  }
  // A DELIBERATE UNPINNING MUST STICK. ICS's general terms were removed after
  // measurement — they refuse where the marketing page settles — and a consumer
  // agreement was removed from ten business products where it states the wrong
  // rate. Re-discovering them next run would undo both decisions silently, which
  // is worse than never having pinned them, because the reason is already written
  // down in pdfReason and would be contradicted by the file itself.
  const refused = members.filter((m) => m.p.pdfReason);
  if (refused.length === members.length) {
    report.push(
      `= ${issuer}: skipped, its document was deliberately unpinned (${String(refused[0].p.pdfReason).slice(0, 60)}…)`,
    );
    continue;
  }

  // Start from the fee-ish pages this issuer's products already point at.
  const seeds = [...new Set(members.map((m) => m.p.termsUrl!))].slice(0, 3);
  const candidates: string[] = [];
  const notes: string[] = [];

  for (const seed of seeds) {
    await sleep(GAP_MS);
    const page = await get(seed);
    if (!page.ok) {
      notes.push(`seed ${seed.slice(0, 50)}: ${page.status || page.text.slice(0, 40)}`);
      continue;
    }
    const found = links(page.text, seed);
    const pdfs = found.filter((u) => /\.pdf(\?|$)/i.test(u));
    // One hop: a "Tarieven" HTML page that itself links the PDF.
    const hops = found.filter((u) => !/\.pdf(\?|$)/i.test(u) && LINK_HINT.test(u)).slice(0, 4);
    candidates.push(...pdfs);
    if (useSitemap) {
      try {
        candidates.push(...(await sitemapPdfs(new URL(seed).origin)));
      } catch (e) {
        notes.push(`sitemap: ${(e as Error).message.slice(0, 40)}`);
      }
    }
    for (const h of hops) {
      await sleep(GAP_MS);
      const hp = await get(h);
      if (!hp.ok) continue;
      candidates.push(...links(hp.text, h).filter((u) => /\.pdf(\?|$)/i.test(u)));
    }
  }

  // Most-promising first, so verification stops early on the obvious winner.
  const ranked = [...new Set(candidates)].sort(
    (a, b) => Number(LINK_HINT.test(b)) - Number(LINK_HINT.test(a)),
  );
  if (!ranked.length) {
    report.push(
      `✗ ${issuer}: no PDF links found${notes.length ? ` — ${notes.join("; ").slice(0, 130)}` : " (seeds fetched, zero .pdf hrefs)"}`,
    );
    continue;
  }

  let hit: { url: string; chars: number; hits: number } | null = null;
  const tried: string[] = [];
  for (const url of ranked.slice(0, 6)) {
    await sleep(GAP_MS);
    const v = await verify(url);
    if (!v.ok) {
      tried.push(`${url.split("/").pop()?.slice(0, 34)}: ${v.why}`);
      continue;
    }
    hit = { url, chars: v.chars, hits: v.hits };
    break;
  }

  if (!hit) {
    report.push(
      `✗ ${issuer}: ${ranked.length} PDF(s), none usable — ${tried.slice(0, 2).join("; ")}`,
    );
    continue;
  }

  for (const m of members) {
    state.products[m.id].pdfUrl = hit.url;
    // NOT pdfCheckedAt: that field is the date the DOCUMENT states, which only the
    // sweep's reader can extract. Stamping it today would date a figure by when we
    // found its source rather than when the source said it — the exact bug the
    // date rule exists to prevent.
    state.products[m.id].pdfFoundAt = today;
  }
  pinned += members.length;
  report.push(
    `✓ ${issuer}: ${hit.url.slice(0, 84)}  (${Math.round(hit.chars / 1000)}k chars, ${hit.hits} priced fx row(s)) → ${members.length} product(s)`,
  );
}

console.log(report.join("\n"));
console.log(`\n${issuersDone} issuer(s) walked · ${pinned} product(s) newly pinned`);
if (!write) {
  console.log("--dry by default: nothing written. Pass --write to persist.");
  process.exit(0);
}
if (pinned === 0) {
  console.log("nothing to write.");
  process.exit(0);
}
writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
console.log(`wrote ${STATE}`);
