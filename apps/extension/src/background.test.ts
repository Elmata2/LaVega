// @vitest-environment jsdom
/* De service worker, met een nagemaakte chrome.*-laag eronder.
 *
 * ── WAAROM DIT BESTAND ER IS ───────────────────────────────────────────────
 *
 * Alles in deze extensie is zo gebouwd dat de BESLISSINGEN in pure functies
 * staan, en die zijn los getest. Wat daarmee ongetest bleef is de DRAADJES: welk
 * script op welk moment geregistreerd staat, wie er antwoord krijgt op een
 * bericht, en wat er weggaat als een toestemming wordt ingetrokken. Dat zijn
 * precies de drie plekken waar een leestoestemming stilletjes te ruim kan
 * worden.
 *
 * De nagemaakte laag hieronder is klein met opzet: alleen de vijf dingen die
 * background.ts aanroept, met een opslag die zich als een dictionary gedraagt.
 * `executeScript` doet iets bijzonders — hij roept de MEEGEGEVEN FUNCTIE echt
 * aan, tegen een jsdom-document dat we met een fixture vullen. Zo loopt deze
 * test door de hele keten (bericht → herkomstcontrole → injectie → lezing →
 * opslag → zin) in plaats van door een stub die het antwoord al kent. */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AMEX_MATCH } from "./amex.js";
import { ING_MATCH } from "./ing.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const IKEA_MATCH = "https://www.ikea.com/nl/nl/p/*";

type Injectie = { target: { tabId: number }; func: (...a: never[]) => unknown; args?: unknown[] };

const opslag = new Map<string, unknown>();
const toegestaan = new Set<string>();
let scripts: { id: string; matches?: string[]; js?: string[] }[] = [];
const luister = {
  bericht: [] as ((m: unknown, s: unknown, r: (x?: unknown) => void) => unknown)[],
  verwijderd: [] as (() => void)[],
  toegevoegd: [] as (() => void)[],
  geinstalleerd: [] as (() => void)[],
  opslagWijziging: [] as ((c: Record<string, unknown>, a: string) => void)[],
};

/* De echte chrome.d.ts is met de hand geschreven en bevat precies wat de
 * extensie mag aanroepen. Deze nabouw dekt exact diezelfde lijst; komt er een
 * aanroep bij die er niet in staat, dan valt deze test om met "is not a
 * function" — en dat is het moment waarop de vraag "waarom heeft een
 * kassa-extensie dat nodig?" gesteld hoort te worden. */
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onMessage: { addListener: (cb: never) => luister.bericht.push(cb) },
    onInstalled: { addListener: (cb: never) => luister.geinstalleerd.push(cb) },
    onStartup: { addListener: (cb: never) => luister.geinstalleerd.push(cb) },
  },
  storage: {
    local: {
      get: async (keys: string[] | string | null) => {
        const lijst = keys === null ? [...opslag.keys()] : Array.isArray(keys) ? keys : [keys];
        const uit: Record<string, unknown> = {};
        for (const k of lijst) if (opslag.has(k)) uit[k] = opslag.get(k);
        return uit;
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) opslag.set(k, v);
      },
      remove: async (keys: string[] | string) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) opslag.delete(k);
      },
    },
    onChanged: { addListener: (cb: never) => luister.opslagWijziging.push(cb) },
  },
  permissions: {
    contains: async (p: { origins?: string[] }) => (p.origins ?? []).every((o) => toegestaan.has(o)),
    request: async () => true,
    remove: async (p: { origins?: string[] }) => {
      for (const o of p.origins ?? []) toegestaan.delete(o);
      return true;
    },
    onRemoved: { addListener: (cb: never) => luister.verwijderd.push(cb) },
    onAdded: { addListener: (cb: never) => luister.toegevoegd.push(cb) },
  },
  scripting: {
    getRegisteredContentScripts: async () => scripts,
    registerContentScripts: async (s: typeof scripts) => {
      scripts = [...scripts, ...s];
    },
    unregisterContentScripts: async (f: { ids?: string[] }) => {
      scripts = scripts.filter((s) => !(f.ids ?? []).includes(s.id));
    },
    /* Hier zit de waarde van deze nabouw: de meegegeven functie wordt ECHT
     * uitgevoerd, tegen het document van deze test. Een stub die een vast
     * antwoord teruggeeft, zou de injectie overslaan — en dat is de stap waarin
     * de redactiegrens zit. */
    executeScript: async (inj: Injectie) => [
      { frameId: 0, result: inj.func(...((inj.args ?? []) as never[])) },
    ],
  },
};

