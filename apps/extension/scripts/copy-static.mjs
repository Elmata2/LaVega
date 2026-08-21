/* De tweede helft van `pnpm build`. tsc heeft dan de .js-bestanden in dist/
 * gezet; hier komt alles bij wat geen TypeScript is, en daarna wordt er
 * GECONTROLEERD of er iets in dist staat dat Chrome kan laden.
 *
 * WAAROM DIT MEER DOET DAN KOPIËREN. Een extensie faalt niet met een stacktrace
 * maar met een grijs vlak in chrome://extensions en een regel als "Could not
 * load icon 'icons/icon16.png'". Dan is de hele extensie onlaadbaar, ook de
 * negentig procent die wél klopt, en je ziet het pas als je hem probeert te
 * installeren. Elke controle hieronder is een fout die anders daar terechtkomt:
 *
 *   1. verwijst het manifest naar een bestand dat niet bestaat?
 *   2. is content.js per ongeluk een ES-module geworden? (dan doet het content
 *      script niets, met de fout alleen in de console van de WINKELPAGINA)
 *   3. staat er in de bundel iets dat het netwerk op gaat?
 *   4. loopt de sitelijst in het manifest nog gelijk met src/sites.ts, en wijst
 *      elk patroon een PAD aan en niet een heel domein?
 *
 * Controle 3 heeft in de eerste versie groen gemeld terwijl er iets doorheen
 * kwam. Hij keek alleen naar `.js`, en public/ levert ook .html, .css en JSON
 * mee: een @font-face naar fonts.gstatic.com, een background-image naar een
 * vreemd domein en een 1x1-pixel met het bedrag in de querystring gingen alle
 * drie mee de bundel in, waarna de build afsloot met "ok". Een poort die groen
 * meldt terwijl er iets doorheen komt is erger dan geen poort, want hij wordt
 * geloofd. Vandaar de zelftest onderaan controle 3: die laat de poort bij elke
 * build opzettelijk afgaan op precies die drie gevallen, en laat hem zwijgen op
 * de bestanden die er nu echt in zitten.
 *
 * De vierde is de sluipendste. optional_host_permissions staat in JSON en kan
 * sites.ts niet importeren, dus de twee lijsten zijn met de hand gelijkgehouden.
 * Voeg je een winkel toe aan sites.ts en vergeet je het manifest, dan komt de
 * fout pas naar boven op het moment dat een gebruiker het vinkje aanzet en
 * Chrome het verzoek weigert — met een melding die niets over de oorzaak zegt.
 *
 * Draaien gebeurt via `pnpm build`; los kan met `node scripts/copy-static.mjs`,
 * maar dan moet tsc er al overheen zijn geweest. */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve, relative } from "node:path";
import { maakIcoon, ICOON_MATEN } from "./icon-png.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const WORTEL = resolve(HIER, "..");
const PUBLIC = join(WORTEL, "public");
const DIST = join(WORTEL, "dist");

const fouten = [];
const gedaan = [];

function eis(voorwaarde, bericht) {
  if (!voorwaarde) fouten.push(bericht);
}

/* ── 0. is tsc er wel overheen geweest? ─────────────────────────────────────── */

if (!existsSync(join(DIST, "background.js"))) {
  console.error(
    "[copy-static] dist/background.js ontbreekt. Draai eerst `tsc -p tsconfig.build.json`,\n" +
      "              of gebruik `pnpm build` dat allebei doet.",
  );
  process.exit(1);
}

/* ── 1. de statische bestanden ─────────────────────────────────────────────── */

mkdirSync(DIST, { recursive: true });
cpSync(PUBLIC, DIST, { recursive: true });
gedaan.push(`public/ → dist/ (${readdirSync(PUBLIC).length} bestanden)`);

/* ── 2. de iconen, tijdens de build gemaakt en niet opgehaald ──────────────── */

const ICONEN = join(DIST, "icons");
mkdirSync(ICONEN, { recursive: true });
let iconBytes = 0;
for (const maat of ICOON_MATEN) {
  const png = maakIcoon(maat);
  writeFileSync(join(ICONEN, `icon${maat}.png`), png);
  iconBytes += png.length;
}
gedaan.push(`${ICOON_MATEN.length} iconen gemaakt (${iconBytes} bytes samen)`);

