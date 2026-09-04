// @vitest-environment jsdom
/* De aanbiedingenlezer, tegen OPGESLAGEN HTML.
 *
 * ── WAT DEZE SUITE NIET BEWIJST, en dat hoort bovenaan te staan ─────────────
 *
 * Dat de lezer op zijn ECHTE aanbiedingenpagina iets vindt. Die pagina zit
 * achter zijn Amex-login en is bij het bouwen nooit gezien; alle fixtures
 * hieronder heten daarom `kunstmatig-` en zijn met de hand gemaakt. Wat er wél
 * aan de echte pagina gemeten is, staat in de kop van elke fixture en in de kop
 * van amex.ts: HTTP 200, 676.522 bytes, nul aanbiedingen, en drie
 * `axp-offers-*`-modules die de lijst na het inloggen in de browser opbouwen.
 *
 * Wat deze suite WEL bewijst, en dat is precies het deel dat een gok kan
 * afvangen: dat de extensie bij elke manier waarop de lezing kan mislukken de
 * juiste oorzaak noemt, dat ze bij twijfel niets koppelt, en dat er niets van
 * die pagina meekomt behalve de winkelnaam, de korting en de einddatum. */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AMEX_MATCH,
  AMEX_BRON,
  AANBOD_OUD_NA_DAGEN,
  AANBOD_TE_OUD_NA_DAGEN,
  aanbodVoorWinkel,
  amexUrlIsAanbiedingen,
  collectAanbod,
  domeinVanKaart,
  hoortBijWinkel,
  mogelijkeMerknaamMatch,
  mogelijkeProductMatch,
  leesAanbod,
  leesEinddatum,
  registreerbaarDomein,
  type Aanbieding,
  type AanbodToestand,
} from "./amex.js";
import { aanbodBlok, aanbodLijst } from "./panel.js";
import { aanbodRegel, aanbodStrook, aanbodToestandRegel } from "./lines.js";
import { _schoonAanbod, _schoonLezing } from "./store.js";
import { padIsSpecifiek, ontleedMatch } from "./bronnen.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const NU = "2026-08-22";