/* Ná het opzetten van de nabouw, want background.ts zet zijn luisteraars neer
 * zodra hij geïmporteerd wordt. */
await import("./background.js");

function reset(): void {
  opslag.clear();
  toegestaan.clear();
  scripts = [];
  document.body.innerHTML = "";
}

/** Vuurt ALLE registratie-gebeurtenissen af, dus twee syncs achter elkaar.
 *
 *  Dat is met opzet en het heeft een bug gevonden: `syncRegistraties` is alleen
 *  idempotent als hij niet tegelijk met zichzelf draait, en het optiescherm laat
 *  bij het aanzetten van een schakelaar twee gebeurtenissen los (een verleende
 *  toestemming en een schrijfactie). Zonder de wachtrij in background.ts stond
 *  `amex-content.js` hier twee keer in de lijst, en Chrome zou de tweede
 *  registratie afwijzen met "Duplicate script ID". */
async function sync(): Promise<void> {
  for (const cb of luister.geinstalleerd) cb();
  /* De luisteraars starten hun werk met `void (async …)`; één microtaakronde is
   * niet genoeg omdat er meerdere awaits achter elkaar staan. */
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function stuur(bericht: unknown, sender: unknown): Promise<unknown> {
  return new Promise((klaar) => {
    for (const cb of luister.bericht) cb(bericht, sender, klaar);
  });
}

const AMEX_SENDER = {
  tab: { id: 7, url: "https://global.americanexpress.com/offers/eligible" },
  url: "https://global.americanexpress.com/offers/eligible",
  origin: "https://global.americanexpress.com",
};

const ING_SENDER = {
  tab: { id: 8, url: "https://mijn.ing.nl/punten/overview" },
  url: "https://mijn.ing.nl/punten/overview",
  origin: "https://mijn.ing.nl",
};

beforeEach(reset);

describe("welk script waar geregistreerd staat", () => {
  it("registreert niets zolang er niets aanstaat", async () => {
    await sync();
    expect(scripts).toEqual([]);
  });

  it("registreert de aanbiedingenlezer alleen als de schakelaar ÉN de toestemming er zijn", async () => {
    /* Alleen het vinkje: Chrome heeft niets gegeven, dus er hoort niets te
     * draaien. Een registratie zonder toestemming zou stil falen. */
    opslag.set("amexAan", true);
    await sync();
    expect(scripts).toEqual([]);

    toegestaan.add(AMEX_MATCH);
    await sync();
    expect(scripts.map((s) => s.js?.[0])).toEqual(["aanbod-content.js"]);
    expect(scripts[0]!.matches).toEqual([AMEX_MATCH]);
  });

  it("zet de winkeltoestemming NIET aan door de Amex-schakelaar, en omgekeerd ook niet", async () => {
    /* Twee vragen, twee antwoorden. Dit is de hele reden dat dit een aparte
     * schakelaar is en geen extra vinkje in de winkellijst. */
    opslag.set("amexAan", true);
    toegestaan.add(AMEX_MATCH);
    await sync();
    expect(scripts.map((s) => s.js?.[0])).toEqual(["aanbod-content.js"]);

    reset();
    opslag.set("enabledSiteIds", ["ikea-nl"]);
    toegestaan.add(IKEA_MATCH);
    await sync();
    expect(scripts.map((s) => s.js?.[0])).toEqual(["content.js"]);
  });

  it("haalt de registratie weg zodra de schakelaar uitgaat", async () => {
    opslag.set("amexAan", true);
    toegestaan.add(AMEX_MATCH);
    await sync();
    expect(scripts).toHaveLength(1);

    opslag.set("amexAan", false);
    await sync();
    expect(scripts).toEqual([]);
  });
});

describe("intrekken doet het opgeslagene weg, ook buiten ons scherm om", () => {
  it("wist de gelezen aanbiedingen als de host-toestemming verdwijnt", async () => {
    /* De route via chrome://extensions. Daar komt hij nooit langs de schakelaar
     * in het optiescherm, en zou de gelezen lijst dus blijven staan terwijl hij
     * net heeft gezegd dat LaVega daar niet meer mag kijken. */
    opslag.set("amexAan", true);
    opslag.set("amexAanbiedingen", [
      { winkel: "JBL", prijsTekst: "30% korting", tot: null, totRuw: "", domein: "jbl.nl", gelezenOp: "2026-08-22" },
    ]);
    opslag.set("amexLezing", { uitkomst: "gelezen", aantal: 1, op: "2026-08-22", citaat: "" });
    toegestaan.add(AMEX_MATCH);
    await sync();

    toegestaan.delete(AMEX_MATCH);
    for (const cb of luister.verwijderd) cb();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(opslag.has("amexAanbiedingen")).toBe(false);
    expect(opslag.has("amexLezing")).toBe(false);
    expect(opslag.has("amexAan")).toBe(false);
    expect(scripts).toEqual([]);
  });
});

describe("wie er antwoord krijgt op een leesverzoek", () => {
  it("zwijgt tegen een ander pad op hetzelfde domein", async () => {
    /* Het rekeningoverzicht met zijn saldo en zijn transacties staat op dezelfde
     * host. De belofte onder de schakelaar is dat alleen de aanbiedingenpagina
     * gelezen wordt, en dit is de plek waar die belofte waar wordt gemaakt. */
    opslag.set("amexAan", true);
    toegestaan.add(AMEX_MATCH);
    await sync();
    const a = (await stuur({ soort: "aanbod-vragen" }, {
      tab: { id: 7, url: "https://global.americanexpress.com/activity" },
      url: "https://global.americanexpress.com/activity",
      origin: "https://global.americanexpress.com",
    })) as { soort: string };
    expect(a.soort).toBe("zwijg");
    expect(opslag.has("amexAanbiedingen")).toBe(false);
  });

  it("zwijgt als het tabblad ergens anders staat dan het frame dat vraagt", async () => {
    opslag.set("amexAan", true);
    toegestaan.add(AMEX_MATCH);
    await sync();
    const a = (await stuur({ soort: "aanbod-vragen" }, {
      tab: { id: 7, url: "https://www.ikea.com/nl/nl/p/billy" },
      url: "https://global.americanexpress.com/offers/eligible",
      origin: "https://global.americanexpress.com",
    })) as { soort: string };
    expect(a.soort).toBe("zwijg");
  });

  it("zwijgt zolang de schakelaar uitstaat, ook al staat de toestemming er nog", async () => {
    toegestaan.add(AMEX_MATCH);
    await sync();
    const a = (await stuur({ soort: "aanbod-vragen" }, AMEX_SENDER)) as { soort: string };
    expect(a.soort).toBe("zwijg");
  });

  it("leest, slaat op en meldt terug wat er gelezen is", async () => {
    opslag.set("amexAan", true);
    toegestaan.add(AMEX_MATCH);
    await sync();

    /* De injectie draait tegen DIT document, dus de fixture komt hier te staan.
     * Zo loopt de test door de echte lezer in plaats van door een stub. */
    const html = readFileSync(join(FIXTURES, "kunstmatig-amex-aanbiedingen.html"), "utf8");
    document.documentElement.innerHTML = html.slice(html.indexOf("<body"));

    const a = (await stuur({ soort: "aanbod-vragen" }, AMEX_SENDER)) as {
      soort: string;
      gelukt: boolean;
      opnieuw: boolean;
      regel: string;
      noot: string;
    };
    expect(a.soort).toBe("melding");
    expect(a.gelukt).toBe(true);
    expect(a.opnieuw).toBe(false);
    expect(a.regel).toContain("5 aanbiedingen");
    expect(a.regel).toContain("JBL");
    expect(a.noot).toContain("saldo");

    const bewaard = opslag.get("amexAanbiedingen") as { winkel: string; gelezenOp: string }[];
    expect(bewaard.map((x) => x.winkel)).toEqual(["JBL", "Nike", "bol.com", "Zalando", "HEMA"]);
    /* Elke bewaarde aanbieding draagt de dag waarop hij gelezen is. Zonder dat
     * is er aan een kassa geen manier om te zeggen hoe oud hij is. */
    for (const b of bewaard) expect(b.gelezenOp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    /* En er staat niets van de rest van de pagina in de opslag. */
    const alles = JSON.stringify([...opslag.entries()]);
    expect(alles).not.toContain("Alexander");
    expect(alles).not.toContain("12.345");
    expect(alles).not.toContain("91007");
  });

  it("laat een eerder gelezen lijst staan als de volgende lezing niets oplevert", async () => {
    /* De lijst en de poging beantwoorden verschillende vragen. Een mislukte
     * poging mag geen vier aanbiedingen wissen die we gewoon hebben — met hun
     * eigen, oudere leesdatum eronder. */
    opslag.set("amexAan", true);
    toegestaan.add(AMEX_MATCH);
    opslag.set("amexAanbiedingen", [
      { winkel: "JBL", prijsTekst: "30% korting", tot: null, totRuw: "", domein: "jbl.nl", gelezenOp: "2026-08-19" },
    ]);
    await sync();

    const html = readFileSync(join(FIXTURES, "kunstmatig-amex-blok-veranderd.html"), "utf8");
    document.documentElement.innerHTML = html.slice(html.indexOf("<body"));

    const a = (await stuur({ soort: "aanbod-vragen" }, AMEX_SENDER)) as { gelukt: boolean; opnieuw: boolean; regel: string };
    expect(a.gelukt).toBe(false);
    /* En hij mag het over een paar seconden nog eens vragen: de pagina bouwt
     * haar aanbiedingen na het laden op, dus "nog niets" kan "nog niet klaar"
     * betekenen. */
    expect(a.opnieuw).toBe(true);
    const bewaard = opslag.get("amexAanbiedingen") as { winkel: string; gelezenOp: string }[];
    expect(bewaard).toHaveLength(1);
    expect(bewaard[0]!.gelezenOp).toBe("2026-08-19");
  });

  it("vraagt niet door als de pagina zelf zegt dat er niets klaarstaat", async () => {
    opslag.set("amexAan", true);
    toegestaan.add(AMEX_MATCH);
    await sync();
    const html = readFileSync(join(FIXTURES, "kunstmatig-amex-geen-aanbiedingen.html"), "utf8");
    document.documentElement.innerHTML = html.slice(html.indexOf("<body"));
    const a = (await stuur({ soort: "aanbod-vragen" }, AMEX_SENDER)) as { opnieuw: boolean; regel: string };
    expect(a.opnieuw).toBe(false);
    expect(a.regel).toContain("zegt zelf");
  });
});

/* ──────────────── twee bronnen die elkaar niet aanzetten ──────────────────── */

describe("de ING Winkel staat naast Amex en niet in plaats van", () => {
  it("registreert per bron apart, en de een zet de ander niet aan", async () => {
    /* DE KERN VAN DE OPDRACHT. Wie ja zei tegen zijn Amex-account heeft geen ja
     * gezegd tegen zijn ING-account. Twee schakelaars, twee hostrechten, en geen
     * van beide zet de ander aan. */
    opslag.set("ingAan", true);
    toegestaan.add(ING_MATCH);
    await sync();
    expect(scripts.map((s) => s.matches?.[0])).toEqual([ING_MATCH]);
    /* Eén content script voor beide bronnen: geen tweede kopie van dezelfde
     * strook. */
    expect(scripts.map((s) => s.js?.[0])).toEqual(["aanbod-content.js"]);

    reset();
    opslag.set("amexAan", true);
    toegestaan.add(AMEX_MATCH);
    await sync();
    expect(scripts.map((s) => s.matches?.[0])).toEqual([AMEX_MATCH]);
  });

  it("registreert er twee zodra allebei aanstaan", async () => {
    opslag.set("amexAan", true);
    opslag.set("ingAan", true);
    toegestaan.add(AMEX_MATCH);
    toegestaan.add(ING_MATCH);
    await sync();
    expect(scripts.map((s) => s.matches?.[0]).sort()).toEqual([AMEX_MATCH, ING_MATCH].sort());
    /* En elk maar één keer, ook al draait sync twee keer achter elkaar. */
    expect(new Set(scripts.map((s) => s.id)).size).toBe(2);
  });

  it("staat de ING-schakelaar niet toe zonder de ING-toestemming", async () => {
    opslag.set("ingAan", true);
    toegestaan.add(AMEX_MATCH);
    await sync();
    expect(scripts).toEqual([]);
  });

  it("leest de ING Winkel en slaat alleen ING-sleutels op", async () => {
    document.body.innerHTML = readFileSync(
      join(FIXTURES, "kunstmatig-ing-winkel.html"),
      "utf8",
    );
    opslag.set("ingAan", true);
    toegestaan.add(ING_MATCH);
    await sync();

    const antwoord = (await stuur({ soort: "aanbod-vragen" }, ING_SENDER)) as {
      soort: string;
      gelukt: boolean;
      regel: string;
    };
    expect(antwoord.soort).toBe("melding");
    expect(antwoord.gelukt).toBe(true);
    expect(antwoord.regel).toContain("artikelen");

    /* De ING-lijst staat in de opslag en de Amex-sleutels zijn niet aangeraakt. */
    expect(opslag.has("ingAanbiedingen")).toBe(true);
    expect(opslag.has("amexAanbiedingen")).toBe(false);
    expect(opslag.has("amexLezing")).toBe(false);

    /* En zijn saldo zit er niet in — de hele weg door, niet alleen in de lezer. */
    const alles = JSON.stringify([...opslag.entries()]);
    expect(alles).not.toContain("3.450");
    expect(alles).not.toContain("Alexander");
    expect(alles).not.toContain("NL02");
  });

  it("antwoordt niet op een ING-pagina als alleen Amex aanstaat", async () => {
    /* De afzendercontrole gaat op `sender.url`, en de schakelaar wordt per bron
     * opnieuw gelezen. Een pagina kan zich dus niet voor de andere bron uitgeven
     * om diens lijst te laten overschrijven. */
    opslag.set("amexAan", true);
    toegestaan.add(AMEX_MATCH);
    await sync();

    const antwoord = (await stuur({ soort: "aanbod-vragen" }, ING_SENDER)) as { soort: string };
    expect(antwoord.soort).toBe("zwijg");
    expect(opslag.has("ingAanbiedingen")).toBe(false);
  });

  it("wist bij een ingetrokken ING-toestemming alleen de ING-gegevens", async () => {
    /* De route die buiten ons scherm om loopt: hij trekt de toestemming in via
     * chrome://extensions. Dan hoort de ING-lijst weg te zijn — en de Amex-lijst
     * te blijven staan, want dat was een andere vraag met een ander antwoord. */
    opslag.set("amexAan", true);
    opslag.set("amexAanbiedingen", [
      { winkel: "JBL", prijsTekst: "30% korting", gelezenOp: "2026-08-22", tot: null, totRuw: "", domein: "jbl.nl" },
    ]);
    opslag.set("ingAan", true);
    opslag.set("ingAanbiedingen", [
      {
        winkel: "JBL Flip 6",
        prijsTekst: "1.250 punten",
        prijs: { punten: 1250, bij: null },
        gelezenOp: "2026-08-22",
        tot: null,
        totRuw: "",
        domein: null,
      },
    ]);
    toegestaan.add(AMEX_MATCH);
    toegestaan.add(ING_MATCH);
    await sync();

    /* Chrome meldt dat de ING-toestemming weg is. */
    toegestaan.delete(ING_MATCH);
    for (const cb of luister.verwijderd) cb();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(opslag.has("ingAan")).toBe(false);
    expect(opslag.has("ingAanbiedingen")).toBe(false);
    /* En Amex is niet aangeraakt. */
    expect(opslag.get("amexAan")).toBe(true);
    expect(opslag.has("amexAanbiedingen")).toBe(true);
  });
});