/* ── 3. verwijst het manifest naar bestanden die bestaan? ──────────────────── */

const manifestPad = join(DIST, "manifest.json");
eis(existsSync(manifestPad), "dist/manifest.json ontbreekt — public/manifest.json is niet gekopieerd.");

let manifest = null;
if (existsSync(manifestPad)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPad, "utf8"));
  } catch (e) {
    fouten.push(`manifest.json is geen geldige JSON: ${e.message}`);
  }
}

if (manifest) {
  /* Alle padverwijzingen die Chrome bij het laden meteen naloopt. Een verzonnen
   * verwijzing hier maakt de hele extensie onlaadbaar. */
  const verwijzingen = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.background?.service_worker,
  ].filter(Boolean);

  /* Het content script staat niet in het manifest maar wordt tijdens het draaien
   * geregistreerd (zie background.ts). Chrome merkt een ontbrekend bestand dan
   * pas als de gebruiker een winkel aanzet, dus controleren we het hier. */
  verwijzingen.push("content.js");

  const voorVerwijzingen = fouten.length;
  for (const p of verwijzingen) {
    eis(existsSync(join(DIST, p)), `manifest verwijst naar ${p}, maar dist/${p} bestaat niet.`);
  }
  /* Alleen "ok" melden als het ook ok wás. Een regel die met "ok —" begint terwijl
   * er twee regels lager een FOUT staat over hetzelfde, is hoe iemand een build
   * gaat geloven die hij niet moet geloven. */
  if (fouten.length === voorVerwijzingen) gedaan.push(`${verwijzingen.length} manifestverwijzingen nagelopen`);

  eis(manifest.manifest_version === 3, "manifest_version moet 3 zijn.");

  /* Chrome kapt een te lange beschrijving niet af maar weigert de extensie. 132
   * tekens; deze controle staat er omdat de grens tijdens het schrijven van een
   * eerlijke zin twee keer is overschreden. */
  eis(
    (manifest.description ?? "").length <= 132,
    `description is ${(manifest.description ?? "").length} tekens. Chrome staat er 132 toe en weigert\n` +
      `        de extensie bij meer, met een melding over het manifest en niet over deze regel.`,
  );

  /* DE CSP MOET EEN default-src HEBBEN. Zonder die terugval zijn img-src,
   * font-src, style-src en media-src onbeperkt: `connect-src 'none'` vangt
   * fetch, XHR en WebSocket, en dat is de aanval die iedereen verwacht — niet de
   * aanval die een 1x1-<img> is. Deze controle staat hier omdat de eerste versie
   * van het manifest precies dat gat had, en het gat onzichtbaar is: alles doet
   * het, er staat een strenge regel, en de pixel gaat eruit. */
  const csp = manifest.content_security_policy?.extension_pages ?? "";
  eis(
    /(^|;)\s*default-src\s/.test(csp),
    "content_security_policy.extension_pages heeft geen default-src. Zonder die terugval zijn\n" +
      "        img-src, font-src en style-src onbeperkt en laadt een <img> naar een vreemd domein\n" +
      "        gewoon — inclusief het bedrag in de querystring.",
  );
  for (const richting of ["img-src", "font-src", "media-src", "connect-src"]) {
    const m2 = new RegExp(`(^|;)\\s*${richting}\\s+([^;]+)`).exec(csp);
    eis(
      m2 === null || /^'none'$/.test(m2[2].trim()),
      `content_security_policy zet ${richting} op "${m2 ? m2[2].trim() : ""}". Deze extensie haalt\n` +
        `        niets op, dus daar hoort 'none' te staan; alles anders is een deur die niemand gebruikt.`,
    );
  }
  eis(!/unsafe-eval|remote|https?:/i.test(csp), "content_security_policy laat een schema of unsafe-eval toe.");
  eis(
    !JSON.stringify(manifest).includes("<all_urls>"),
    "manifest bevat <all_urls>. Dat mag nooit: elke host moet apart te verantwoorden zijn.",
  );
  eis(
    (manifest.host_permissions ?? []).length === 0,
    "host_permissions moet leeg zijn — sites lopen via optional_host_permissions, zodat de gebruiker per winkel ja zegt.",
  );
}

