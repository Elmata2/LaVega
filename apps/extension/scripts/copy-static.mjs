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
 *   4. loopt de sitelijst in het manifest nog gelijk met src/sites.ts?
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

  for (const p of verwijzingen) {
    eis(existsSync(join(DIST, p)), `manifest verwijst naar ${p}, maar dist/${p} bestaat niet.`);
  }
  gedaan.push(`${verwijzingen.length} manifestverwijzingen nagelopen`);

  eis(manifest.manifest_version === 3, "manifest_version moet 3 zijn.");
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
const uitCode = [...sites.SITE_MATCHES].sort();
const uitManifest = [...(manifest?.optional_host_permissions ?? [])].sort();
eis(
  JSON.stringify(uitCode) === JSON.stringify(uitManifest),
  `optional_host_permissions loopt niet gelijk met src/sites.ts.\n` +
    `        manifest: ${JSON.stringify(uitManifest)}\n` +
    `        sites.ts: ${JSON.stringify(uitCode)}`,
);
gedaan.push(`sitelijst gelijk aan het manifest (${uitCode.length} winkel(s): ${uitCode.join(", ") || "geen"})`);

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

/* Regels die met // of * beginnen zijn commentaar; tsc laat dat staan en anders
 * struikelt deze controle over haar eigen uitleg. Stringliterals met een URL
 * erin (de bronvermeldingen in de catalogus) blijven wel staan, en dat is goed:
 * een URL is geen verkeer, maar `fetch(` wel. */
function zonderCommentaar(bron) {
  return bron
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*)/.test(r))
    .join("\n");
}

const VERBODEN = [
  ["fetch(", "fetch"],
  ["XMLHttpRequest", "XMLHttpRequest"],
  ["new WebSocket", "WebSocket"],
  ["sendBeacon", "navigator.sendBeacon"],
  ["EventSource", "EventSource"],
  ["importScripts", "importScripts (remote code)"],
];

function loopDoor(map) {
  for (const naam of readdirSync(map)) {
    const pad = join(map, naam);
    if (statSync(pad).isDirectory()) {
      loopDoor(pad);
      continue;
    }
    if (!naam.endsWith(".js")) continue;
    const bron = zonderCommentaar(readFileSync(pad, "utf8"));
    for (const [naald, uitleg] of VERBODEN) {
      eis(
        !bron.includes(naald),
        `dist/${relative(DIST, pad)} bevat ${uitleg}. Deze extensie stuurt niets naar buiten;\n` +
          `        als dit echt nodig is, hoort daar eerst een gesprek bij en niet een import.`,
      );
    }
  }
}
loopDoor(DIST);
gedaan.push("geen netwerkaanroepen in de bundel");

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
