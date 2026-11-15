/**
 * Bundel de banklogo's — tijdens een sweep, nooit tijdens runtime.
 *
 *   pnpm exec tsx scripts/bundle-bank-logos.ts
 *   pnpm exec tsx scripts/bundle-bank-logos.ts --dry            # rapporteer, schrijf niets
 *   pnpm exec tsx scripts/bundle-bank-logos.ts --only ing,knab  # één of een paar
 *   pnpm exec tsx scripts/bundle-bank-logos.ts --all            # ook merken die (nog) geen rekeningnaam zijn
 *
 * WAAROM DIT BUITEN DE APP LOOPT. Het bezwaar tegen banklogo's was nooit "geen
 * plaatjes", het was "niets ophalen tijdens runtime": een logo-request vertelt
 * die server bij wie de gebruiker bankiert, en de volgorde van die requests
 * vertelt hem hoeveel rekeningen er zijn. Haal je ze hier op, in een sweep, en
 * leg je ze in de bundel, dan bestaat dat verzoek in de browser niet. Precies
 * hoe de catalogus zelf werkt: bij ons opgehaald, in de bundel meegeleverd, in
 * de browser niets. De uitvoer is een gegenereerd bestand dat gecommit wordt en
 * elke wijziging is een leesbare git-diff.
 *
 * WAAR DE DOMEINEN VANDAAN KOMEN. Niet uit een lijst die ik verzin: uit de
 * `sourceUrl`s in docs/catalog/catalog.json. Dat zijn de documenten waar de
 * cijfers in de catalogus al op leunen, dus het is per definitie het domein van
 * de aanbieder zelf. Staat een merk in de tabel hieronder maar niet meer in de
 * catalogus, dan stopt de sweep daarop met een melding — geen stille afwijking.
 *
 * WAT HET NOOIT DOET.
 *  - Geen placeholder van een andere bank. Een uitgever zonder leesbaar logo
 *    valt terug op de bestaande kaartkleuren en de banknaam. Een verkeerd logo
 *    is erger dan geen logo, dus bij twijfel: overslaan en het melden.
 *  - Geen og:image per product. Een favicon per uitgever is tientallen kB; een
 *    poster per product blaast de bundel op voor sier. Vandaar MAX_BYTES.
 *  - Geen favicon-dienst van een derde partij (Google, DuckDuckGo). Dat zou de
 *    sweep van ons naar hen verplaatsen en de lijst met banken die wij dekken
 *    aan een derde geven.
 *
 * MERKENRECHT. Een logo gebruiken om het product te identificeren mag
 * doorgaans, maar het hoort met een regel dat de merken van hun eigenaren zijn.
 * Die regel schrijft dit script mee in apps/web/src/assets/TRADEMARKS.md, met
 * per merk de bron-URL en de datum. Op de werkende schermen staat hij niet —
 * dat is een eerdere beslissing (docs/BACKLOG.md: "Disclaimers en voorwaarden
 * horen bij de launch, niet in het werkende scherm") en die staat hier niet ter
 * discussie; de tekst hoort op de juridische/over-pagina bij launch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CATALOG = "docs/catalog/catalog.json";
const ASSETS = "apps/web/src/assets";
const OUT_TS = `${ASSETS}/bank-logos.generated.ts`;
const OUT_NOTICE = `${ASSETS}/TRADEMARKS.md`;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
/** Per logo. Een favicon zit hier ruim onder; een apple-touch-icon van 512px of
 *  een og:image zit erboven en wordt dus geweigerd. Dat is de bedoeling. */