/* ── 4. loopt de sitelijst gelijk met sites.ts? ────────────────────────────── */

const sites = await import(pathToFileURL(join(DIST, "sites.js")).href);
const voorSitelijst = fouten.length;
const uitCode = [...sites.SITE_MATCHES].sort();
const uitManifest = [...(manifest?.optional_host_permissions ?? [])].sort();
eis(
  JSON.stringify(uitCode) === JSON.stringify(uitManifest),
  `optional_host_permissions loopt niet gelijk met src/sites.ts.\n` +
    `        manifest: ${JSON.stringify(uitManifest)}\n` +
    `        sites.ts: ${JSON.stringify(uitCode)}`,
);
/* En elk patroon moet een PAD aanwijzen, geen heel domein. `https://www.ikea.com/*`
 * is syntactisch een prima matchpatroon en glijdt er zonder deze controle in;
 * daarna staat er onder het vinkje "alleen productpagina's" terwijl de extensie
 * de hele winkel mag lezen. siteForUrl in sites.ts weigert zo'n pagina wél, dus
 * het resultaat zou een extensie zijn die om meer toestemming vraagt dan ze
 * gebruikt — en dat is de vorm van vragen waar niemand ja op hoort te zeggen. */
for (const patroon of uitCode) {
  eis(
    sites.padIsSpecifiek(patroon),
    `${patroon} wijst een heel domein aan, geen pad. Een winkel komt erin met het pad erbij\n` +
      `        (zoals https://www.ikea.com/nl/nl/p/*), zodat de winkelwagen en de accountpagina's\n` +
      `        erbuiten vallen.`,
  );
}

if (fouten.length === voorSitelijst) {
  gedaan.push(
    `sitelijst gelijk aan het manifest, en elk patroon wijst een pad aan ` +
      `(${uitCode.length} winkel(s): ${uitCode.join(", ") || "geen"})`,
  );
}

/* ── 5. is content.js nog een klassiek script? ─────────────────────────────── */

const contentPad = join(DIST, "content.js");
if (existsSync(contentPad)) {
  const bron = readFileSync(contentPad, "utf8");
  const moduleRegel = bron.split("\n").findIndex((r) => /^\s*(import|export)\b/.test(r));
  eis(
    moduleRegel === -1,
    `content.js bevat op regel ${moduleRegel + 1} een import of export. Een content script in MV3 is\n` +
      `        een KLASSIEK script; Chrome weigert het bestand dan met "Cannot use import statement\n` +
      `        outside a module", en die fout staat alleen in de console van de winkelpagina.`,
  );
}

/* ── 6. gaat er iets het netwerk op? ───────────────────────────────────────── */

