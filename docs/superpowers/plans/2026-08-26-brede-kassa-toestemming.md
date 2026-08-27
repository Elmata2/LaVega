# Brede kassa-toestemming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-site curated checkout-reading permission model (`sites.ts`'s `SITES` array, currently one hand-vetted entry: IKEA Netherlands) with one broad `<all_urls>` optional host permission, gated behind a single toggle in the options page, using the existing, already-generic `read.ts` reading logic unchanged.

**Architecture:** One boolean flag in `chrome.storage.local` (same pattern as the existing per-bron toggles) plus the `<all_urls>` optional host permission together gate a single `content.js` registration covering every `https:` page, replacing the per-site loop. The message-answering path (`beantwoord`/`siteVanAfzender` in `background.ts`) is rewritten to validate sender/tab origin consistency directly instead of against a fixed site list — the same security properties, without a `Site` identity. `read.ts`, `content.ts`, and the ING/Amex account-reading permissions are untouched.

**Tech Stack:** TypeScript, Vitest (`@vitest-environment jsdom`), Chrome Extension Manifest V3 (`chrome.permissions`, `chrome.scripting`, `chrome.storage.local`).

**Spec:** `docs/superpowers/specs/2026-08-26-brede-kassa-toestemming-design.md`

## Global Constraints

- Deel A only. No visible-text heuristic reader (Deel B is separate, later scope).
- ING/Amex account-reading permissions (`bronnen.ts`, `BRONNEN`) are explicitly out of scope — do not touch their matches, toggles, or storage keys.
- `read.ts` and `content.ts` get zero changes.
- No denylist (e.g. excluding coolblue.nl) — explicit owner decision, 26 August 2026: "neem alles mee en dan testen we over tijd wat wel en niet werkt."
- Every `chrome.permissions.request` call must remain the first, un-awaited statement inside its click handler (Chrome requires an active user gesture — see `options.ts`'s existing header comment).
- Storage keys are plain camelCase string literals matching the existing convention in `store.ts` (`"enabledSiteIds"`, not `"lavega.enabledSiteIds"`).

---

### Task 1: Move the match-pattern helpers out of `sites.ts` into `bronnen.ts`

`ontleedMatch`/`padIsSpecifiek` are generic string parsers with no dependency on `SITES` — they're needed later (Task 4) by `copy-static.mjs` to keep validating `bronnen.ts`'s own match patterns after `sites.ts` is deleted (Task 8). Move them now, while `sites.ts` still exists, so nothing is ever broken mid-plan.

**Files:**
- Modify: `apps/extension/src/bronnen.ts`
- Test: `apps/extension/src/bronnen.test.ts` (new file)

**Interfaces:**
- Produces: `ontleedMatch(match: string): { host: string; padPrefix: string } | null`, `padIsSpecifiek(match: string): boolean` — both exported from `bronnen.js`, used by `copy-static.mjs` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/bronnen.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ontleedMatch, padIsSpecifiek, BRON_MATCHES } from "./bronnen.js";

