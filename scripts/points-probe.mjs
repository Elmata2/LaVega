#!/usr/bin/env node
// Points probe — self-test first (TDD): these cases were written before the
// functions below existed, and they are what the functions have to satisfy.

const CASES = [
  {
    name: "scanTerms finds a Dutch points rate and quotes the whole sentence",
    run: () => {
      const hits = scanTerms(
        "Blabla. Met uw business Gold Card spaart u 1 MR punt per uitgegeven euro. Enz.",
      );
      assert(hits.length === 1, `expected 1 hit, got ${hits.length}`);
      assert(
        hits[0].sentence === "Met uw business Gold Card spaart u 1 MR punt per uitgegeven euro.",
        `sentence was: ${hits[0].sentence}`,
      );
    },
  },
  {
    name: "scanTerms stays silent on a page that only says 'spaarrente'",
    run: () => {
      const hits = scanTerms("U ontvangt een aantrekkelijke spaarrente van 1,25% op jaarbasis.");
      assert(hits.length === 0, `expected no hit, got ${JSON.stringify(hits)}`);
    },
  },
  {
    name: "scanTerms does not mistake 'procentpunten' in an interest clause for a points programme",
    run: () => {
      const hits = scanTerms("De rente is 8,9 procentpunten boven de wettelijke rente.");
      assert(hits.length === 0, `expected no hit, got ${JSON.stringify(hits)}`);
    },
  },
  {
    name: "scanTerms reads the English 'for every euro spent' phrasing too",
    run: () => {
      // Amex's Dutch pages say "per uitgegeven euro", its Corporate pages say
      // this instead -- and a probe that only speaks Dutch reported those three
      // cards as having no rate at all.
      const a = scanTerms(
        "With the Corporate Card you can earn 1 Membership Reward (MR) for every euro spent.",
      );
      assert(a.length === 1, `Dutch-only probe missed the MR sentence: ${JSON.stringify(a)}`);
      const b = scanTerms(
        "For bookings with KLM, AIR FRANCE, Transavia and Hertz, you get 1.5 Miles for every euro spent.",
      );
      assert(b.length === 1, `Dutch-only probe missed the Miles sentence: ${JSON.stringify(b)}`);
    },
  },
  {
    name: "htmlToText drops script and style bodies",
    run: () => {
      const t = htmlToText(
        "<style>.a{cursor:pointer}</style><p>1 punt per euro</p><script>var x='punt'</script>",
      );
      assert(!t.includes("cursor"), `style leaked: ${t}`);
      assert(!t.includes("var x"), `script leaked: ${t}`);
      assert(t.includes("1 punt per euro"), `text lost: ${t}`);
    },
  },
];

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

function selfTest() {
  let failed = 0;
  for (const c of CASES) {
    try {
      c.run();
      console.log(`ok   ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${c.name}\n     ${e.message}`);
    }
  }
  console.log(failed ? `\n${failed} of ${CASES.length} failed` : `\nall ${CASES.length} passed`);
  return failed === 0;
}

// ---------------------------------------------------------------------------
// The probe itself.
//
// Why this exists: "does this card have a points programme" is a question you
// have to be able to ASK AGAIN. A programme can be launched (Revolut RevPoints)
// or killed (bunq Points stopped earning on 13 April 2026) between two sweeps,
// and a rate that is only in someone's memory is a rumour. So this walks the
// provider's own page or PDF and reports the sentences that mention earning
// points -- and reports silence as silence, which is the answer for most
// Dutch cards.
//
// It reads no API and writes nothing: curl + pdftotext + these regexes.
//
//   node scripts/points-probe.mjs --self-test
//   node scripts/points-probe.mjs <url> [url...]
//   node scripts/points-probe.mjs --verify scripts/points-mainstream.json
//
// --verify re-reads every sourceUrl in the lane file and flags two kinds of
// drift: an entry that claims a rate whose sentence is gone, and an entry that
// claims "no programme" on a page that has since started talking about points.
// ---------------------------------------------------------------------------