/* WAT HIER GESCAND WORDT: ALLES WAT IN dist/ LIGT. Niet alleen .js — dat was de
 * fout van de vorige versie. Chrome laadt ook popup.html, options.html en
 * stijl.css, en een `<img src="https://...">` of een `@font-face` met een remote
 * `url()` is net zo goed een verzoek naar buiten als een `fetch(`. De pixel die
 * daar doorheen kwam had het bedrag in de querystring staan.
 *
 * ── WAAROM .js EN DE REST VERSCHILLEND WORDEN BEHANDELD ─────────────────────
 *
 * In .js mag een URL wél als tekst voorkomen en in de rest niet. Dat is geen
 * slordigheid maar het verschil tussen een adres en een verzoek: de gebundelde
 * catalogus draagt bij elk cijfer de bronvermelding mee (`crypto.com/nl/cards`,
 * met de datum), en die tekst hoort er te staan — zonder bron is een cijfer aan
 * een kassa niets waard. Er wordt niets mee opgehaald; `sourceLine` in lines.ts
 * drukt alleen de datum af.
 *
 * In .html, .css en JSON is een URL geen tekst maar een ADRES: alles wat daar
 * staat, staat er omdat de browser er iets mee doet. Daar geldt dus nul
 * tolerantie voor http(s):// en voor schemaloze //host — ook in commentaar. Een
 * poort die commentaar moet overslaan, moet commentaarsyntaxis perfect kennen,
 * en dat is precies het soort perfectie waar de vorige versie op stukliep. Wie
 * een URL wil noteren, doet dat in de README of in een .ts-bestand.
 *
 * Wat .js daarvoor terugkrijgt is een tweede regel: een URL in RESOURCEPOSITIE
 * (`url(...)`, `@import`, `src=`) is er ook in JavaScript één te veel. Zo is de
 * stylesheet die content.js in de schaduw-DOM zet net zo hard gedekt als
 * stijl.css.
 *
 * De manifestregel is de enige uitzondering, en hij is smal: een http(s)-string
 * in manifest.json mag alleen voorkomen als hij LETTERLIJK in host_permissions
 * of optional_host_permissions staat. Dat is een matchpatroon en geen adres — er
 * wordt niets opgehaald, het beschrijft waar de extensie mag kijken. Dat die
 * lijst zichzelf niet mag goedkeuren, bewaakt controle 4 hierboven: hij moet
 * gelijk zijn aan SITE_MATCHES uit sites.ts, en elk patroon moet een pad
 * aanwijzen. */

/* Regels die met // of * beginnen zijn commentaar; tsc laat dat staan en anders
 * struikelt deze controle over haar eigen uitleg. Stringliterals met een URL
 * erin blijven wel staan, en dat is goed: een URL is geen verkeer, maar
 * `fetch(` wel. Geldt alleen voor .js — zie het blok hierboven. */
function zonderCommentaar(bron) {
  return bron
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*)/.test(r))
    .join("\n");
}

/** Aanroepen die verkeer maken. Gelden in elk bestand. */
const VERBODEN = [
  ["fetch(", "fetch"],
  ["XMLHttpRequest", "XMLHttpRequest"],
  ["new WebSocket", "WebSocket"],
  ["sendBeacon", "navigator.sendBeacon"],
  ["EventSource", "EventSource"],
  ["importScripts", "importScripts (remote code)"],
  ["new Image(", "new Image() — een pixel is ook een verzoek"],
];