describe("het matchpatroon van een bron valt uit elkaar in host en pad", () => {
  it("herkent host en padPrefix", () => {
    expect(ontleedMatch("https://mijn.ing.nl/punten*")).toEqual({
      host: "mijn.ing.nl",
      padPrefix: "/punten",
    });
    expect(ontleedMatch("https://global.americanexpress.com/offers/eligible*")).toEqual({
      host: "global.americanexpress.com",
      padPrefix: "/offers/eligible",
    });
  });

  it("geeft null bij een wildcard-subdomein, een ander schema of geen * aan het eind", () => {
    expect(ontleedMatch("https://*.ing.nl/*")).toBeNull();
    expect(ontleedMatch("http://mijn.ing.nl/punten*")).toBeNull();
    expect(ontleedMatch("https://mijn.ing.nl/punten")).toBeNull();
  });

  it("padIsSpecifiek is false voor een kaal domein en true voor een echt pad", () => {
    expect(padIsSpecifiek("https://mijn.ing.nl/*")).toBe(false);
    expect(padIsSpecifiek("https://mijn.ing.nl/punten*")).toBe(true);
  });

  it("elk patroon in BRON_MATCHES wijst een pad aan, geen heel domein", () => {
    for (const patroon of BRON_MATCHES) {
      expect(padIsSpecifiek(patroon), patroon).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/extension && pnpm exec vitest run src/bronnen.test.ts`
Expected: FAIL — `ontleedMatch`/`padIsSpecifiek` are not exported from `./bronnen.js`.

- [ ] **Step 3: Move the two functions into `bronnen.ts`**

In `apps/extension/src/bronnen.ts`, after the existing `export const BRON_MATCHES = ...` line, add:

```ts
/** Een matchpatroon uit elkaar getrokken: het hostdeel en het VASTE stuk pad dat
 *  ervoor staat. `https://mijn.ing.nl/punten*` → host `mijn.ing.nl`, padPrefix
 *  `/punten`.
 *
 *  Geeft `null` bij alles wat geen precies aanwijsbare plek is: een
 *  wildcard-subdomein, een ander schema dan https, of een patroon zonder `*`
 *  aan het eind. */
export function ontleedMatch(match: string): { host: string; padPrefix: string } | null {
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^*]*)\*$/.exec(match);
  if (!m) return null;
  return { host: m[1].toLowerCase(), padPrefix: m[2] };
}

/** Wijst dit patroon een deel van een site aan, of de hele site? `/` is de hele
 *  site en telt dus niet als pad. Gebruikt door bronnen.test.ts en door de
 *  build (copy-static.mjs), om te bewaken dat een accountpagina's matchpatroon
 *  altijd een pad draagt en nooit een heel domein. */
export function padIsSpecifiek(match: string): boolean {
  const d = ontleedMatch(match);
  return d !== null && d.padPrefix.length > 1;
}
```

Also update the doc comment directly above the existing `export const BRON_MATCHES = ...` line, which still refers to `sites.ts`. Replace:

```ts
/** De patronen die in `optional_host_permissions` van het manifest horen, naast
 *  die van de winkels uit sites.ts. */
export const BRON_MATCHES: readonly string[] = BRONNEN.map((b) => b.match);
```

with:

```ts
/** De patronen die in `optional_host_permissions` van het manifest horen, naast
 *  de brede <all_urls>-toestemming voor het kassa-paneel (zie background.ts en
 *  copy-static.mjs). */
export const BRON_MATCHES: readonly string[] = BRONNEN.map((b) => b.match);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/extension && pnpm exec vitest run src/bronnen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/bronnen.ts apps/extension/src/bronnen.test.ts
git commit -m "feat(extensie): ontleedMatch/padIsSpecifiek verhuizen naar bronnen.ts"
```

---

### Task 2: Add the broad kassa toggle to `store.ts`

**Files:**
- Modify: `apps/extension/src/store.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getKassaOveralAan(): Promise<boolean>`, `setKassaOveralAan(aan: boolean): Promise<void>` — used by `background.ts` (Task 5) and `options.ts` (Task 7).

There is no existing dedicated unit test for the analogous `getBronAan`/`setBronAan` (they're covered indirectly through `background.test.ts`'s full chrome-mock). Follow the same convention: no new test file here: coverage comes from Task 6's `background.test.ts` additions.

- [ ] **Step 1: Add the storage key and the two functions**

In `apps/extension/src/store.ts`, next to the existing `const KEY_SITES = "enabledSiteIds";` (around line 81), add:

```ts
const KEY_KASSA_OVERAL = "kassaOveralAan";
```

Then, right after `setBronAan` (around line 254), add:

```ts
/** Standaard UIT, net als bij een bron: alles wat geen letterlijke `true` is,
 *  levert false op. Zie de uitleg bij `getBronAan` hierboven — dezelfde regel,
 *  nu voor de brede kassa-toestemming in plaats van per bron. */
export async function getKassaOveralAan(): Promise<boolean> {
  const items = await chrome.storage.local.get([KEY_KASSA_OVERAL]);
  return items[KEY_KASSA_OVERAL] === true;
}

export async function setKassaOveralAan(aan: boolean): Promise<void> {
  await chrome.storage.local.set({ [KEY_KASSA_OVERAL]: aan === true });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/extension && pnpm exec tsc --noEmit`
Expected: no new errors (the two functions are not yet imported anywhere).

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/store.ts
git commit -m "feat(extensie): opslagvlag voor de brede kassa-toestemming"
```

---

### Task 3: Manifest — add `<all_urls>`, remove the IKEA-specific entry

**Files:**
- Modify: `apps/extension/public/manifest.json`

- [ ] **Step 1: Edit `optional_host_permissions`**

Change:

```json
  "optional_host_permissions": [
    "https://www.ikea.com/nl/nl/p/*",
    "https://global.americanexpress.com/offers/eligible*",
    "https://mijn.ing.nl/punten*"
  ],
```

to:

```json
  "optional_host_permissions": [
    "<all_urls>",
    "https://global.americanexpress.com/offers/eligible*",
    "https://mijn.ing.nl/punten*"
  ],
```

- [ ] **Step 2: Commit**

This will make the build fail until Task 4 updates `copy-static.mjs` to match — that's expected and gets fixed in the next task. Do not run `pnpm build` yet.

```bash
git add apps/extension/public/manifest.json
git commit -m "feat(extensie): manifest vraagt <all_urls> i.p.v. het IKEA-specifieke patroon"
```

---

### Task 4: `copy-static.mjs` — validate against `<all_urls>` + `bronnen.ts` instead of `sites.ts`

This build script has two checks that hard-code the old model: (1) an unconditional assertion that the manifest must NEVER contain `<all_urls>` ("Dat mag nooit: elke host moet apart te verantwoorden zijn" — written when every host needed individual justification; superseded by the 26 August decision to accept broader, unvetted coverage for personal use), and (2) an equality check between `sites.SITE_MATCHES` + `bronnen.BRON_MATCHES` and the manifest. Both need rewriting.

**Files:**
- Modify: `apps/extension/scripts/copy-static.mjs`

- [ ] **Step 1: Remove the `<all_urls>`-forbid check**

Find and delete this block (it sits right after the `style-src` check, before the `host_permissions` check):

```js
  eis(
    !JSON.stringify(manifest).includes("<all_urls>"),
    "manifest bevat <all_urls>. Dat mag nooit: elke host moet apart te verantwoorden zijn.",
  );
```

The line directly after it (`eis((manifest.host_permissions ?? []).length === 0, ...)`) stays — `<all_urls>` belongs in `optional_host_permissions`, not `host_permissions`, and that distinction still holds.

- [ ] **Step 2: Rewrite the site-list-equality check (section "── 4. loopt de sitelijst gelijk met sites.ts? ──")**

Replace:

```js
const sites = await import(pathToFileURL(join(DIST, "sites.js")).href);
/* De accountpagina's horen in dezelfde vergelijking. Ze staan niet in
 * SITE_MATCHES omdat het geen WINKELS zijn — het zijn zijn eigen accounts, elk
 * met een eigen schakelaar en een eigen vraag — maar ze vragen wel een
 * hostrecht, en dat recht moet net zo hard gelijklopen met het manifest.
 * Vergeet je er een, dan merkt hij het pas doordat Chrome zijn
 * toestemmingsverzoek weigert met een melding die niets over de oorzaak zegt.
 *
 * DIT KOMT UIT BRONNEN.TS EN NIET UIT EEN TWEEDE LIJSTJE HIER. Zodra er een
 * derde bron bij komt, loopt hij automatisch mee; een lijst die hier met de hand
 * wordt bijgehouden is precies de plek waar de vorige er een zou vergeten. */
const bronnen = await import(pathToFileURL(join(DIST, "bronnen.js")).href);
const voorSitelijst = fouten.length;
const uitCode = [...sites.SITE_MATCHES, ...bronnen.BRON_MATCHES].sort();
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
    `hostrechten gelijk aan het manifest, en elk patroon wijst een pad aan ` +
      `(${uitCode.length}: ${uitCode.join(", ") || "geen"})`,
  );
}
```

with:

```js
/* De kassa-lezer vraagt sinds 26 augustus 2026 één brede toestemming
 * (<all_urls>) i.p.v. een per-site lijst — zie
 * docs/superpowers/specs/2026-08-26-brede-kassa-toestemming-design.md. Die
 * ene entry ligt hier vast, niet in een geïmporteerd bestand: er is geen
 * sites.ts meer om hem uit te lezen.
 *
 * De accountpagina's (ING/Amex) horen wel nog in dezelfde vergelijking: ze
 * vragen ook een hostrecht en dat moet gelijklopen met het manifest. DIT KOMT
 * UIT BRONNEN.TS EN NIET UIT EEN TWEEDE LIJSTJE HIER — zodra er een derde bron
 * bij komt, loopt hij automatisch mee. */
const KASSA_MATCH = "<all_urls>";
const bronnen = await import(pathToFileURL(join(DIST, "bronnen.js")).href);
const voorSitelijst = fouten.length;
const uitCode = [KASSA_MATCH, ...bronnen.BRON_MATCHES].sort();
const uitManifest = [...(manifest?.optional_host_permissions ?? [])].sort();
eis(
  JSON.stringify(uitCode) === JSON.stringify(uitManifest),
  `optional_host_permissions loopt niet gelijk met de verwachte lijst.\n` +
    `        manifest: ${JSON.stringify(uitManifest)}\n` +
    `        verwacht: ${JSON.stringify(uitCode)}`,
);
/* Alleen de accountpagina's moeten een PAD aanwijzen, geen heel domein — dat
 * blijft gelden (de winkelwagen en de accountpagina's van ING/Amex zelf horen
 * er nog steeds buiten). <all_urls> is geen https-patroon en heeft geen pad om
 * op te controleren, dus die staat hier terecht buiten de lus. */
for (const patroon of bronnen.BRON_MATCHES) {
  eis(
    bronnen.padIsSpecifiek(patroon),
    `${patroon} wijst een heel domein aan, geen pad.`,
  );
}

if (fouten.length === voorSitelijst) {
  gedaan.push(
    `hostrechten gelijk aan het manifest (${uitCode.length}: ${uitCode.join(", ")})`,
  );
}
```

- [ ] **Step 3: Update the header comment (point 4 of the numbered list, near the top of the file)**

Replace:

```
 *   4. loopt de sitelijst in het manifest nog gelijk met src/sites.ts, en wijst
 *      elk patroon een PAD aan en niet een heel domein?
```

with:

```
 *   4. staat <all_urls> plus de accountpagina's van bronnen.ts in het manifest,
 *      en wijst elk accountpatroon een PAD aan en niet een heel domein? (Vóór
 *      26 augustus 2026 stond hier een lijst met individueel gemeten winkels
 *      i.p.v. <all_urls> — zie de spec voor waarom dat is losgelaten.)
```

And a few lines below, replace:

```
 * De vierde is de sluipendste. optional_host_permissions staat in JSON en kan
 * sites.ts niet importeren, dus de twee lijsten zijn met de hand gelijkgehouden.
 * Voeg je een winkel toe aan sites.ts en vergeet je het manifest, dan komt de
 * fout pas naar boven op het moment dat een gebruiker het vinkje aanzet en
 * Chrome het verzoek weigert — met een melding die niets over de oorzaak zegt.
```

with:

```
 * De vierde bewaakt dat het manifest en bronnen.ts niet uit elkaar lopen.
 * Vergeet je een accountpagina in het manifest bij te werken, dan komt de fout
 * pas naar boven op het moment dat een gebruiker een vinkje aanzet en Chrome
 * het verzoek weigert — met een melding die niets over de oorzaak zegt.
```

- [ ] **Step 4: Also fix the later prose block referencing `sites.ts`/`SITE_MATCHES`**

Around the "── WAAROM .js EN DE REST VERSCHILLEND WORDEN BEHANDELD ──" section, find:

```
 * De manifestregel is de enige uitzondering, en hij is smal: een http(s)-string
 * in manifest.json mag alleen voorkomen als hij LETTERLIJK in host_permissions
 * of optional_host_permissions staat. Dat is een matchpatroon en geen adres — er
 * wordt niets opgehaald, het beschrijft waar de extensie mag kijken. Dat die
 * lijst zichzelf niet mag goedkeuren, bewaakt controle 4 hierboven: hij moet
 * gelijk zijn aan SITE_MATCHES uit sites.ts, en elk patroon moet een pad
 * aanwijzen. */
```

and replace the last two lines with:

```
 * lijst zichzelf niet mag goedkeuren, bewaakt controle 4 hierboven: hij moet
 * gelijk zijn aan <all_urls> plus BRON_MATCHES uit bronnen.ts. */
```

- [ ] **Step 5: Run the build and confirm it passes**

Run: `cd apps/extension && pnpm build`
Expected: succeeds, ends with `[copy-static] dist/ is klaar om te laden via "Laad uitgepakte extensie".` and the `hostrechten gelijk aan het manifest` line lists `<all_urls>` plus the two account matches.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/scripts/copy-static.mjs
git commit -m "fix(build): copy-static valideert <all_urls> + bronnen.ts i.p.v. sites.ts"
```

---

### Task 5: Rewrite `background.ts` — one broad registration, origin-based message validation

**Files:**
- Modify: `apps/extension/src/background.ts`

**Interfaces:**
- Consumes: `getKassaOveralAan` from `store.ts` (Task 2).
- Produces: `kassaMagDraaien(): Promise<boolean>` (internal), `hostVanAfzender(sender): string | null` (internal) — referenced by Task 6's tests indirectly through `beantwoord`'s behavior, not imported directly.

- [ ] **Step 1: Update imports**

Remove:

```ts
import { SITES, siteForUrl, ontleedMatch, type Site } from "./sites.js";
```

Change the `store.js` import block from:

```ts
import {
  getHeldIds,
  getEnabledSiteIds,
  setEnabledSiteIds,
  getPointsBalances,
  getBronAan,
  getBronAanbiedingen,
  getBronLezing,
  setBronLezing,
  wisBron,
} from "./store.js";
```

to:

```ts
import {
  getHeldIds,
  getKassaOveralAan,
  getPointsBalances,
  getBronAan,
  getBronAanbiedingen,
  getBronLezing,
  setBronLezing,
  setKassaOveralAan,
  wisBron,
} from "./store.js";
```

- [ ] **Step 2: Replace `regId`/`magDraaien` with a fixed id and a flag-based check**

Replace:

```ts
/** Het id waaronder een site zijn content script registreert. Eén vaste vorm,
 *  zodat opruimen ook lukt als de sitelijst inmiddels is veranderd: alles met
 *  dit voorvoegsel dat niet meer hoort te bestaan, gaat eraf. */
const REG_PREFIX = "paneel-";
const regId = (site: Site) => `${REG_PREFIX}${site.id}`;

/** Mag het paneel op deze site draaien? Twee voorwaarden, en ze moeten allebei
 *  waar zijn:
 *
 *   - Chrome heeft ons de host-toestemming gegeven (die kan de gebruiker in
 *     chrome://extensions intrekken zonder ons iets te vragen);
 *   - het vinkje staat aan in onze eigen opslag.
 *
 *  Twee schakelaars voor één ding lijkt dubbelop, maar ze horen bij verschillende
 *  partijen. De eerste is van Chrome en die wint altijd. De tweede is van hem:
 *  het vinkje uitzetten zonder de toestemming in te trekken hoort te kunnen, en
 *  dan moet het paneel wegblijven ook al MAG het technisch nog. */
async function magDraaien(site: Site, aangevinkt: readonly string[]): Promise<boolean> {
  if (!aangevinkt.includes(site.id)) return false;
  return chrome.permissions.contains({ origins: [site.match] });
}
```

with:

```ts
/** Zelfde voorvoegsel als voorheen, nu gedeeld door de bronnen (per-bron id)
 *  en de kassa (één vast id) — zodat opruimen blijft werken op alles wat met
 *  dit voorvoegsel begint en niet meer gewenst is. */
const REG_PREFIX = "paneel-";
const KASSA_REG_ID = `${REG_PREFIX}kassa-overal`;
const KASSA_MATCH = "<all_urls>";

/** Mag het kassa-paneel draaien? Twee voorwaarden, en ze moeten allebei waar
 *  zijn:
 *
 *   - Chrome heeft de <all_urls>-toestemming gegeven (die kan de gebruiker in
 *     chrome://extensions intrekken zonder ons iets te vragen);
 *   - het vinkje staat aan in onze eigen opslag.
 *
 *  Twee schakelaars voor één ding lijkt dubbelop, maar ze horen bij
 *  verschillende partijen. De eerste is van Chrome en die wint altijd. De
 *  tweede is van hem: het vinkje uitzetten zonder de toestemming in te trekken
 *  hoort te kunnen, en dan moet het paneel wegblijven ook al MAG het technisch
 *  nog. */
async function kassaMagDraaien(): Promise<boolean> {
  if (!(await getKassaOveralAan())) return false;
  return chrome.permissions.contains({ origins: [KASSA_MATCH] });
}
```

- [ ] **Step 3: Rewrite `syncRegistraties`'s site loop**

Replace:

```ts
async function syncRegistraties(): Promise<void> {
  const aangevinkt = await getEnabledSiteIds();
  const bestaand = await chrome.scripting.getRegisteredContentScripts();
  const bestaandeIds = new Set(bestaand.map((s) => s.id));

  const gewenst: Site[] = [];
  for (const site of SITES) {
    if (await magDraaien(site, aangevinkt)) gewenst.push(site);
  }
  const gewensteIds = new Set(gewenst.map(regId));

  const bronnenAan: Bron[] = [];
  for (const bron of BRONNEN) {
    if (!(await getBronAan(bron))) continue;
    if (!(await chrome.permissions.contains({ origins: [bron.match] }))) continue;
    bronnenAan.push(bron);
    gewensteIds.add(`${REG_PREFIX}${bron.id}`);
  }

  const wegHalen = [...bestaandeIds].filter((id) => id.startsWith(REG_PREFIX) && !gewensteIds.has(id));
  if (wegHalen.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: wegHalen });
  }

  const bijZetten: { id: string; match: string; js: string }[] = gewenst
    .filter((s) => !bestaandeIds.has(regId(s)))
    .map((s) => ({ id: regId(s), match: s.match, js: "content.js" }));
  for (const bron of bronnenAan) {
    const id = `${REG_PREFIX}${bron.id}`;
    if (bestaandeIds.has(id)) continue;
    bijZetten.push({ id, match: bron.match, js: AANBOD_CONTENT_JS });
  }
  if (bijZetten.length > 0) {
    await chrome.scripting.registerContentScripts(
      bijZetten.map((s) => ({
        id: s.id,
        matches: [s.match],
        js: [s.js],
        runAt: "document_idle",
        persistAcrossSessions: true,
        world: "ISOLATED",
      })),
    );
  }
}
```

with:

```ts
async function syncRegistraties(): Promise<void> {
  const bestaand = await chrome.scripting.getRegisteredContentScripts();
  const bestaandeIds = new Set(bestaand.map((s) => s.id));

  const gewensteIds = new Set<string>();
  if (await kassaMagDraaien()) gewensteIds.add(KASSA_REG_ID);

  const bronnenAan: Bron[] = [];
  for (const bron of BRONNEN) {
    if (!(await getBronAan(bron))) continue;
    if (!(await chrome.permissions.contains({ origins: [bron.match] }))) continue;
    bronnenAan.push(bron);
    gewensteIds.add(`${REG_PREFIX}${bron.id}`);
  }

  const wegHalen = [...bestaandeIds].filter((id) => id.startsWith(REG_PREFIX) && !gewensteIds.has(id));
  if (wegHalen.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: wegHalen });
  }

  const bijZetten: { id: string; match: string; js: string }[] = [];
  if (gewensteIds.has(KASSA_REG_ID) && !bestaandeIds.has(KASSA_REG_ID)) {
    bijZetten.push({ id: KASSA_REG_ID, match: KASSA_MATCH, js: "content.js" });
  }
  for (const bron of bronnenAan) {
    const id = `${REG_PREFIX}${bron.id}`;
    if (bestaandeIds.has(id)) continue;
    bijZetten.push({ id, match: bron.match, js: AANBOD_CONTENT_JS });
  }
  if (bijZetten.length > 0) {
    await chrome.scripting.registerContentScripts(
      bijZetten.map((s) => ({
        id: s.id,
        matches: [s.match],
        js: [s.js],
        runAt: "document_idle",
        persistAcrossSessions: true,
        world: "ISOLATED",
      })),
    );
  }
}
```

- [ ] **Step 4: Rewrite the `chrome.permissions.onRemoved` handler's site-cleanup block**

Replace:

```ts
chrome.permissions.onRemoved.addListener(() => {
  void (async () => {
    const aangevinkt = await getEnabledSiteIds();
    const blijft: string[] = [];
    for (const id of aangevinkt) {
      const site = SITES.find((s) => s.id === id);
      if (!site) continue;
      if (await chrome.permissions.contains({ origins: [site.match] })) blijft.push(id);
    }
    if (blijft.length !== aangevinkt.length) await setEnabledSiteIds(blijft);

    for (const bron of BRONNEN) {
      if (!(await getBronAan(bron))) continue;
      if (await chrome.permissions.contains({ origins: [bron.match] })) continue;
      await wisBron(bron);
    }

    await planSync();
  })();
});
```

with:

```ts
chrome.permissions.onRemoved.addListener(() => {
  void (async () => {
    /* Trekt de gebruiker de <all_urls>-toestemming in via chrome://extensions,
     * dan hoort het vinkje in het optiescherm dat ook te tonen — anders zoekt
     * hij naar een fout die er niet is (zie het commentaar bij
     * kassaMagDraaien). */
    if ((await getKassaOveralAan()) && !(await chrome.permissions.contains({ origins: [KASSA_MATCH] }))) {
      await setKassaOveralAan(false);
    }

    for (const bron of BRONNEN) {
      if (!(await getBronAan(bron))) continue;
      if (await chrome.permissions.contains({ origins: [bron.match] })) continue;
      await wisBron(bron);
    }

    await planSync();
  })();
});
```

- [ ] **Step 5: Update the `chrome.storage.onChanged` listener's key check**

Replace:

```ts
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const bronSleutel = BRONNEN.some((b) => b.sleutels.aan in changes);
  if (!("enabledSiteIds" in changes) && !bronSleutel) return;
  void planSync();
});
```

with:

```ts
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const bronSleutel = BRONNEN.some((b) => b.sleutels.aan in changes);
  if (!("kassaOveralAan" in changes) && !bronSleutel) return;
  void planSync();
});
```

- [ ] **Step 6: Rewrite `siteVanAfzender` into `hostVanAfzender`**

Replace:

```ts
function siteVanAfzender(sender: chrome.runtime.MessageSender): Site | null {
  const url = sender.url;
  if (!url) return null;

  const site = siteForUrl(url);
  if (!site) return null;

  if (sender.origin) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return null;
    }
    if (sender.origin !== origin) return null;
  }

  const tabUrl = sender.tab?.url;
  if (tabUrl !== undefined && siteForUrl(tabUrl)?.id !== site.id) return null;

  return site;
}
```

with:

```ts
/** De host van de afzender, geverifieerd — of null als er iets niet klopt.
 *
 *  Dezelfde drie eisen als voorheen (`siteVanAfzender`), nu zonder een vaste
 *  sitelijst om ze tegen af te zetten: het schema is https, geen poort,
 *  `sender.origin` (indien aanwezig) hoort bij dezelfde URL, en het tabblad
 *  (indien bekend) hoort bij dezelfde ORIGIN — niet meer bij hetzelfde
 *  "site.id", want dat bestaat niet meer sinds er geen sitelijst meer is. */