// Words that mean "you earn something per euro spent". Deliberately narrow:
// "spaarrente" (interest on a credit balance) and "procentpunten" (an interest
// clause) are NOT loyalty points, and reading them as points is exactly the
// mistake that would put a fake number in the catalogue. The narrowness IS the
// safeguard -- there is no separate blocklist, because the two cases above only
// ever match if someone loosens these patterns, which is what the self-test
// cases are there to catch.
const EARN = [
  /\b\d+([.,]\d+)?\s*(membership rewards\s*)?punt(en)?\s*(per|voor (elke|iedere))/i,
  /\bpunt(en)?\s*per\s*(uitgegeven\s*|besteed[e]?\s*)?(euro|€)/i,
  /\b\d+([.,]\d+)?\s*mile(s)?\s*(per|voor (elke|iedere))/i,
  /\bmile(s)?\s*per\s*(uitgegeven\s*|besteed[e]?\s*)?(euro|€)/i,
  /\bpoints?\s*per\s*(€\s*)?1?\s*(euro)?\s*spent/i,
  /\b\d+([.,]\d+)?\s*(membership rewards?|mile|point)s?\b[^.!?]{0,40}\bfor every euro\b/i,
  /\b(spaar|verdien|ontvang)t?\s*u?\s*\d+([.,]\d+)?\s*(punt|mile|point)/i,
  /\b(membership rewards|flying blue|revpoints|air miles|anwb-punten)\b.{0,60}\bper\b.{0,20}(euro|€)/i,
];

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&euro;/g, "€")
    .replace(/&#8364;/g, "€")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t ]+/g, " ");
}

export function sentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function scanTerms(text) {
  const out = [];
  for (const sentence of sentences(text)) {
    const pattern = EARN.find((re) => re.test(sentence));
    if (pattern) out.push({ sentence, pattern: String(pattern) });
  }
  return out;
}

async function fetchText(url) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  const tmp = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "points-")), "body");
  const { stdout: code } = await run("curl", [
    "-sS",
    "-L",
    "--max-time",
    "90",
    "-A",
    ua,
    "-o",
    tmp,
    "-w",
    "%{http_code}",
    url,
  ]);
  const head = await fs.readFile(tmp).then((b) => b.subarray(0, 5).toString("latin1"));
  if (head.startsWith("%PDF")) {
    // A PDF read as HTML is binary noise, and binary noise never matches a
    // regex -- which would silently report "no points programme". So: pdftotext.
    const { stdout } = await run("pdftotext", ["-layout", tmp, "-"]);
    return { code, text: stdout, kind: "pdf" };
  }
  const html = await fs.readFile(tmp, "utf8");
  return { code, text: htmlToText(html), kind: "html" };
}

async function probe(urls) {
  for (const url of urls) {
    const { code, text, kind } = await fetchText(url);
    const hits = scanTerms(text);
    console.log(
      `\n=== ${url}\n    HTTP ${code} · ${kind} · ${text.length} chars · ${hits.length} hit(s)`,
    );
    for (const h of hits) console.log(`  * ${h.sentence}`);
    if (!hits.length)
      console.log("  (geen puntenkoers op deze bron — stilte is hier het antwoord)");
  }
}

async function verify(file) {
  const fs = await import("node:fs/promises");
  const doc = JSON.parse(await fs.readFile(file, "utf8"));
  const seen = new Map();
  let drift = 0;
  for (const e of doc.entries) {
    if (!e.sourceUrl) continue;
    if (!seen.has(e.sourceUrl))
      seen.set(e.sourceUrl, await fetchText(e.sourceUrl).catch((err) => ({ error: err })));
    const got = seen.get(e.sourceUrl);
    if (got.error) {
      console.log(`?? ${e.id} — bron onbereikbaar: ${got.error.message}`);
      continue;
    }
    const hits = scanTerms(got.text);
    const claimsRate = typeof e.pointsPerEuro === "number" && e.pointsPerEuro > 0;
    if (claimsRate && !hits.length) {
      drift++;
      console.log(
        `!! ${e.id} — claimt ${e.pointsPerEuro} ${e.unit} per euro, maar de bron noemt nu geen koers`,
      );
    } else if (e.programmeStatus === "none" && hits.length) {
      drift++;
      console.log(
        `!! ${e.id} — stond als "geen programma", maar de bron zegt nu: ${hits[0].sentence}`,
      );
    } else {
      console.log(`ok ${e.id}`);
    }
  }
  console.log(
    drift ? `\n${drift} afwijking(en) — de catalogus loopt achter` : "\ngeen afwijkingen",
  );
  return drift === 0;
}

const argv = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!argv.length || argv[0] === "--help") {
    console.log("usage: points-probe.mjs [--self-test | --verify <lane.json> | <url>...]");
  } else if (argv[0] === "--self-test") {
    process.exit(selfTest() ? 0 : 1);
  } else if (argv[0] === "--verify") {
    process.exit((await verify(argv[1] ?? "scripts/points-mainstream.json")) ? 0 : 1);
  } else {
    await probe(argv);
  }
}