/** Een URL in resourcepositie. Gelden ook in .js, waar losse URL-tekst mag. */
const RESOURCEPOSITIE = [
  [/url\(\s*["']?\s*(?:https?:)?\/\//i, "een url(...) die naar een ander domein wijst"],
  [/@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i, "een @import van een ander domein"],
  [
    /\b(?:src|href|action|formaction|poster|srcset|ping)\s*=\s*["']?\s*(?:https?:)?\/\//i,
    "een verwijzing (src/href/...) naar een ander domein",
  ],
];

/** Elk absoluut adres. Geldt in alles wat geen .js is. */
const ELK_ADRES = [
  [/https?:\/\//i, "een http(s)-adres"],
  [/(^|[^:\w])\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i, "een schemaloos adres (//domein)"],
];

/** Alle strings in een JSON-boom, plat. */
function alleStrings(waarde, uit = []) {
  if (typeof waarde === "string") uit.push(waarde);
  else if (Array.isArray(waarde)) for (const v of waarde) alleStrings(v, uit);
  else if (waarde && typeof waarde === "object") for (const v of Object.values(waarde)) alleStrings(v, uit);
  return uit;
}

/** Waar in de bron staat het, in regelnummers. Maximaal vijf per regel-soort:
 *  wie het zesde geval nodig heeft om het te geloven, heeft het al gezien. */
function regelsWaar(regels, test) {
  const uit = [];
  for (let i = 0; i < regels.length && uit.length < 5; i++) {
    if (test(regels[i])) uit.push(i + 1);
  }
  return uit;
}

/** De poort zelf. Geeft een lijst bezwaren terug (`{ uitleg, regels }`); leeg is
 *  schoon.
 *
 *  Staat met opzet als losse functie op één bron, zodat de zelftest hieronder
 *  hem kan voeren met bestanden die niet op schijf staan. Een controle die
 *  alleen te draaien is door hem echt te laten mislukken, wordt nooit gedraaid. */
function keurBron(relPad, bron) {
  const bezwaren = [];
  const isJs = relPad.endsWith(".js");
  const isManifest = relPad === "manifest.json" || relPad.endsWith("/manifest.json");

  const voorNaalden = isJs ? zonderCommentaar(bron) : bron;
  const naaldRegels = voorNaalden.split("\n");
  for (const [naald, uitleg] of VERBODEN) {
    const regels = regelsWaar(naaldRegels, (r) => r.includes(naald));
    if (regels.length > 0) bezwaren.push({ uitleg, regels });
  }

  const alleRegels = bron.split("\n");
  for (const [patroon, uitleg] of RESOURCEPOSITIE) {
    const regels = regelsWaar(alleRegels, (r) => patroon.test(r));
    if (regels.length > 0) bezwaren.push({ uitleg, regels });
  }

  if (isJs) return bezwaren;

  if (isManifest) {
    /* Het manifest mag matchpatronen dragen, en verder niets met een schema erin. */
    let json = null;
    try {
      json = JSON.parse(bron);
    } catch {
      return bezwaren; /* onleesbare JSON is al een fout in controle 3 hierboven */
    }
    const toegestaan = new Set([...(json.host_permissions ?? []), ...(json.optional_host_permissions ?? [])]);
    for (const tekst of alleStrings(json)) {
      if (!/https?:\/\//i.test(tekst)) continue;
      if (toegestaan.has(tekst)) continue;
      bezwaren.push({
        uitleg: `het adres ${tekst}, en dat is geen matchpatroon uit de sitelijst`,
        regels: regelsWaar(alleRegels, (r) => r.includes(tekst)),
      });
    }
    return bezwaren;
  }

  for (const [patroon, uitleg] of ELK_ADRES) {
    const regels = regelsWaar(alleRegels, (r) => patroon.test(r));
    if (regels.length > 0) bezwaren.push({ uitleg, regels });
  }
  return bezwaren;
}

/* ── de zelftest: laat de poort opzettelijk afgaan ──────────────────────────
 *
 * Dit draait bij elke build, in het geheugen, en er komt geen bestand aan te
 * pas. De drie eerste gevallen zijn LETTERLIJK de drie waarmee de vorige versie
 * groen meldde. De schone gevallen staan er even hard bij: een poort die overal
 * op afgaat, is net zo onbruikbaar als een poort die niets ziet — alleen merk je
 * dat eerder. */
const ZELFTEST_VUIL = [
  [
    "een remote @font-face in de stylesheet",
    "stijl.css",
    '@font-face { font-family: "Inter"; src: url(https://fonts.gstatic.com/s/inter/v13.woff2) format("woff2"); }',
  ],
  [
    "een remote background-image in de stylesheet",
    "stijl.css",
    '.paneel { background-image: url("https://tracker.example.com/bg.png"); }',
  ],
  [
    "een 1x1-trackingpixel met het bedrag in de querystring",
    "popup.html",
    '<img src="https://tracker.example.com/p.gif?bedrag=4999" width="1" height="1" alt="" />',
  ],
  [
    "een schemaloos adres in een stylesheet",
    "stijl.css",
    ".merk { background: url(//tracker.example.com/x.png); }",
  ],
  ["een fetch in een inline script", "options.html", '<script>fetch("https://x.example/pixel")</script>'],
  [
    "een remote url() in een stylesheet die JavaScript in de pagina zet",
    "content.js",
    'const css = ".lv-paneel{background-image:url(https://tracker.example.com/x.png)}";',
  ],
  [
    "een vreemd adres in het manifest",
    "manifest.json",
    '{"optional_host_permissions":["https://www.ikea.com/nl/nl/p/*"],"update_url":"https://clients2.example.com/update"}',
  ],
];

const ZELFTEST_SCHOON = [
  [
    "de echte popup, met een relatieve stylesheet en een relatief script",
    "popup.html",
    '<link rel="stylesheet" href="stijl.css" />\n<code>chrome://extensions</code>\n<script type="module" src="popup.js"></script>',
  ],
  ["de echte stylesheet", "stijl.css", "/* geen animatie */\n:root { --vlak: #faf8f3; }\nbody { background: var(--vlak); }"],
  [
    "het echte manifest, met het IKEA-matchpatroon erin",
    "manifest.json",
    '{"optional_host_permissions":["https://www.ikea.com/nl/nl/p/*"],"host_permissions":[]}',
  ],
  [
    "de gebundelde catalogus, met bronvermeldingen als tekst",
    "generated/catalog.generated.js",
    'export const CHECKOUT_CARDS = [{ id: "x", source: "https://www.crypto.com/nl/cards, gelezen 2026-08-12" }];',
  ],
];

const zelftestFouten = [];
for (const [naam, pad, bron] of ZELFTEST_VUIL) {
  const bezwaren = keurBron(pad, bron);
  if (bezwaren.length === 0) zelftestFouten.push(`de poort ziet ${naam} NIET (${pad})`);
}
for (const [naam, pad, bron] of ZELFTEST_SCHOON) {
  const bezwaren = keurBron(pad, bron);
  if (bezwaren.length > 0) {
    zelftestFouten.push(`de poort gaat af op ${naam} (${pad}): ${bezwaren.map((b) => b.uitleg).join("; ")}`);
  }
}
if (zelftestFouten.length > 0) {
  console.error("");
  for (const f of zelftestFouten) console.error(`[copy-static] ZELFTEST — ${f}`);
  console.error(
    "\n[copy-static] De netwerkcontrole doet niet wat ze belooft. Er is niets gescand:\n" +
      "              een poort die niet bewijsbaar afgaat, mag geen groen melden.",
  );
  process.exit(1);
}
gedaan.push(
  `zelftest netwerkcontrole: ${ZELFTEST_VUIL.length} gevallen betrapt, ` +
    `${ZELFTEST_SCHOON.length} schone bestanden met rust gelaten`,
);

/* ── en dan de echte bundel ───────────────────────────────────────────────── */

let gescand = 0;
const voorScan = fouten.length;
function loopDoor(map) {
  for (const naam of readdirSync(map)) {
    const pad = join(map, naam);
    if (statSync(pad).isDirectory()) {
      loopDoor(pad);
      continue;
    }
    /* latin1 en niet utf8: een PNG hoeft niet leesbaar te zijn om doorzocht te
     * worden, en een decodeerfout mag geen bestand overslaan. */
    const relPad = relative(DIST, pad).split("\\").join("/");
    const bezwaren = keurBron(relPad, readFileSync(pad, "latin1"));
    gescand++;
    for (const { uitleg, regels } of bezwaren) {
      const waar = regels.length > 0 ? regels.map((r) => `dist/${relPad}:${r}`).join(", ") : `dist/${relPad}`;
      eis(
        false,
        `${waar} bevat ${uitleg}. Deze extensie stuurt niets naar buiten;\n` +
          `        als dit echt nodig is, hoort daar eerst een gesprek bij en niet een import.`,
      );
    }
  }
}
loopDoor(DIST);
/* Alleen groen melden als er ook echt niets gevonden is. Dit is de regel waar de
 * vorige versie op struikelde: "ok — geen netwerkaanroepen in de bundel" stond
 * er ook toen de pixel er gewoon in zat. */
if (fouten.length === voorScan) {
  gedaan.push(`geen netwerkverkeer in de bundel (${gescand} bestanden gescand, alles wat in dist/ ligt)`);
} else {
  gedaan.push(`${gescand} bestanden gescand — zie de fouten hieronder`);
}

/* ── uitkomst ──────────────────────────────────────────────────────────────── */

for (const r of gedaan) console.log(`[copy-static] ok — ${r}`);
if (fouten.length > 0) {
  console.error("");
  for (const f of fouten) console.error(`[copy-static] FOUT — ${f}`);
  console.error(
    `\n[copy-static] ${fouten.length} probleem(en). dist/ is NIET geschikt om in Chrome te laden.`,
  );
  process.exit(1);
}
console.log(`[copy-static] dist/ is klaar om te laden via "Laad uitgepakte extensie".`);