function lees(naam: string, asOf = NU) {
  const html = readFileSync(join(FIXTURES, naam), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return leesAanbod(collectAanbod(doc), asOf);
}

function aanbieding(p: Partial<Aanbieding> & { winkel: string }): Aanbieding {
  return { prijsTekst: "10% korting", tot: null, totRuw: "", domein: null, gelezenOp: NU, ...p };
}

/* ─────────────────────── waar de extensie mag kijken ─────────────────────── */

describe("het adres waar dit op rust", () => {
  it("wijst een PAD aan en niet een heel domein", () => {
    /* Zonder deze eis staat er in Chrome's toestemmingsvenster "alles op
     * global.americanexpress.com" — inclusief het rekeningoverzicht met zijn
     * saldo en zijn transacties. De build weigert zo'n patroon ook (controle 4
     * in copy-static.mjs); dit is dezelfde eis, op de plek waar hij te lezen is. */
    expect(padIsSpecifiek(AMEX_MATCH)).toBe(true);
    expect(ontleedMatch(AMEX_MATCH)?.padPrefix).toBe("/offers/eligible");
  });

  it("laat alleen de aanbiedingenpagina door, en niets anders op dat domein", () => {
    expect(amexUrlIsAanbiedingen("https://global.americanexpress.com/offers/eligible")).toBe(true);
    expect(amexUrlIsAanbiedingen("https://global.americanexpress.com/offers/eligible?loc=nl")).toBe(
      true,
    );
    /* Zijn rekening, zijn transacties, zijn profiel: allemaal nee. */
    expect(amexUrlIsAanbiedingen("https://global.americanexpress.com/activity")).toBe(false);
    expect(amexUrlIsAanbiedingen("https://global.americanexpress.com/dashboard")).toBe(false);
    expect(amexUrlIsAanbiedingen("https://global.americanexpress.com/")).toBe(false);
    /* En een origin zonder pad ook niet: wie hier een origin in stopt, heeft de
     * volledige URL niet en hoort geen ja te krijgen. */
    expect(amexUrlIsAanbiedingen("https://global.americanexpress.com")).toBe(false);
    /* Een andere host die er zo uitziet, en een andere poort. */
    expect(
      amexUrlIsAanbiedingen("https://global.americanexpress.com.kwaad.nl/offers/eligible"),
    ).toBe(false);
    expect(amexUrlIsAanbiedingen("http://global.americanexpress.com/offers/eligible")).toBe(false);
    expect(amexUrlIsAanbiedingen("https://global.americanexpress.com:8443/offers/eligible")).toBe(
      false,
    );
  });
});

/* ────────────────────────── wat er van de pagina komt ─────────────────────── */

describe("de nagebouwde aanbiedingenpagina", () => {
  it("leest vijf aanbiedingen en laat de kaart zonder korting liggen", () => {
    const { lezing, aanbiedingen } = lees("kunstmatig-amex-aanbiedingen.html");
    expect(lezing.uitkomst).toBe("gelezen");
    expect(aanbiedingen.map((a) => a.winkel)).toEqual([
      "JBL",
      "Nike",
      "bol.com",
      "Zalando",
      "HEMA",
    ]);
    /* Rituals staat er wel op de pagina maar draagt geen leesbare korting. Een
     * halve aanbieding is geen aanbieding: liever een regel minder dan een regel
     * met een lege plek waar het aanbod hoort te staan. */
    expect(aanbiedingen.some((a) => a.winkel === "Rituals")).toBe(false);
  });

  it("neemt de korting mee zoals hij er staat, met de drempel erbij", () => {
    const { aanbiedingen } = lees("kunstmatig-amex-aanbiedingen.html");
    const jbl = aanbiedingen.find((a) => a.winkel === "JBL")!;
    expect(jbl.prijsTekst).toBe("30% korting · 500 Membership Rewards punten");

    /* "€ 10 terug" zonder "bij besteding van € 50" zou een korting zijn zonder
     * de voorwaarde waaronder hij geldt — dezelfde fout als een cashbackcijfer
     * zonder plafond. En de volgorde volgt de kaart, niet onze patroonlijst. */
    const hema = aanbiedingen.find((a) => a.winkel === "HEMA")!;
    expect(hema.prijsTekst).toBe("€ 10 terug · bij besteding van € 50");
    const bol = aanbiedingen.find((a) => a.winkel === "bol.com")!;
    expect(bol.prijsTekst).toBe("Besteed € 100 · € 20 terug");
  });

  it("leest de einddatum, ook de relatieve, en weigert de dubbelzinnige", () => {
    const { aanbiedingen } = lees("kunstmatig-amex-aanbiedingen.html");
    expect(aanbiedingen.find((a) => a.winkel === "JBL")!.tot).toBe("2026-12-31");
    expect(aanbiedingen.find((a) => a.winkel === "Nike")!.tot).toBe("2026-11-30");
    /* "Verloopt over 5 dagen" is eenduidig zodra je de peildatum hebt. */
    expect(aanbiedingen.find((a) => a.winkel === "bol.com")!.tot).toBe("2026-08-27");
    /* "05/03/2026" is 5 maart of 3 mei, en dat verschil is twee maanden. Dan
     * geen datum, maar wel de tekst — zodat de zin kan zeggen wat er stond. */
    const zalando = aanbiedingen.find((a) => a.winkel === "Zalando")!;
    expect(zalando.tot).toBe(null);
    expect(zalando.totRuw).toBe("Geldig tot 05/03/2026");
    /* En een aanbieding zonder einddatum draagt een lege ruwe tekst, want dat is
     * een ander soort onbekend dan een onleesbare datum. */
    expect(aanbiedingen.find((a) => a.winkel === "HEMA")!.tot).toBe("2026-07-01");
  });

  it("neemt van die pagina NIETS mee behalve winkel, korting en einddatum", () => {
    /* De fixture draagt met opzet een naam, een saldo en een kaartnummer. Dit is
     * de grens waar de hele toestemming op rust: niet dat we die drie netjes
     * weggooien, maar dat ze er nooit in komen — de lezer knipt alleen wat op een
     * patroon past, en die patronen staan in collectAanbod. */
    const html = readFileSync(join(FIXTURES, "kunstmatig-amex-aanbiedingen.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ruw = collectAanbod(doc);
    const alles = JSON.stringify(ruw);

    expect(html).toContain("Alexander Steunenberg");
    expect(html).toContain("12.345,67");
    expect(html).toContain("91007");
    expect(alles).not.toContain("Alexander");
    expect(alles).not.toContain("Steunenberg");
    expect(alles).not.toContain("12.345");
    expect(alles).not.toContain("91007");
    expect(alles).not.toContain("Platinum");

    /* En de velden zelf zijn de hele lijst: geen paginatekst, geen titel, geen
     * pad. Verandert deze lijst, dan verandert de belofte onder de schakelaar. */
    for (const k of ruw.kandidaten) {
      expect(Object.keys(k).sort()).toEqual(["hosts", "prijsTekst", "totRuw", "winkel"]);
    }
    expect(Object.keys(ruw).sort()).toEqual([
      "geenAanbiedingen",
      "inlogformulier",
      "kandidaten",
      "markers",
    ]);
  });

  it("telt een aanbieding één keer, ook al past het omhullende lijstje op dezelfde selector", () => {
    /* `_offerList_` en `_offersHub_` bevatten allebei "offer" in hun klassenaam
     * en komen dus in de kandidatenlijst. Zonder de van-binnen-naar-buiten-regel
     * zou dezelfde aanbieding drie keer verschijnen, één keer per nesting. */
    const { aanbiedingen } = lees("kunstmatig-amex-aanbiedingen.html");
    expect(aanbiedingen.filter((a) => a.winkel === "JBL")).toHaveLength(1);
  });
});

describe("de lezer staat op zichzelf, want Chrome stuurt hem als TEKST naar de pagina", () => {
  it("werkt ook zonder de module eromheen", () => {
    /* DIT IS DE FOUT DIE JE NIET ZIET. `chrome.scripting.executeScript({ func })`
     * serialiseert de functie naar tekst en voert die in de pagina uit; alles wat
     * ze van buiten haar eigen body gebruikt, is daar `undefined` of bestaat
     * niet. In de test hier zou zo'n verwijzing gewoon werken, want daar is de
     * module er wel — en dan valt hij pas in zijn browser om, met de fout in de
     * console van een pagina waar niemand kijkt.
     *
     * `new Function` bouwt haar opnieuw op zonder enige omhullende scope. Dat is
     * precies wat Chrome doet. Zit er één verwijzing naar iets buiten de body,
     * dan gooit deze test een ReferenceError in plaats van dat de gebruiker het
     * over drie weken merkt. */
    const html = readFileSync(join(FIXTURES, "kunstmatig-amex-aanbiedingen.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const losgemaakt = new Function(
      `return (${collectAanbod.toString()})`,
    )() as typeof collectAanbod;
    const ruw = losgemaakt(doc);
    expect(ruw.kandidaten).toHaveLength(5);
    expect(ruw.kandidaten.map((k) => k.winkel)).toEqual([
      "JBL",
      "Nike",
      "bol.com",
      "Zalando",
      "HEMA",
    ]);
  });
});

/* ──────────────── de drie manieren waarop er niets uitkomt ────────────────── */

describe("als er niets te lezen valt, staat er de echte oorzaak", () => {
  it("uitgelogd: dat zegt hij, en hij verzint geen aanbiedingen", () => {
    const { lezing, aanbiedingen } = lees("kunstmatig-amex-uitgelogd.html");
    expect(lezing.uitkomst).toBe("niet-ingelogd");
    expect(aanbiedingen).toHaveLength(0);
    const strook = aanbodStrook(lezing, [], AMEX_BRON);
    expect(strook.regel).toContain("niet ingelogd");
    /* En het advies dat er staat, is op DEZE pagina uit te voeren. */
    expect(strook.regel).toContain("Log in");
  });

  it("het blok is er maar onleesbaar: dat is iets anders dan geen aanbiedingen", () => {
    const { lezing } = lees("kunstmatig-amex-blok-veranderd.html");
    expect(lezing.uitkomst).toBe("blok-zonder-kaarten");
    const strook = aanbodStrook(lezing, [], AMEX_BRON);
    expect(strook.regel).toContain("anders uit dan de lezer verwacht");
    /* Nooit de bewering dat er niets voor hem klaarstaat: dat weten we niet. */
    expect(strook.regel).not.toContain("geen aanbiedingen voor je");
  });

  it("de pagina zegt zelf dat er niets is: een uitgesproken nul, mét citaat", () => {
    /* De keerzijde van "onbekend is nooit nul". Deze uitkomst hoort NIET
     * dezelfde te zijn als die van de onleesbare pagina hierboven. */
    const { lezing } = lees("kunstmatig-amex-geen-aanbiedingen.html");
    expect(lezing.uitkomst).toBe("uitgesproken-geen-aanbiedingen");
    expect(lezing.citaat).toContain("geen aanbiedingen beschikbaar");
    const strook = aanbodStrook(lezing, [], AMEX_BRON);
    expect(strook.regel).toContain("zegt zelf");
    expect(strook.regel).toContain("geen mislukte lezing");
  });

  it("de strook zegt in elke toestand ook wat er NIET gelezen is", () => {
    for (const naam of [
      "kunstmatig-amex-aanbiedingen.html",
      "kunstmatig-amex-uitgelogd.html",
      "kunstmatig-amex-blok-veranderd.html",
      "kunstmatig-amex-geen-aanbiedingen.html",
    ]) {
      const { lezing, aanbiedingen } = lees(naam);
      const strook = aanbodStrook(
        lezing,
        aanbiedingen.map((a) => a.winkel),
        AMEX_BRON,
      );
      expect(strook.noot).toContain("saldo");
      expect(strook.noot).toContain("transacties");
      expect(strook.noot).toContain("kaartnummer");
    }
  });
});

/* ─────────────────────────── de datum uitlezen ────────────────────────────── */

describe("een einddatum wordt gelezen of geweigerd, nooit geraden", () => {
  it("weigert elke cijferdatum die twee datums tegelijk kan zijn", () => {
    expect(leesEinddatum("t/m 05/03/2026", NU)).toBe(null);
    expect(leesEinddatum("t/m 12/11/26", NU)).toBe(null);
    expect(leesEinddatum("t/m 01-02-2027", NU)).toBe(null);
  });

  it("leest hem wel zodra hij zichzelf eenduidig maakt", () => {
    expect(leesEinddatum("t/m 31/12/2026", NU)).toBe("2026-12-31");
    expect(leesEinddatum("expires 12/31/26", NU)).toBe("2026-12-31");
    expect(leesEinddatum("2026-09-30", NU)).toBe("2026-09-30");
    expect(leesEinddatum("t/m 3 mei 2027", NU)).toBe("2027-05-03");
    expect(leesEinddatum("valid through December 31, 2026", NU)).toBe("2026-12-31");
  });

  it("rekent een relatieve datum uit met de peildatum en niet met een klok", () => {
    expect(leesEinddatum("Verloopt over 5 dagen", "2026-08-30")).toBe("2026-09-04");
    expect(leesEinddatum("expires in 1 day", "2026-12-31")).toBe("2027-01-01");
  });

  it("laat een datum die niet bestaat vallen in plaats van hem door te rollen", () => {
    /* JavaScript maakt van 31 februari stilletjes 3 maart. Dan zou er een
     * einddatum op het scherm komen die op de pagina niet stond. */
    expect(leesEinddatum("t/m 31 februari 2027", NU)).toBe(null);
    expect(leesEinddatum("", NU)).toBe(null);
    expect(leesEinddatum("binnenkort", NU)).toBe(null);
  });
});

/* ─────────────────────── de koppeling aan een winkel ──────────────────────── */

describe("een aanbieding wordt op domein gekoppeld, nooit op naam", () => {
  it("rekent een domein uit, ook onder een tweedelig achtervoegsel", () => {
    expect(registreerbaarDomein("www.jbl.nl")).toBe("jbl.nl");
    expect(registreerbaarDomein("shop.jbl.co.uk")).toBe("jbl.co.uk");
    expect(registreerbaarDomein("JBL.NL")).toBe("jbl.nl");
  });

  it("weigert een domein als het achtervoegsel niet bekend is, in plaats van te gokken", () => {
    /* DIT IS DE GEVAARLIJKSTE REGEL VAN HET BESTAND. "Neem de laatste twee
     * delen" geeft bij jbl.co.uk het domein "co.uk", en dan is elke Britse
     * winkel gelijk aan elke andere Britse winkel. */
    expect(registreerbaarDomein("co.uk")).toBe(null);
    expect(registreerbaarDomein("nl")).toBe(null);
    expect(registreerbaarDomein("winkel.onbekendetld")).toBe(null);
    expect(registreerbaarDomein("")).toBe(null);
  });

  it("koppelt JBL aan jbl.nl en NIET aan een naam die erop lijkt", () => {
    const jbl = aanbieding({ winkel: "JBL", domein: "jbl.nl" });
    expect(hoortBijWinkel(jbl, "www.jbl.nl")).toBe(true);
    expect(hoortBijWinkel(jbl, "jbl.nl")).toBe(true);
    /* De fout die deze regel bestaat om te voorkomen. */
    const nike = aanbieding({ winkel: "Nike", domein: "nike.com" });
    expect(hoortBijWinkel(nike, "nike-outlet-fake.nl")).toBe(false);
    expect(hoortBijWinkel(nike, "www.nike.com.kwaad.net")).toBe(false);
  });

  it("mogelijkeMerknaamMatch raakt een titel met de merknaam, en de namaakwinkel niet", () => {
    /* De zwakkere, gehedgde tak (alleen bedoeld voor een PUNTEN-bron; zie
     * aanbodVoorWinkel). Het label van de winkel moet als los woord in de
     * titel voorkomen. */
    const bon = aanbieding({
      winkel: "JBL Tune Flex 2 (zwart) voor € 55 kortingsvoucher",
      domein: null,
    });
    expect(mogelijkeMerknaamMatch(bon, "www.jbl.nl")).toBe(true);
    expect(mogelijkeMerknaamMatch(bon, "jbl.nl")).toBe(true);

    /* Precies de fout die `hoortBijWinkel` niet mag maken, blijft hier ook
     * fout: het label van een namaakwinkel is "jbl-outlet-nep", en dat komt als
     * los woord niet in de titel voor — alleen "jbl" zelf doet dat, en dat is
     * niet hetzelfde label. */
    expect(mogelijkeMerknaamMatch(bon, "jbl-outlet-nep.nl")).toBe(false);
    expect(mogelijkeMerknaamMatch(bon, "www.nike.com")).toBe(false);
  });

  it("mogelijkeMerknaamMatch weigert een te kort label en een winkel zonder afleidbaar domein", () => {
    const bon = aanbieding({ winkel: "ING kortingsvoucher", domein: null });
    /* "ing" is precies 3 tekens en zou op elk woord dat toevallig "ing" bevat
     * kunnen raken als dit geen woordgrens-vergelijking was. Hier gaat het om
     * een kort label op een host dat zelf niet "ing" heet. */
    expect(mogelijkeMerknaamMatch(bon, "co.uk")).toBe(false);
    expect(mogelijkeMerknaamMatch(bon, "winkel.onbekendetld")).toBe(false);

    const kort = aanbieding({ winkel: "Nu-voucher", domein: null });
    expect(mogelijkeMerknaamMatch(kort, "www.nu.nl")).toBe(false);
  });

  it("mogelijkeProductMatch raakt de ECHTE bol.com-titel van hetzelfde artikel", () => {
    /* Dit is de tak die WEL werkt op een marktplaats: bol.com's hostnaam matcht
     * nooit met "JBL", maar de productnaam op de pagina kan dat wel.
     *
     * DE PAGINATITEL HIERONDER IS ECHT, opgehaald op 27 augustus 2026 van
     * bol.com/nl/nl/p/jbl-tune-flex-2-true-wireless-nc-earbuds-black/. Hij staat
     * er letterlijk in omdat hij het gemeten verschil laat zien waar deze
     * functie op stukliep: ING schrijft "(zwart)" en bol.com "Black". */
    const bon = aanbieding({
      winkel: "JBL Tune Flex 2 (zwart) voor € 55 kortingsvoucher",
      domein: null,
    });
    expect(
      mogelijkeProductMatch(bon, "JBL Tune Flex 2 - True Wireless NC Earbuds - Black | bol"),
    ).toBe(true);

    /* Een kleur is een VARIANT en geen eis: de witte pagina raakt óók. Dat is
     * bewust ingeleverde precisie — zie de uitleg bij PRODUCT_MATCH_KLEUREN. */
    expect(mogelijkeProductMatch(bon, "JBL Tune Flex 2 TWS oordopjes wit")).toBe(true);

    /* Een ander JBL-artikel raakt niet: het merk alleen is niet genoeg. */
    expect(mogelijkeProductMatch(bon, "JBL Charge 5 waterdichte bluetooth speaker")).toBe(false);
    /* En de echte Sense Lite-pagina die de eigenaar ook probeerde: JBL, maar
     * geen Tune Flex — dus terecht niets. */
    expect(
      mogelijkeProductMatch(
        bon,
        "JBL Sense Lite - Volledig Draadloze Open-Ear Oordopjes - Zwart | bol",
      ),
    ).toBe(false);
  });

  it("mogelijkeProductMatch eist het MERK erbij, zodat één algemeen woord nooit genoeg is", () => {
    /* Na het wegstrepen van standaardtaal en kleur houdt deze titel alleen
     * "grip" over. Zonder de merkeis zou elke pagina met het woord "grip" erin
     * raak zijn — precies de "te ruime" fout die `hoortBijWinkel` afwees. */
    const grip = aanbieding({ winkel: "JBL Grip (zwart) voor € 59 kortingsvoucher", domein: null });
    expect(mogelijkeProductMatch(grip, "JBL Grip draagbare speaker")).toBe(true);
    expect(mogelijkeProductMatch(grip, "Samsonite Grip Handbagage Trolley 55cm Zwart")).toBe(false);

    const tour = aanbieding({
      winkel: "JBL Tour Pro 3 (zwart) voor € 179 kortingsvoucher",
      domein: null,
    });
    expect(mogelijkeProductMatch(tour, "Grand Tour Reisgids Europa 2026")).toBe(false);
  });

  it("mogelijkeProductMatch weigert als er naast het merk niets onderscheidends overblijft", () => {
    /* "JBL 15% kortingsvoucher" is merkbreed: er blijft naast "jbl" geen enkel
     * onderscheidend woord over. Zo'n voucher aan élke JBL-pagina hangen is een
     * andere bewering dan deze functie doet, dus hij matcht nergens. Hetzelfde
     * geldt voor "ING kortingsvoucher". */
    const merkbreed = aanbieding({ winkel: "JBL 15% kortingsvoucher", domein: null });
    expect(mogelijkeProductMatch(merkbreed, "JBL Charge 5 waterdichte bluetooth speaker")).toBe(
      false,
    );

    const bon = aanbieding({ winkel: "ING kortingsvoucher", domein: null });
    expect(mogelijkeProductMatch(bon, "ING kortingsvoucher")).toBe(false);
    expect(mogelijkeProductMatch(bon, "Willekeurig artikel")).toBe(false);
  });

  it("koppelt een aanbieding zonder domein aan niets, ook niet aan de winkel met dezelfde naam", () => {
    /* Nike staat in de fixture zonder link naar de winkel. Dan is er geen
     * domein, en bij twijfel verschijnt er niets — de aanbieding staat wel in
     * het werkbalkvenster, waar hij zelf de naam leest. */
    const { aanbiedingen } = lees("kunstmatig-amex-aanbiedingen.html");
    const nike = aanbiedingen.find((a) => a.winkel === "Nike")!;
    expect(nike.domein).toBe(null);
    expect(hoortBijWinkel(nike, "www.nike.com")).toBe(false);
  });

  it("neemt de winkelnaam als domein zodra die letterlijk een hostnaam is", () => {
    const { aanbiedingen } = lees("kunstmatig-amex-aanbiedingen.html");
    expect(aanbiedingen.find((a) => a.winkel === "bol.com")!.domein).toBe("bol.com");
    expect(aanbiedingen.find((a) => a.winkel === "JBL")!.domein).toBe("jbl.nl");
  });

  it("kiest niet als twee links in dezelfde kaart naar verschillende winkels wijzen", () => {
    const domein = domeinVanKaart({
      winkel: "Onduidelijk",
      prijsTekst: "10% korting",
      totRuw: "",
      hosts: ["www.jbl.nl", "www.nike.com", "global.americanexpress.com"],
    });
    expect(domein).toBe(null);
  });
});

/* ─────────────────── wat er bij een winkel gezegd mag worden ──────────────── */

function toestand(p: Partial<AanbodToestand> = {}): AanbodToestand {
  return {
    aan: true,
    lezing: { uitkomst: "gelezen", aantal: 1, op: NU, citaat: "" },
    aanbiedingen: [],
    ...p,
  };
}

describe("het blok bij een winkel", () => {
  it("laat de gehedgde merknaam-match nooit vuren bij een KORTING-bron, ook niet zonder domein", () => {
    /* De bewaking zit in `aanbodVoorWinkel`, niet in `mogelijkeMerknaamMatch`
     * zelf. Een Amex-aanbieding zonder domein die toevallig de merknaam van de
     * winkel in zijn titel draagt, mag NOOIT de zwakkere tak krijgen — dat zou
     * bij een korting-bron precies de fout terugbrengen die `hoortBijWinkel`
     * bestaat om te voorkomen. */
    const t = toestand({ aanbiedingen: [aanbieding({ winkel: "JBL", domein: null })] });
    const u = aanbodVoorWinkel(t, "www.jbl.nl", NU, AMEX_BRON, null);
    expect(u.soort).toBe("geen-voor-deze-winkel");
  });

  it("laat de gehedgde product-match nooit vuren bij een KORTING-bron, ook niet met een passende productnaam", () => {
    /* Zelfde bewaking, nu voor de tweede zwakke tak: een KORTING-aanbieding
     * geldt alleen aan de kassa van de winkel zelf, hoe precies de paginainhoud
     * ook aansluit. */
    const t = toestand({
      aanbiedingen: [aanbieding({ winkel: "JBL Charge 5 speaker", domein: null })],
    });
    const u = aanbodVoorWinkel(t, "www.bol.com", NU, AMEX_BRON, "JBL Charge 5 speaker");
    expect(u.soort).toBe("geen-voor-deze-winkel");
  });

  it("zwijgt volledig zolang hij de schakelaar niet heeft aangezet", () => {
    /* De enige toestand waarin er niets staat. Bij elke kassa herinneren aan een
     * leestoestemming die hij niet wilde, is geen melding maar een aansporing. */
    const u = aanbodVoorWinkel(toestand({ aan: false }), "www.jbl.nl", NU, AMEX_BRON, null);
    expect(u.soort).toBe("uit");
    const blok = aanbodBlok(u, NU, AMEX_BRON);
    expect(blok.kop).toBe("");
    expect(blok.regels).toHaveLength(0);
    expect(blok.toestand).toBe("");
  });

  it("noemt het als er niets voor DEZE winkel is, met de dag en het aantal", () => {
    const t = toestand({ aanbiedingen: [aanbieding({ winkel: "JBL", domein: "jbl.nl" })] });
    const u = aanbodVoorWinkel(t, "www.ikea.com", NU, AMEX_BRON, null);
    expect(u.soort).toBe("geen-voor-deze-winkel");
    const blok = aanbodBlok(u, NU, AMEX_BRON);
    expect(blok.regels).toHaveLength(0);
    expect(blok.toestand).toContain("1 aanbieding");
    expect(blok.toestand).toContain("geen voor deze winkel");
    /* En waarom een aanbieding zonder webadres hier niet opduikt. */
    expect(blok.toestand).toContain("webadres");
  });

  it("toont de aanbieding die er wel is, met de datum en zonder een belofte over deze kassa", () => {
    const t = toestand({
      aanbiedingen: [
        aanbieding({
          winkel: "JBL",
          domein: "jbl.nl",
          prijsTekst: "30% korting",
          tot: "2026-12-31",
        }),
      ],
    });
    const u = aanbodVoorWinkel(t, "www.jbl.nl", NU, AMEX_BRON, null);
    expect(u.soort).toBe("gevonden");
    const blok = aanbodBlok(u, NU, AMEX_BRON);
    expect(blok.regels).toHaveLength(1);
    expect(blok.regels[0]!.titel).toBe("JBL");
    expect(blok.regels[0]!.regel).toContain("30% korting");
    expect(blok.regels[0]!.regel).toContain("Loopt tot 31 december 2026");
    /* Het advies dat hier niet kan werken, staat er niet; wat er wél kan, staat
     * er wel — inclusief waar de volledige voorwaarden staan. */
    expect(blok.regels[0]!.regel).toContain("American Express");
    expect(blok.regels[0]!.regel).not.toContain("Gebruik hem hier");
    expect(blok.regels[0]!.bron).toContain(
      "Gelezen van je Amex-aanbiedingenpagina op 22 augustus 2026",
    );
  });

  it("zegt bij een verlopen aanbieding dat de datum voorbij is in plaats van hem te verzwijgen", () => {
    const t = toestand({
      aanbiedingen: [aanbieding({ winkel: "HEMA", domein: "hema.nl", tot: "2026-07-01" })],
    });
    const u = aanbodVoorWinkel(t, "www.hema.nl", NU, AMEX_BRON, null);
    expect(u.soort).toBe("gevonden");
    if (u.soort !== "gevonden") return;
    expect(u.geldig).toHaveLength(0);
    expect(u.verlopen).toHaveLength(1);
    expect(aanbodBlok(u, NU, AMEX_BRON).regels[0]!.regel).toContain("die datum is voorbij");
  });

  it("zegt bij een onleesbare einddatum wat er stond, en rekent er niet mee", () => {
    const a = aanbieding({
      winkel: "Zalando",
      domein: "zalando.nl",
      tot: null,
      totRuw: "Geldig tot 05/03/2026",
    });
    const regel = aanbodRegel(a, NU, AMEX_BRON);
    expect(regel).toContain("Geldig tot 05/03/2026");
    expect(regel).toContain("niet eenduidig te lezen");
  });

  it("zegt bij een ontbrekende einddatum dat dat niet hetzelfde is als onbeperkt", () => {
    const regel = aanbodRegel(aanbieding({ winkel: "JBL", domein: "jbl.nl" }), NU, AMEX_BRON);
    expect(regel).toContain("geen einddatum");
    expect(regel).toContain("niet hetzelfde als onbeperkt");
  });

  it("laat na de grens de lijst met rust en zegt hoe oud hij is", () => {
    const oud = aanbieding({
      winkel: "JBL",
      domein: "jbl.nl",
      gelezenOp: "2026-06-01",
    });
    const u = aanbodVoorWinkel(
      toestand({ aanbiedingen: [oud] }),
      "www.jbl.nl",
      NU,
      AMEX_BRON,
      null,
    );
    expect(u.soort).toBe("te-oud");
    const blok = aanbodBlok(u, NU, AMEX_BRON);
    /* GEEN regels: de laatst bekende lijst blijven tonen alsof hij vers is, is
     * precies wat hier niet mag. Wel de datum en de reden. */
    expect(blok.regels).toHaveLength(0);
    expect(blok.toestand).toContain("1 juni 2026");
    expect(blok.toestand).toContain(String(AANBOD_TE_OUD_NA_DAGEN));
  });

  it("markeert een lijst tussen de twee grenzen als oud, maar toont hem nog wel", () => {
    const halfoud = aanbieding({ winkel: "JBL", domein: "jbl.nl", gelezenOp: "2026-08-01" });
    const u = aanbodVoorWinkel(
      toestand({ aanbiedingen: [halfoud] }),
      "www.jbl.nl",
      NU,
      AMEX_BRON,
      null,
    );
    expect(u.soort).toBe("gevonden");
    if (u.soort !== "gevonden") return;
    expect(u.dagen).toBe(21);
    expect(u.dagen).toBeGreaterThan(AANBOD_OUD_NA_DAGEN);
    expect(u.oud).toBe(true);
    expect(aanbodBlok(u, NU, AMEX_BRON).regels[0]!.bron).toContain("21 dagen geleden");
  });

  it("gaat op de datum van de LIJST af en niet op die van de laatste poging", () => {
    /* Drie dagen geleden vier aanbiedingen gelezen, vandaag mislukt het
     * verversen. Zou het paneel op de poging afgaan, dan verzweeg het vier
     * aanbiedingen die het gewoon heeft — met hun eigen, eerlijke datum eronder. */
    const t: AanbodToestand = {
      aan: true,
      lezing: { uitkomst: "blok-zonder-kaarten", aantal: 0, op: NU, citaat: "" },
      aanbiedingen: [aanbieding({ winkel: "JBL", domein: "jbl.nl", gelezenOp: "2026-08-19" })],
    };
    const u = aanbodVoorWinkel(t, "www.jbl.nl", NU, AMEX_BRON, null);
    expect(u.soort).toBe("gevonden");
    if (u.soort !== "gevonden") return;
    expect(u.op).toBe("2026-08-19");
  });

  it("noemt bij een lege opslag de oorzaak uit de laatste poging", () => {
    const nooit = aanbodVoorWinkel(toestand({ lezing: null }), "www.jbl.nl", NU, AMEX_BRON, null);
    expect(nooit.soort).toBe("nooit-gelezen");
    expect(aanbodToestandRegel(nooit, AMEX_BRON)).toContain("nog niet gelezen");

    const mislukt = aanbodVoorWinkel(
      toestand({ lezing: { uitkomst: "niet-ingelogd", aantal: 0, op: NU, citaat: "" } }),
      "www.jbl.nl",
      NU,
      AMEX_BRON,
      null,
    );
    expect(mislukt.soort).toBe("lezing-mislukt");
    expect(aanbodToestandRegel(mislukt, AMEX_BRON)).toContain("niet ingelogd");
  });

  it("behandelt een lijst zonder leesbare leeftijd als te oud, niet als vers", () => {
    const t = toestand({
      aanbiedingen: [aanbieding({ winkel: "JBL", domein: "jbl.nl", gelezenOp: "geen-datum" })],
    });
    const u = aanbodVoorWinkel(t, "www.jbl.nl", NU, AMEX_BRON, null);
    expect(u.soort).toBe("te-oud");
    expect(aanbodToestandRegel(u, AMEX_BRON)).toContain("geen leesbare datum");
  });
});

describe("de hele lijst in het werkbalkvenster", () => {
  it("toont ook de aanbiedingen zonder webadres, want daar is het geen bewering", () => {
    const { aanbiedingen } = lees("kunstmatig-amex-aanbiedingen.html");
    const blok = aanbodLijst({ aan: true, lezing: null, aanbiedingen }, NU, AMEX_BRON);
    expect(blok.regels).toHaveLength(5);
    expect(blok.regels.map((r) => r.titel)).toContain("Nike");
  });

  it("zet de vroegste einddatum bovenaan en de verlopen onderaan", () => {
    const { aanbiedingen } = lees("kunstmatig-amex-aanbiedingen.html");
    const blok = aanbodLijst({ aan: true, lezing: null, aanbiedingen }, NU, AMEX_BRON);
    /* bol.com verloopt over vijf dagen, HEMA is verlopen. */
    expect(blok.regels[0]!.titel).toBe("bol.com");
    expect(blok.regels[blok.regels.length - 1]!.titel).toBe("HEMA");
  });

  it("zwijgt ook hier als de schakelaar uitstaat", () => {
    expect(aanbodLijst({ aan: false, lezing: null, aanbiedingen: [] }, NU, AMEX_BRON).kop).toBe("");
  });
});

/* ──────────────────────────── de zeef op de opslag ────────────────────────── */

describe("wat er uit de opslag terugkomt, gaat door een zeef", () => {
  it("gooit een aanbieding zonder leesdatum weg", () => {
    /* Zonder leesdatum is er geen manier om te zeggen hoe oud hij is, en dat is
     * de enige eigenschap die hem beoordeelbaar maakt. */
    expect(_schoonAanbod([{ winkel: "JBL", prijsTekst: "30%", gelezenOp: "" }])).toHaveLength(0);
    expect(
      _schoonAanbod([{ winkel: "JBL", prijsTekst: "30%", gelezenOp: "gisteren" }]),
    ).toHaveLength(0);
    expect(_schoonAanbod([{ winkel: "", prijsTekst: "30%", gelezenOp: NU }])).toHaveLength(0);
  });

  it("gooit rommel in het domeinveld weg in plaats van het aan de koppelregel te voeren", () => {
    const uit = _schoonAanbod([
      { winkel: "JBL", prijsTekst: "30%", gelezenOp: NU, domein: "niet eens een host" },
    ]);
    expect(uit).toHaveLength(1);
    expect(uit[0]!.domein).toBe(null);
  });

  it("gooit een lezing met een onbekende uitkomst weg", () => {
    expect(_schoonLezing({ uitkomst: "prima", aantal: 3, op: NU })).toBe(null);
    expect(_schoonLezing({ uitkomst: "gelezen", aantal: 3, op: "ooit" })).toBe(null);
    expect(_schoonLezing({ uitkomst: "gelezen", aantal: 3, op: NU })?.aantal).toBe(3);
  });
});