function hostVanAfzender(sender: chrome.runtime.MessageSender): string | null {
  const url = sender.url;
  if (!url) return null;

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.port !== "") return null;

  if (sender.origin && sender.origin !== u.origin) return null;

  const tabUrl = sender.tab?.url;
  if (tabUrl !== undefined) {
    let tu: URL;
    try {
      tu = new URL(tabUrl);
    } catch {
      return null;
    }
    if (tu.origin !== u.origin) return null;
  }

  return u.hostname.toLowerCase();
}
```

- [ ] **Step 7: Update `beantwoord` to use the new host-based validation**

Replace the start of `beantwoord`:

```ts
async function beantwoord(sender: chrome.runtime.MessageSender): Promise<PaneelAntwoord> {
  const site = siteVanAfzender(sender);
  if (!site) return { soort: "zwijg", reden: "afzender hoort niet bij een ondersteunde winkel" };

  const aangevinkt = await getEnabledSiteIds();
  if (!(await magDraaien(site, aangevinkt))) {
    return { soort: "zwijg", reden: `${site.id} staat uit` };
  }
```

with:

```ts
async function beantwoord(sender: chrome.runtime.MessageSender): Promise<PaneelAntwoord> {
  const host = hostVanAfzender(sender);
  if (!host) return { soort: "zwijg", reden: "afzender is geen geldige https-pagina" };

  if (!(await kassaMagDraaien())) {
    return { soort: "zwijg", reden: "kassa-overal staat uit" };
  }
```

Then, further down in the same function, replace the post-injection host recheck:

```ts
  const verwachteHost = ontleedMatch(site.match)?.host;
  if (!verwachteHost || evidence.host.toLowerCase() !== verwachteHost) {
    return { soort: "zwijg", reden: "de pagina is tijdens het lezen veranderd" };
  }
```

with:

```ts
  if (evidence.host.toLowerCase() !== host) {
    return { soort: "zwijg", reden: "de pagina is tijdens het lezen veranderd" };
  }
```

Everything else in `beantwoord` (the `tabId` check, the `executeScript` call, `readCheckout`, `pointsCoverage`, `rankCheckout`, the `aanbodVoorWinkel` loop, `buildPanel`) stays exactly as it is — none of it referenced `Site`.

- [ ] **Step 8: Typecheck**

Run: `cd apps/extension && pnpm exec tsc --noEmit`
Expected: errors only in files not yet updated (Tasks 6–8) — `background.ts` itself should be clean. If `background.ts` still shows an error, re-check Steps 1–7 for a missed reference to `Site`/`SITES`/`siteForUrl`/`ontleedMatch`/`magDraaien`/`regId`/`getEnabledSiteIds`/`setEnabledSiteIds`.

- [ ] **Step 9: Commit**

```bash
git add apps/extension/src/background.ts
git commit -m "feat(extensie): background.ts registreert kassa-paneel breed i.p.v. per site"
```

---

### Task 6: Update `background.test.ts`

**Files:**
- Modify: `apps/extension/src/background.test.ts`

- [ ] **Step 1: Replace the `IKEA_MATCH` constant and its usages**

Replace:

```ts
const IKEA_MATCH = "https://www.ikea.com/nl/nl/p/*";
```

with:

```ts
const KASSA_MATCH = "<all_urls>";
```

- [ ] **Step 2: Update the one test that compares a site-registration against a bron-registration**

This is the only place in the file that actually sets up `enabledSiteIds`/`IKEA_MATCH` (search confirmed: `IKEA_MATCH` appears at the constant declaration, in this one test, and once more in an unrelated Amex cross-tab test — see the note at the end of this step). Find, inside the `describe` block that compares which `js` file gets registered for a bron vs. a site:

```ts
    reset();
    opslag.set("enabledSiteIds", ["ikea-nl"]);
    toegestaan.add(IKEA_MATCH);
    await sync();
    expect(scripts.map((s) => s.js?.[0])).toEqual(["content.js"]);
```

Replace with:

```ts
    reset();
    opslag.set("kassaOveralAan", true);
    toegestaan.add(KASSA_MATCH);
    await sync();
    expect(scripts.map((s) => s.js?.[0])).toEqual(["content.js"]);
```

The other `IKEA_MATCH`-adjacent reference (a hardcoded `"https://www.ikea.com/nl/nl/p/billy"` tab URL inside an Amex cross-tab-mismatch test, in the `describe("wie er antwoord krijgt op een leesverzoek")` block) is unrelated to the site list — it's only used there as an arbitrary "the tab is on some other page" foil for testing `bronVanAfzender`'s tab/sender mismatch detection. Leave it exactly as it is; it doesn't reference `IKEA_MATCH` or any site-list concept and needs no change.

- [ ] **Step 3: Add a new test proving the broad gate's two-condition symmetry**

Add this near the existing registration tests (find the `describe` block that currently exercises IKEA-based registration and add the following `it` inside it, or as a new sibling `describe`):

```ts
describe("de brede kassa-toestemming heeft twee onafhankelijke schakelaars", () => {
  it("registreert niets als het vinkje aan staat maar de toestemming ontbreekt", async () => {
    opslag.set("kassaOveralAan", true);
    await sync();
    expect(scripts.some((s) => s.id === "paneel-kassa-overal")).toBe(false);
  });

  it("registreert niets als de toestemming er is maar het vinkje uit staat", async () => {
    toegestaan.add(KASSA_MATCH);
    opslag.set("kassaOveralAan", false);
    await sync();
    expect(scripts.some((s) => s.id === "paneel-kassa-overal")).toBe(false);
  });

  it("registreert <all_urls> zodra beide aan staan", async () => {
    toegestaan.add(KASSA_MATCH);
    opslag.set("kassaOveralAan", true);
    await sync();
    const kassa = scripts.find((s) => s.id === "paneel-kassa-overal");
    expect(kassa?.matches).toEqual([KASSA_MATCH]);
    expect(kassa?.js).toEqual(["content.js"]);
  });

  it("haalt de registratie weg en zet het vinkje uit zodra de toestemming wordt ingetrokken", async () => {
    toegestaan.add(KASSA_MATCH);
    opslag.set("kassaOveralAan", true);
    await sync();
    expect(scripts.some((s) => s.id === "paneel-kassa-overal")).toBe(true);

    toegestaan.delete(KASSA_MATCH);
    for (const cb of luister.verwijderd) cb();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(scripts.some((s) => s.id === "paneel-kassa-overal")).toBe(false);
    expect(opslag.get("kassaOveralAan")).toBe(false);
  });
});
```

Use the file's existing `sync()` helper (defined around line 118: fires every `luister.geinstalleerd` callback, then flushes 20 microtask rounds) and the same manual `luister.verwijderd`-plus-flush pattern the existing `"intrekken doet het opgeslagene weg, ook buiten ons scherm om"` describe block already uses — do not introduce a new helper. `beforeEach(reset)` (already registered in the file) clears `opslag`/`toegestaan`/`scripts` before every test, so no manual reset is needed inside these four.

- [ ] **Step 4: Add tests for `beantwoord`'s sender/tab validation (the `hostVanAfzender` rewrite from Task 5)**

This file currently has zero tests exercising a `"paneel-vragen"` message at all — every existing test in `describe("wie er antwoord krijgt op een leesverzoek")` covers `"aanbod-vragen"` (the ING/Amex bron flow) only. Add a new `describe` block covering the four gating paths that don't require a real product-page reading (and therefore don't depend on `chrome.scripting.executeScript`'s mock, which really invokes `collectEvidence` against jsdom's own `location.host` — see the note after this step for why a "successful reading" test is deliberately not included here):

```ts
describe("wie er antwoord krijgt op een paneel-vraag", () => {
  it("zwijgt zolang kassa-overal uitstaat, ook als de toestemming er is", async () => {
    toegestaan.add(KASSA_MATCH);
    opslag.set("kassaOveralAan", false);
    const a = (await stuur({ soort: "paneel-vragen" }, {
      tab: { id: 7, url: "https://www.ikea.com/nl/nl/p/billy" },
      url: "https://www.ikea.com/nl/nl/p/billy",
      origin: "https://www.ikea.com",
    })) as { soort: string; reden?: string };
    expect(a.soort).toBe("zwijg");
    expect(a.reden).toBe("kassa-overal staat uit");
  });

  it("zwijgt tegen een afzender die geen https is", async () => {
    toegestaan.add(KASSA_MATCH);
    opslag.set("kassaOveralAan", true);
    const a = (await stuur({ soort: "paneel-vragen" }, {
      tab: { id: 7, url: "http://www.ikea.com/nl/nl/p/billy" },
      url: "http://www.ikea.com/nl/nl/p/billy",
      origin: "http://www.ikea.com",
    })) as { soort: string; reden?: string };
    expect(a.soort).toBe("zwijg");
    expect(a.reden).toBe("afzender is geen geldige https-pagina");
  });

  it("zwijgt als het tabblad ergens anders staat dan het frame dat vraagt", async () => {
    toegestaan.add(KASSA_MATCH);
    opslag.set("kassaOveralAan", true);
    const a = (await stuur({ soort: "paneel-vragen" }, {
      tab: { id: 7, url: "https://www.hema.nl/" },
      url: "https://www.ikea.com/nl/nl/p/billy",
      origin: "https://www.ikea.com",
    })) as { soort: string; reden?: string };
    expect(a.soort).toBe("zwijg");
    expect(a.reden).toBe("afzender is geen geldige https-pagina");
  });

  it("zwijgt tegen een afwijkende poort", async () => {
    toegestaan.add(KASSA_MATCH);
    opslag.set("kassaOveralAan", true);
    const a = (await stuur({ soort: "paneel-vragen" }, {
      tab: { id: 7, url: "https://www.ikea.com:8443/nl/nl/p/billy" },
      url: "https://www.ikea.com:8443/nl/nl/p/billy",
      origin: "https://www.ikea.com:8443",
    })) as { soort: string; reden?: string };
    expect(a.soort).toBe("zwijg");
    expect(a.reden).toBe("afzender is geen geldige https-pagina");
  });
});
```

**Why there's no "happy path" test here:** this mock's `executeScript` really calls `collectEvidence`, which (per `beantwoord`'s `args: [null, null]`) falls back to jsdom's own `location.host` — and this project's vitest jsdom environment defaults to `http://localhost:3000/`, i.e. a host that includes a port. `hostVanAfzender` rejects any sender URL with a port, so there is no sender URL that is simultaneously (a) a valid, port-less https sender and (b) equal to what `collectEvidence` will report as `evidence.host` inside this mock. This is a pre-existing gap (the old `siteVanAfzender`/`beantwoord` pairing had exactly the same property and was never covered by a "happy path" test in this file either) — not something this task introduces or is expected to fix. The real, working chain is verified by Task 10 Step 4's manual check instead.

- [ ] **Step 5: Run the tests**

Run: `cd apps/extension && pnpm exec vitest run src/background.test.ts`
Expected: PASS. If Step 3's helper name doesn't match, fix it to whatever the file's existing tests call and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/background.test.ts
git commit -m "test(extensie): background.test.ts dekt de brede kassa-toestemming"
```

---

### Task 7: Options UI — one checkbox instead of the per-site list

**Files:**
- Modify: `apps/extension/public/options.html`
- Modify: `apps/extension/src/options.ts`

- [ ] **Step 1: Replace the winkels section markup in `options.html`**

Replace:

```html
  <h2>Op welke winkels mag het paneel verschijnen?</h2>
  <p class="hint">
    Standaard staat alles uit en heeft de extensie geen enkele leestoestemming. Vink je een
    winkel aan, dan vraagt Chrome je apart om toestemming voor dat ene adres; die kun je in
    <code>chrome://extensions</code> altijd weer intrekken. De lijst is kort omdat er alleen
    winkels in staan waarvan we hebben gemeten dat het bedrag dat we lezen ook echt bij de
    pagina hoort.
  </p>
  <div id="siteslijst"></div>
  <p class="hint" id="sites-melding"></p>
```

with:

```html
  <h2>Mag het paneel op winkelpagina's verschijnen?</h2>
  <p class="hint">
    Standaard staat dit uit. Zet je het aan, dan vraagt Chrome toestemming om alle websites te
    lezen — niet per winkel, en dat kun je in <code>chrome://extensions</code> altijd weer
    intrekken. LaVega leest daarbij alleen de machineleesbare productgegevens die een winkel zelf
    op de pagina zet (dezelfde gegevens die zoekmachines gebruiken) — nooit de rest van de pagina.
    Het vergelijkt dat niet met wat er verder op de pagina staat: een winkel die dat verkeerd zet
    (gemeten dat dit gebeurt), kan LaVega niet opvangen. Zwijgen bij twijfel blijft gelden; een
    geldig maar verkeerd bedrag is de uitzondering die dit vinkje accepteert.
  </p>
  <div class="vinkrij">
    <input type="checkbox" id="kassa-overal" />
    <label for="kassa-overal">
      <div class="titel">Paneel op winkelpagina's</div>
    </label>
  </div>
  <p class="hint" id="kassa-melding"></p>
```

- [ ] **Step 2: Replace the site-rendering code in `options.ts`**

Remove the import:

```ts
import { SITES, type Site } from "./sites.js";
```

Change the `store.js` import to swap `getEnabledSiteIds`/`setEnabledSiteIds` for `getKassaOveralAan`/`setKassaOveralAan` (keep every other name in that import list unchanged).

Replace the whole "de winkels" section:

```ts
/* ───────────────────────────── de winkels ────────────────────────────────── */

const sitesLijst = document.getElementById("siteslijst") as HTMLDivElement;
const sitesMelding = document.getElementById("sites-melding") as HTMLParagraphElement;

function meld(tekst: string, fout = false): void {
  sitesMelding.textContent = tekst;
  sitesMelding.className = fout ? "hint fout" : "hint";
}

async function zetSite(site: Site, aan: boolean, vink: HTMLInputElement): Promise<void> {
  const ids = new Set(await getEnabledSiteIds());
  if (aan) {
    ids.add(site.id);
    await setEnabledSiteIds([...ids]);
    meld(`${site.label} staat aan. Herlaad een openstaande winkelpagina om het paneel te zien.`);
  } else {
    ids.delete(site.id);
    await setEnabledSiteIds([...ids]);
    /* Pas ná het vinkje: zie de kop van dit bestand. */
    await chrome.permissions.remove({ origins: [site.match] });
    meld(`${site.label} staat uit. De leestoestemming is ingetrokken.`);
  }
  vink.checked = aan;
}

function tekenSites(aangevinkt: Set<string>, toegestaan: Set<string>): void {
  leeg(sitesLijst);
  for (const site of SITES) {
    const rij = el("div", "vinkrij");
    const vink = document.createElement("input");
    vink.type = "checkbox";
    vink.id = `site-${site.id}`;
    vink.checked = aangevinkt.has(site.id) && toegestaan.has(site.id);

    vink.addEventListener("change", () => {
      const wil = vink.checked;
      if (!wil) {
        void zetSite(site, false, vink);
        return;
      }
      chrome.permissions
        .request({ origins: [site.match] })
        .then((gegeven) => {
          if (!gegeven) {
            vink.checked = false;
            meld(
              `Zonder toestemming voor ${site.match} kan het paneel daar niet verschijnen. Het handmatige veld in het werkbalkvenster werkt wel gewoon.`,
              true,
            );
            return;
          }
          return zetSite(site, true, vink);
        })
        .catch(() => {
          vink.checked = false;
          meld("Chrome heeft het toestemmingsverzoek afgebroken. Probeer het opnieuw.", true);
        });
    });

    const tekst = document.createElement("label");
    tekst.htmlFor = vink.id;
    tekst.appendChild(el("div", "titel", site.label));
    tekst.appendChild(el("div", "noot", `${site.match} — ${site.scope}`));
    tekst.appendChild(el("div", "noot", site.evidence));

    rij.appendChild(vink);
    rij.appendChild(tekst);
    sitesLijst.appendChild(rij);
  }
}
```

with:

```ts
/* ───────────────────────────── de kassa ──────────────────────────────────── */

const KASSA_MATCH = "<all_urls>";
const kassaVink = document.getElementById("kassa-overal") as HTMLInputElement;
const kassaMelding = document.getElementById("kassa-melding") as HTMLParagraphElement;

function meld(tekst: string, fout = false): void {
  kassaMelding.textContent = tekst;
  kassaMelding.className = fout ? "hint fout" : "hint";
}

async function zetKassaOveral(aan: boolean): Promise<void> {
  await setKassaOveralAan(aan);
  kassaVink.checked = aan;
  if (aan) {
    meld("Aan. Herlaad een openstaande winkelpagina om het paneel te zien.");
  } else {
    /* Pas ná het vinkje: zie de kop van dit bestand. */
    await chrome.permissions.remove({ origins: [KASSA_MATCH] });
    meld("Uit. De leestoestemming is ingetrokken.");
  }
}

kassaVink.addEventListener("change", () => {
  const wil = kassaVink.checked;
  if (!wil) {
    void zetKassaOveral(false);
    return;
  }
  /* EERSTE REGEL, zonder await ervoor: zie de kop van dit bestand. */
  chrome.permissions
    .request({ origins: [KASSA_MATCH] })
    .then((gegeven) => {
      if (!gegeven) {
        kassaVink.checked = false;
        meld(
          "Zonder deze toestemming kan het paneel nergens verschijnen. Het handmatige veld in het werkbalkvenster werkt wel gewoon.",
          true,
        );
        return;
      }
      return zetKassaOveral(true);
    })
    .catch(() => {
      kassaVink.checked = false;
      meld("Chrome heeft het toestemmingsverzoek afgebroken. Probeer het opnieuw.", true);
    });
});
```

- [ ] **Step 3: Update the `start()` function's initial rendering**

Replace:

```ts
  const aangevinkteSites = new Set<string>(await getEnabledSiteIds());
  const toegestaan = new Set<string>();
  for (const site of SITES) {
    if (await chrome.permissions.contains({ origins: [site.match] })) toegestaan.add(site.id);
  }
  tekenSites(aangevinkteSites, toegestaan);
```

with:

```ts
  kassaVink.checked =
    (await getKassaOveralAan()) && (await chrome.permissions.contains({ origins: [KASSA_MATCH] }));
```

- [ ] **Step 4: Remove the now-dead `getEnabledSiteIds`/`setEnabledSiteIds` from `store.ts`**

After this task, nothing imports these two functions any more: `background.ts` stopped in Task 5, and Step 2 above just removed `options.ts`'s import of them. Left in place, they'd be dead exports nobody calls — the same kind of unused, misleading code this codebase's own comments warn against elsewhere.

Run: `cd apps/extension && grep -rn "getEnabledSiteIds\|setEnabledSiteIds" src/`
Expected: no results outside `store.ts` itself.

In `apps/extension/src/store.ts`, remove:

```ts
export async function getEnabledSiteIds(): Promise<string[]> {
  const items = await chrome.storage.local.get([KEY_SITES]);
  return _schoonLijst(items[KEY_SITES]);
}

export async function setEnabledSiteIds(ids: readonly string[]): Promise<void> {
  await chrome.storage.local.set({ [KEY_SITES]: schoonLijst(ids) });
}
```

(Read the file first to get the exact surrounding text — the two function bodies above are what Task 5's research found; confirm they match what's actually on disk before deleting, since store.ts wasn't touched by any task between then and now.)

Also remove the now-unused `const KEY_SITES = "enabledSiteIds";` declaration, but only after confirming nothing else in `store.ts` still reads `KEY_SITES` (it shouldn't — it was only ever consumed by the two functions just removed).

- [ ] **Step 5: Typecheck**

Run: `cd apps/extension && pnpm exec tsc --noEmit`
Expected: no errors from `options.ts` or `store.ts`. If `el`/`leeg` in `options.ts` are now reported unused, remove them from the import only if nothing else in the file still uses them (the punten/bronnen sections likely still do — check before removing).

- [ ] **Step 6: Commit**

```bash
git add apps/extension/public/options.html apps/extension/src/options.ts apps/extension/src/store.ts
git commit -m "feat(extensie): optiescherm krijgt één breed kassa-vinkje i.p.v. een sitelijst"
```

---

### Task 8: Delete `sites.ts` and `sites.test.ts`

Everything either file tested now lives elsewhere: `ontleedMatch`/`padIsSpecifiek` moved to `bronnen.ts` (Task 1, with its own test), and the one behavioral assertion about Coolblue that wasn't sites.ts-specific (`readCheckout` returning a confident-but-wrong answer) already exists independently in `read.test.ts` (see Task 9).

**Files:**
- Delete: `apps/extension/src/sites.ts`
- Delete: `apps/extension/src/sites.test.ts`

- [ ] **Step 1: Confirm nothing still imports from `./sites.js`**

Run: `cd apps/extension && grep -rn "from \"\./sites" src/ scripts/`
Expected: no output. If anything shows up, that file was missed in Tasks 5–7 — fix it before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm apps/extension/src/sites.ts apps/extension/src/sites.test.ts
```

- [ ] **Step 3: Full verification**

Run: `cd apps/extension && pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(extensie): sites.ts en sites.test.ts weg — vervangen door de brede kassa-toestemming"
```

---

### Task 9: Document the changed meaning of the Coolblue case in `read.test.ts`

The existing test at `read.test.ts`'s `"echt opgehaalde winkelpagina's"` describe block (`"coolblue.nl: leest 420 EUR uit het JSON-LD Offer, als ARTIKELprijs"`) already proves the exact behavior that used to justify Coolblue's exclusion from `sites.ts`. The assertions don't need to change — only the surrounding comment, since there's no more list for Coolblue to be excluded from.

**Files:**
- Modify: `apps/extension/src/read.test.ts`

- [ ] **Step 1: Add a comment above the existing test**

Find:

```ts
describe("echt opgehaalde winkelpagina's", () => {
  it("coolblue.nl: leest 420 EUR uit het JSON-LD Offer, als ARTIKELprijs", () => {
```

Replace with:

```ts
describe("echt opgehaalde winkelpagina's", () => {
  /* TOT 26 AUGUSTUS 2026 sloot sites.ts coolblue.nl op grond van precies deze
   * test uit: geldige, eenduidige JSON-LD, maar voor een ander artikel dan de
   * pagina toonde (deze AirPods-URL gaf de prijs van een Samsonite kofferset;
   * een Sonos-URL gaf een PlayStation 5). Sinds de brede <all_urls>-toestemming
   * is er geen lijst meer om een domein uit te sluiten — dit is dus niet meer
   * "waarom Coolblue niet meedoet" maar een GEDOCUMENTEERDE, GEACCEPTEERDE
   * beperking van de generieke lezer: readCheckout kan dit soort fout niet
   * onderscheiden van een kloppend antwoord. Zie
   * docs/superpowers/specs/2026-08-26-brede-kassa-toestemming-design.md. */
  it("coolblue.nl: leest 420 EUR uit het JSON-LD Offer, als ARTIKELprijs", () => {
```

- [ ] **Step 2: Run the test**

Run: `cd apps/extension && pnpm exec vitest run src/read.test.ts`
Expected: PASS (unchanged behavior, only a comment added).

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/read.test.ts
git commit -m "docs(extensie): het Coolblue-geval in read.test.ts is nu een geaccepteerde beperking, geen uitsluiting"
```

---

### Task 10: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `cd apps/extension && pnpm exec vitest run`
Expected: all test files pass, including the new/updated `bronnen.test.ts`, `background.test.ts`, `read.test.ts`.

- [ ] **Step 2: Typecheck**

Run: `cd apps/extension && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `cd apps/extension && pnpm build`
Expected: succeeds; `[copy-static]` output lists `<all_urls>` plus the two account matches under "hostrechten gelijk aan het manifest".

- [ ] **Step 4: Manual check (not automatable)**

Reload the unpacked extension in `chrome://extensions` (or `brave://extensions`), open the options page, turn on the new checkbox, accept the broad permission prompt, then visit a real product page (e.g. an IKEA product page, since it's already known to carry clean JSON-LD) and confirm the panel still appears. This is the step that proves the manifest/registration/message-validation chain works end to end outside of mocks — nothing in Tasks 1–9 substitutes for it.

- [ ] **Step 5: No commit for this task** — it's verification only. If Step 1–3 reveal a problem, fix it as part of whichever earlier task's files are implicated, and re-commit there.