const MAX_BYTES = 24_000;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const all = args.includes("--all");
const onlyList = (args.includes("--only") ? args[args.indexOf("--only") + 1] : "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

/* --- de merken -----------------------------------------------------------
 * `aliases` zijn de namen zoals LaVega ZELF ze in `account.bank` kan zetten:
 * uit de CSV-profielen, uit de IBAN-prefix-tabel, of uit de ASPSP-naam van
 * Enable Banking. Genormaliseerd (kleine letters, geen leestekens) en zonder
 * rechtsvorm — "ING Bank N.V." en "Coöperatieve Rabobank U.A." komen als "ing"
 * en "rabobank" binnen bij de matcher in KaartenBlock.
 * `domain` moet in catalog.json voorkomen; anders faalt de sweep. */
type Brand = {
  slug: string;
  label: string;
  domain: string;
  aliases: string[];
  /** Extra hosts op HETZELFDE registreerbare domein, alleen gebruikt als de
   *  homepage niets bruikbaars geeft. Rabobank's www weigert elk verzoek dat
   *  niet uit een echte browser komt (403 op de pagina, 404 op /favicon.ico);
   *  hun bankieromgeving op datzelfde domein serveert het icoon wel. Nog steeds
   *  de aanbieder zelf, dus de regel blijft overeind. */
  probe?: string[];
};

const BRANDS: Brand[] = [
  {
    /* RegioBank staat hier en SNS/ASN niet, en dat verschil is gemeten: het CMS van
     * de Volksbank serveert voor alle drie hetzelfde beeld (en regiobank.nl geeft
     * zelfs 200 met 0 bytes), maar Wikimedia Commons heeft RegioBank apart als merk
     * terwijl er voor SNS en ASN geen logo te vinden was — alleen foto's en PDF's.
     *
     * LET OP DE LICENTIE: CC BY-SA 4.0, dus naamsvermelding is een VERPLICHTING en
     * geen nettigheid. Die staat in TRADEMARKS.md. Ophalen gebeurt tijdens de
     * sweep, dus in de browser wordt nog steeds niets opgehaald. */
    slug: "regiobank",
    label: "RegioBank",
    domain: "regiobank.nl",
    aliases: ["regiobank"],
    probe: ["https://upload.wikimedia.org/wikipedia/commons/0/0d/Regiobank-logo-2023.svg"],
  },
  { slug: "ing", label: "ING", domain: "ing.com", aliases: ["ing"] },
  { slug: "abnamro", label: "ABN AMRO", domain: "abnamro.nl", aliases: ["abnamro"] },
  {
    slug: "rabobank",
    label: "Rabobank",
    domain: "rabobank.nl",
    aliases: ["rabobank"],
    probe: ["https://bankieren.rabobank.nl/favicon.ico"],
  },
  { slug: "knab", label: "Knab", domain: "knab.nl", aliases: ["knab"] },
  { slug: "bunq", label: "bunq", domain: "bunq.com", aliases: ["bunq"] },
  { slug: "triodos", label: "Triodos", domain: "triodos.nl", aliases: ["triodos"] },
  { slug: "nn", label: "NN", domain: "nn.nl", aliases: ["nn", "nationalenederlanden"] },
  {
    slug: "revolut",
    label: "Revolut",
    domain: "revolut.com",
    aliases: ["revolut"],
    /* revolut.com geeft 403 op ELK eigen pad — pagina, favicon, subdomeinen — dus
     * de bron van de merkhouder is dicht. Wikimedia Commons draagt hetzelfde merk
     * met een vermelde licentie (File:Revolut.svg, publiek domein), en ophalen bij
     * een derde is hier verdedigbaar omdat het tijdens de SWEEP gebeurt: in de
     * browser wordt nog steeds niets opgehaald. De licentie staat in TRADEMARKS.md,
     * want een logo bundelen zonder de herkomst te noemen is de fout die dit hele
     * bestand probeert te vermijden. */
    probe: ["https://upload.wikimedia.org/wikipedia/commons/d/d6/Revolut.svg"],
  },
  {
    slug: "americanexpress",
    label: "American Express",
    domain: "americanexpress.com",
    aliases: ["americanexpress", "amex"],
  },
  { slug: "trading212", label: "Trading 212", domain: "trading212.com", aliases: ["trading212"] },
  { slug: "n26", label: "N26", domain: "n26.com", aliases: ["n26"] },
  { slug: "wise", label: "Wise", domain: "wise.com", aliases: ["wise"] },
  {
    slug: "ics",
    label: "International Card Services",
    domain: "icscards.nl",
    aliases: ["ics", "icscards", "internationalcardservices"],
  },
];

/* Uitgevers die WEL in de catalogus staan en bewust GEEN logo krijgen, met de
 * reden en de dag dat het is nagekeken. Een lege plek met een reden is beter dan
 * een plaatje dat het merk niet identificeert.
 *
 * de Volksbank (SNS, ASN Bank, RegioBank) serveert vanuit één CMS voor alle drie
 * de merken exact hetzelfde icoon — op 20-08-2026 byte-identiek gecontroleerd op
 * 16x16, 32x32 en 96x96: een oranje eekhoorn. Dat is dus een groepsicoon, geen
 * merkicoon, en welk van de drie het zou identificeren valt uit hun eigen
 * pagina's niet aan te tonen. Alle drie overslaan tot iemand het per merk kan
 * aantonen (bijvoorbeeld uit hun eigen merkrichtlijnen). */
const NO_LOGO: { domain: string; label: string; reason: string }[] = [
  {
    domain: "snsbank.nl",
    label: "SNS",
    reason:
      "snsbank.nl, asnbank.nl en regiobank.nl serveren byte-identieke icons (de Volksbank, één CMS) — niet toe te wijzen aan één merk",
  },
  {
    domain: "asnbank.nl",
    label: "ASN",
    reason: "zelfde de Volksbank-icoon als SNS en RegioBank — identificeert het merk niet",
  },
];

/* Hosts die in catalog.json staan maar niet van de aanbieder zijn. Een logo van
 * het archief of van een headless CMS is niet het logo van de bank. */
const NOT_THE_PROVIDER = new Set(["web.archive.org", "assets-eu-01.kc-usercontent.com"]);

/** eTLD+1, naïef maar genoeg: alles in de catalogus is .nl, .com, .eu, .app of
 *  .capital — geen enkele samengestelde TLD zoals .co.uk. */
function registrable(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

type CatalogEntry = { id: string; issuer: string; fields: Record<string, { sourceUrl?: string }> };

function readCatalog(): CatalogEntry[] {
  const raw = JSON.parse(readFileSync(CATALOG, "utf8")) as { entries: CatalogEntry[] };
  return raw.entries;
}

/** De domeinen van de aanbieder per productid, uit de bronnen die de catalogus
 *  al citeert. */
function domainsPerEntry(entries: CatalogEntry[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of entries) {
    const set = new Set<string>();
    for (const f of Object.values(e.fields ?? {})) {
      if (!f?.sourceUrl) continue;
      let host = "";
      try {
        host = new URL(f.sourceUrl).host;
      } catch {
        continue;
      }
      if (NOT_THE_PROVIDER.has(host)) continue;
      set.add(registrable(host));
    }
    out.set(e.id, set);
  }
  return out;
}

async function get(url: string): Promise<{ res: Response; body: Buffer } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return { res, body: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return null;
  }
}

/** Het formaat wordt uit de BYTES gelezen, niet uit de content-type-header en
 *  niet uit de extensie. Een 404-pagina die als image/png wordt aangeboden is
 *  geen logo, en die komt vaker voor dan je hoopt. */
function sniff(body: Buffer): string | null {
  if (body.length < 8) return null;
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (body[0] === 0xff && body[1] === 0xd8) return "image/jpeg";
  if (
    body.subarray(0, 4).toString("ascii") === "RIFF" &&
    body.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  if (body.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (body[0] === 0x00 && body[1] === 0x00 && body[2] === 0x01 && body[3] === 0x00)
    return "image/x-icon";
  const head = body.subarray(0, 2000).toString("utf8").trim().toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg"))
    return head.includes("<svg") ? "image/svg+xml" : null;
  return null;
}

type Candidate = { url: string; why: string };

/** favicon → apple-touch-icon → og:image, in die volgorde: een favicon is klein
 *  en stabiel, een apple-touch-icon is groot, en een og:image is een plaatje
 *  voor sociale media dat vaak niet eens het merk toont. */
function candidatesFrom(html: string, base: string): Candidate[] {
  const icons: { url: string; sizes: string; type: string }[] = [];
  const apple: string[] = [];
  const og: string[] = [];

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (tag.match(/\brel\s*=\s*["']?([^"'>]+)/i)?.[1] ?? "").toLowerCase();
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)/i)?.[1];
    if (!href || !/\bicon\b/.test(rel)) continue;
    // mask-icon (Safari's pinned tab) is een ÉÉNKLEURIG silhouet. Op een kaart
    // is dat een zwarte vlek in plaats van een merk, dus die telt niet mee.
    if (rel.includes("mask-icon")) continue;
    const abs = absolute(href, base);
    if (!abs) continue;
    if (rel.includes("apple-touch")) apple.push(abs);
    else
      icons.push({
        url: abs,
        sizes: (tag.match(/\bsizes\s*=\s*["']?([^"'>]+)/i)?.[1] ?? "").toLowerCase(),
        type: (tag.match(/\btype\s*=\s*["']?([^"'>]+)/i)?.[1] ?? "").toLowerCase(),
      });
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const prop = (tag.match(/\b(?:property|name)\s*=\s*["']?([^"'>]+)/i)?.[1] ?? "").toLowerCase();
    if (prop !== "og:image") continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)/i)?.[1];
    const abs = content ? absolute(content, base) : null;
    if (abs) og.push(abs);
  }

  // SVG eerst (klein én scherp), dan de kleinste opgegeven maat, dan de rest.
  icons.sort((a, b) => rank(a) - rank(b));
  return [
    ...icons.map((i) => ({ url: i.url, why: "favicon" })),
    { url: new URL("/favicon.ico", base).toString(), why: "favicon.ico" },
    ...apple.map((u) => ({ url: u, why: "apple-touch-icon" })),
    ...og.map((u) => ({ url: u, why: "og:image" })),
  ];
}

/** Volgorde: SVG (klein én scherp), dan een PNG van 32-64 px (scherp op een
 *  retina-scherm en nog steeds een paar kB), dan 16 px, dan de rest. */
function rank(i: { url: string; sizes: string; type: string }): number {
  if (i.type.includes("svg") || /\.svg(\?|$)/.test(i.url)) return 0;
  const n = Number(i.sizes.split("x")[0]);
  if (!Number.isFinite(n) || n <= 0) return 4;
  if (n >= 32 && n <= 64) return 1;
  if (n < 32) return 2;
  return 3;
}

function absolute(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

type Logo = {
  slug: string;
  label: string;
  aliases: string[];
  dataUri: string;
  sourceUrl: string;
  fetchedAt: string;
  bytes: number;
  why: string;
};

async function fetchLogo(brand: Brand, today: string): Promise<Logo | { skipped: string }> {
  const home = `https://${brand.domain}/`;
  const page = await get(home);
  const candidates: Candidate[] = [
    ...(page
      ? candidatesFrom(page.body.toString("utf8"), page.res.url || home)
      : [{ url: `https://www.${brand.domain}/favicon.ico`, why: "favicon.ico" }]),
    /* Een probe-URL was oorspronkelijk altijd een ander pad op het domein van de
     * merkhouder zelf, en het label zei dat ook. Sinds Revolut zijn eigen host op
     * elk pad met 403 dichtgooit staat er ook een Wikimedia-URL in, en dan is
     * "ander eigen host" onwaar — in een document dat juist de HERKOMST van een
     * merk moet vastleggen. Dus wordt het label uit de URL afgeleid in plaats van
     * aangenomen. */
    ...(brand.probe ?? []).map((url) => ({
      url,
      why: new URL(url).hostname.endsWith("wikimedia.org")
        ? "Wikimedia Commons — zie de licentietabel onderaan"
        : "favicon (ander pad op het eigen domein)",
    })),
  ];

  const tried: string[] = [];
  for (const c of candidates.slice(0, 8)) {
    const got = await get(c.url);
    if (!got) {
      tried.push(`${c.url} → niet bereikbaar`);
      continue;
    }
    const mime = sniff(got.body);
    if (!mime) {
      tried.push(`${c.url} → geen leesbaar plaatje`);
      continue;
    }
    if (got.body.length > MAX_BYTES) {
      tried.push(`${c.url} → ${Math.round(got.body.length / 1024)} kB, te groot`);
      continue;
    }
    return {
      slug: brand.slug,
      label: brand.label,
      aliases: brand.aliases,
      dataUri: `data:${mime};base64,${got.body.toString("base64")}`,
      sourceUrl: got.res.url || c.url,
      fetchedAt: today,
      bytes: got.body.length,
      why: c.why,
    };
  }
  return { skipped: tried.length ? tried.join("; ") : "geen kandidaten op de eigen pagina" };
}

function tsFile(logos: Logo[], byCatalogId: Record<string, string>): string {
  const rows = logos
    .map(
      (l) =>
        `  {\n` +
        `    slug: ${JSON.stringify(l.slug)},\n` +
        `    label: ${JSON.stringify(l.label)},\n` +
        `    aliases: ${JSON.stringify(l.aliases)},\n` +
        `    sourceUrl: ${JSON.stringify(l.sourceUrl)},\n` +
        `    fetchedAt: ${JSON.stringify(l.fetchedAt)},\n` +
        `    bytes: ${l.bytes},\n` +
        `    dataUri:\n      ${JSON.stringify(l.dataUri)},\n` +
        `  },`,
    )
    .join("\n");
  const ids = Object.entries(byCatalogId)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, slug]) => `  ${JSON.stringify(id)}: ${JSON.stringify(slug)},`)
    .join("\n");

  return `/* GEGENEREERD door scripts/bundle-bank-logos.ts — niet met de hand aanpassen.
 *
 * Elk logo is tijdens een SWEEP bij de aanbieder zelf opgehaald en hier als
 * data-URI neergelegd. In de browser wordt er dus niets opgehaald: een
 * logo-request zou die server vertellen bij wie de gebruiker bankiert.
 *
 * \`sourceUrl\` is waar dit exacte bestand vandaan kwam en \`fetchedAt\` is de dag
 * dat wij het lazen — dezelfde discipline als de catalogus.
 *
 * Een uitgever zonder leesbaar logo staat hier NIET, en krijgt in de UI geen
 * placeholder van een andere bank: een verkeerd logo is erger dan geen logo.
 *
 * De merken zijn van hun eigenaren — zie TRADEMARKS.md in deze map.
 */

export type BankLogo = {
  /** Stabiele sleutel per merk. */
  slug: string;
  /** Hoe het merk zichzelf schrijft. */
  label: string;
  /** \`account.bank\`, genormaliseerd en zonder rechtsvorm. */
  aliases: string[];
  sourceUrl: string;
  fetchedAt: string;
  bytes: number;
  dataUri: string;
};

export const BANK_LOGOS: BankLogo[] = [
${rows}
];

/** Productid uit docs/catalog/catalog.json → merk. Zo kan een productlijst
 *  hetzelfde gebundelde logo gebruiken zonder een tweede sweep. */
export const LOGO_BY_CATALOG_ID: Record<string, string> = {
${ids}
};
`;
}

function noticeFile(
  logos: Logo[],
  skipped: { label: string; reason: string }[],
  today: string,
): string {
  const rows = logos
    .map(
      (l) =>
        `| ${l.label} | \`${l.slug}\` | ${l.why} | ${l.bytes} | ${l.fetchedAt} | ${l.sourceUrl} |`,
    )
    .join("\n");
  return `# Merken en logo's

_Gegenereerd door \`scripts/bundle-bank-logos.ts\` op ${today}. Niet met de hand aanpassen._

**De genoemde merken, handelsnamen en logo's zijn eigendom van hun respectieve
eigenaren. LaVega is niet aangesloten bij, en wordt niet gesponsord of
onderschreven door, een van deze partijen. De logo's worden uitsluitend gebruikt
om het product of de rekening van de gebruiker te identificeren (nominatief
gebruik).**

Deze regel hoort bij launch op de juridische/over-pagina te staan. Op de
werkende schermen staat hij bewust niet — zie \`docs/BACKLOG.md\`: disclaimers en
voorwaarden horen bij de launch, niet in het werkende scherm.

Elk logo is tijdens een sweep bij de aanbieder zelf opgehaald en als data-URI in
de bundel gelegd. De browser haalt niets op. Verwijderverzoek van een
rechthebbende: haal de regel uit \`BRANDS\` in het script en laat de sweep
opnieuw lopen — het logo verdwijnt dan uit de bundel.

| Merk | slug | Gevonden als | Bytes | Gelezen op | Bron |
| --- | --- | --- | --- | --- | --- |
${rows}

## Bewust geen logo

Deze uitgevers staan wel in de catalogus maar krijgen géén logo. Ze vallen in de
UI terug op de banknaam en de kaartkleuren — nooit op het logo van een andere
bank, want een verkeerd logo is erger dan geen logo.

${skipped.length ? skipped.map((s) => `- **${s.label}** — ${s.reason}`).join("\n") : "_(geen)_"}
`;
}

async function main() {
  const entries = readCatalog();
  const perEntry = domainsPerEntry(entries);
  const catalogDomains = new Set<string>();
  for (const set of perEntry.values()) for (const d of set) catalogDomains.add(d);

  let brands = BRANDS;
  if (all) {
    const known = new Set(BRANDS.map((b) => b.domain));
    for (const d of [...catalogDomains].sort()) {
      if (known.has(d)) continue;
      const slug = d.replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]/g, "");
      // Geen alias: dit merk kan (nog) geen `account.bank` zijn, dus het logo is
      // er voor een productlijst, niet voor een kaart.
      brands = [...brands, { slug, label: d, domain: d, aliases: [] }];
    }
  }
  const skipped: { label: string; reason: string }[] = [];
  const noLogo = new Set(NO_LOGO.map((n) => n.domain));
  brands = brands.filter((b) => !noLogo.has(b.domain));
  for (const n of NO_LOGO) skipped.push({ label: n.label, reason: n.reason });
  if (onlyList.length) brands = brands.filter((b) => onlyList.includes(b.slug));

  const missing = brands.filter((b) => !catalogDomains.has(b.domain));
  if (missing.length) {
    console.error(
      `Deze merken staan in de tabel maar hun domein staat niet meer in ${CATALOG}: ` +
        missing.map((b) => `${b.slug} (${b.domain})`).join(", ") +
        `\nDe catalogus is de bron. Pas de tabel aan of laat de catalogus-sweep eerst lopen.`,
    );
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const logos: Logo[] = [];
  for (const brand of brands) {
    const got = await fetchLogo(brand, today);
    if ("skipped" in got) {
      console.log(`— ${brand.slug}: GEEN logo (geen placeholder) — ${got.skipped}`);
      skipped.push({ label: brand.label, reason: got.skipped });
      continue;
    }
    logos.push(got);
    console.log(`✓ ${brand.slug}: ${got.why}, ${got.bytes} bytes — ${got.sourceUrl}`);
  }

  /* Twee merken met exact hetzelfde plaatje betekent dat het plaatje geen van de
   * twee identificeert — een gedeeld CMS-icoon, een groepslogo of een default.
   * Dan gaan ze er BEIDE uit: één ervan zou het logo van de ander dragen en dat
   * is precies de fout die we niet mogen maken. Dit ving de Volksbank-drieling. */
  const byBytes = new Map<string, Logo[]>();
  for (const l of logos) byBytes.set(l.dataUri, [...(byBytes.get(l.dataUri) ?? []), l]);
  const collided = new Set<string>();
  for (const group of byBytes.values()) {
    if (group.length < 2) continue;
    const names = group.map((g) => g.label).join(", ");
    for (const g of group) {
      collided.add(g.slug);
      skipped.push({
        label: g.label,
        reason: `identiek plaatje als ${names} — identificeert het merk niet`,
      });
      console.log(`— ${g.slug}: GEEN logo, want byte-identiek aan ${names}`);
    }
  }
  const kept = logos.filter((l) => !collided.has(l.slug));
  logos.length = 0;
  logos.push(...kept);

  const bySlugDomain = new Map(brands.map((b) => [b.domain, b.slug]));
  const haveSlug = new Set(logos.map((l) => l.slug));
  const byCatalogId: Record<string, string> = {};
  for (const [id, domains] of perEntry) {
    for (const d of domains) {
      const slug = bySlugDomain.get(d);
      if (slug && haveSlug.has(slug)) {
        byCatalogId[id] = slug;
        break;
      }
    }
  }

  const total = logos.reduce((n, l) => n + l.bytes, 0);
  console.log(
    `\n${logos.length}/${brands.length} merken, ${Math.round(total / 1024)} kB ruw ` +
      `(≈ ${Math.round((total * 4) / 3 / 1024)} kB base64), ${Object.keys(byCatalogId).length} producten gekoppeld.`,
  );

  if (dry) {
    console.log("--dry: niets geschreven.");
    return;
  }
  if (!logos.length) {
    console.error("Geen enkel logo gelezen — dan schrijf ik de bundel niet leeg over.");
    process.exit(1);
  }
  if (onlyList.length && existsSync(OUT_TS)) {
    console.error(
      "--only schrijft niet: dat zou de andere merken uit de bundel gooien. Gebruik het met --dry om te kijken.",
    );
    process.exit(1);
  }
  mkdirSync(ASSETS, { recursive: true });
  writeFileSync(OUT_TS, tsFile(logos, byCatalogId));
  writeFileSync(OUT_NOTICE, noticeFile(logos, skipped, today));
  console.log(`Geschreven: ${OUT_TS} en ${OUT_NOTICE}`);
}

await main();
