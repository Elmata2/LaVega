import { expect, test } from "vitest";
import { categorize } from "./views.js";
import { isPersonName, PERSON_CATEGORY } from "./categories.js";
import type { Tx } from "./model.js";

/* EEN DUITS AFSCHRIFT, VOOR DE ONTWERP-PARTNER.
 *
 * Gemeten vóór deze regels bestonden: van 49 realistische Duitse regels kreeg
 * 73% een categorie — maar bijna een derde van dat "succes" was
 * `Tussen personen`. REWE, EDEKA, Kaufland, Stadtwerke, E.ON en het Finanzamt
 * werden stuk voor stuk als PERSOON geboekt.
 *
 * Dat is erger dan onbekend, en daarom staat het hier als test. Onbekend is
 * eerlijk en te corrigeren; "tussen personen" is een zelfverzekerd fout antwoord
 * in precies de categorie die de uitgavenschermen als niet-echt-uitgeven
 * behandelen — zijn uitgavenbeeld zou dan niet alleen verkeerd gelabeld zijn
 * maar structureel te laag.
 *
 * De oorzaak was één ding: `isMerchantRow` is wat een winkel ervan weerhoudt
 * als persoon gelezen te worden, en elk signaal erin was Nederlands
 * (`betaalautomaat`, `geldautomaat`, `pasvolgnr`, `bea`). Een Duits afschrift
 * zegt daar niets van, dus het veto vuurde geen enkele keer. */

const de = (cp: string, desc = "", amount = -42.5): Tx =>
  ({
    id: "t" + cp,
    accountKey: "DE1",
    date: "2026-06-11",
    amount,
    currency: "EUR",
    counterparty: cp,
    description: desc,
    category: "",
    manual: false,
  }) as Tx;

/** Wat een Duitse rekeninghouder in een maand ziet, per categorie. */
const EXPECTED: ReadonlyArray<[string, string, string]> = [
  ["REWE SAGT DANKE", "Kartenzahlung", "Boodschappen"],
  ["EDEKA SUEDWEST", "Kartenzahlung girocard", "Boodschappen"],
  ["Kaufland Berlin", "Kartenzahlung", "Boodschappen"],
  ["PENNY SAGT DANKE", "", "Boodschappen"],
  ["DM DROGERIEMARKT", "Kartenzahlung", "Boodschappen"],
  ["ROSSMANN", "", "Boodschappen"],
  ["Baeckerei Schmidt", "Kartenzahlung", "Eten & drinken"],
  ["LIEFERANDO.DE", "SEPA-Lastschrift", "Eten & drinken"],
  ["DB VERTRIEB GMBH", "Fahrkarte", "Transport"],
  ["ARAL AG", "Kartenzahlung", "Transport"],
  ["BVG Berliner Verkehrsbetriebe", "Abo", "Transport"],
  ["Stadtwerke Muenchen", "Abschlag Strom", "Wonen & energie"],
  ["Mueller Hausverwaltung", "Miete Januar", "Wonen & energie"],
  ["Telekom Deutschland GmbH", "Mobilfunk", "Abonnementen"],
  ["1&1 Telecom GmbH", "", "Abonnementen"],
  ["HUK-COBURG", "Kfz-Versicherung", "Verzekeringen"],
  ["ALLIANZ VERSICHERUNGS-AG", "Beitrag", "Verzekeringen"],
  ["Apotheke am Markt", "Kartenzahlung", "Gezondheid"],
  ["Techniker Krankenkasse", "Beitrag", "Gezondheid"],
  ["AOK Bayern", "Krankenkassenbeitrag", "Gezondheid"],
  ["Finanzamt Muenchen", "Umsatzsteuer-Vorauszahlung", "Belastingen & overheid"],
  ["Bundeskasse Halle", "", "Belastingen & overheid"],
  ["Sparkasse", "Kontofuehrungsgebuehr", "Bankkosten"],
  ["Bargeldauszahlung GA NR00012345", "", "Geldopname"],
];

test("a German statement lands in real categories, not in the person bucket", () => {
  const wrong: string[] = [];
  for (const [cp, desc, want] of EXPECTED) {
    const got = categorize(de(cp, desc), []);
    if (got !== want) wrong.push(`${cp} -> ${got} (wanted ${want})`);
  }
  expect(wrong).toEqual([]);
});

/* DE REGEL DIE HET MEEST KOSTTE. Geen enkele van deze mag ooit als persoon
 * worden gelezen — dit is de test die omvalt als het Nederlandse veto weer de
 * enige is die er is. */
test("no German merchant or institution is ever booked as a person", () => {
  /* OP DE HELE RIJ, niet op de kale naam — zo wordt de code ook geraadpleegd.
   * `isPersonName` leest alleen de VORM van een naam, en "REWE SAGT DANKE" is
   * qua vorm niet van een naam te onderscheiden. Wat een winkel van een persoon
   * scheidt is het bewijs elders op de rij, en dat leest `isMerchantRow`. Een
   * test op de kale naam zou dus iets afdwingen wat die functie nooit heeft
   * beloofd, en zou tegelijk missen wat er echt op het scherm komt. */
  const rows: Array<[string, string]> = [
    ["REWE SAGT DANKE", "Kartenzahlung"],
    ["EDEKA SUEDWEST", "Kartenzahlung girocard"],
    ["Kaufland Berlin", "Kartenzahlung"],
    ["Stadtwerke Muenchen", "SEPA-Lastschrift Abschlag"],
    ["E.ON Energie Deutschland", "SEPA-Lastschrift"],
    ["Finanzamt Muenchen", "Umsatzsteuer-Vorauszahlung"],
    ["Mueller Hausverwaltung", "Miete Januar"],
    ["AOK Bayern", "SEPA-Lastschrift Beitrag"],
    ["BVG Berliner Verkehrsbetriebe", "Kartenzahlung"],
  ];
  const asPerson = rows.filter(([cp, d]) => categorize(de(cp, d), []) === PERSON_CATEGORY);
  expect(asPerson).toEqual([]);

  /* Deze twee dragen hun rechtsvorm in de naam zelf, dus die mogen ook zonder
   * enig bewijs elders op de rij nooit als persoon lezen. */
  expect(isPersonName("OTTO GMBH & CO KG")).toBe(false);
  expect(isPersonName("ALLIANZ VERSICHERUNGS-AG")).toBe(false);
});

/* EN DE ANDERE KANT OP, want een veto dat alles tegenhoudt is net zo fout.
 * `Dauerauftrag` en `Überweisung` stonden eerst als winkelbewijs in de lijst,
 * en toen kwam precies de duidelijkste persoon-aan-persoonregel van een Duits
 * afschrift als onbekend terug. */
test("a German standing order between two people is still between people", () => {
  expect(categorize(de("Thomas Weber", "Dauerauftrag Miete"), [])).toBe(PERSON_CATEGORY);
  expect(categorize(de("Anna Schneider", "Ueberweisung Geschenk"), [])).toBe(PERSON_CATEGORY);
});

/* Salaris is richtingsgevoelig, net als in het Nederlands: binnenkomend is het
 * zijn inkomen, uitgaand betaalt een bedrijf lonen. */
test("a German salary line counts as income only when it comes in", () => {
  expect(categorize(de("Phoenix GmbH", "Lohn/Gehalt Juni", 4200), [])).toBe("Inkomen");
  expect(categorize(de("Phoenix GmbH", "Lohn/Gehalt Juni", -4200), [])).not.toBe("Inkomen");
});

/* WAT HET VETO ECHT MOET DOEN, en wat de vorige test niet bewees.
 *
 * De regels hierboven vangen de grote Duitse namen, dus die halen de
 * persoonstak nooit. Het veto in `isMerchantRow` bestaat voor alle andere: de
 * boekhandel, de garage, de fysiotherapeut — namen die nooit in een lijst
 * passen en die qua VORM niet van een persoonsnaam te onderscheiden zijn.
 *
 * Zonder Duits bewijs op de rij viel elk van deze in "Tussen personen", en dat
 * is de categorie die de uitgavenschermen als niet-echt-uitgeven lezen. Een
 * mutatietest zag dat niet omdat elke naam die ik had gekozen óók in de nieuwe
 * regels stond — vandaar deze, met namen die daar met opzet niet in staan. */
test("a German shop nobody put in a list is still not a person", () => {
  const unlisted: Array<[string, string]> = [
    ["Buchhandlung Hugendubel", "Kartenzahlung"],
    ["Autohaus Krueger", "Kartenzahlung girocard"],
    ["Physiotherapie Lang", "SEPA-Basislastschrift"],
    ["Friseur Salon Bianca", "Kartenzahlung kontaktlos"],
    ["Blumen Wagner", "Kartenzahlung"],
  ];
  const asPerson = unlisted.filter(([cp, d]) => categorize(de(cp, d), []) === PERSON_CATEGORY);
  expect(asPerson).toEqual([]);

  /* En de keerzijde blijft staan: dezelfde naam ZONDER dat bewijs mag wel een
   * persoon zijn. Het veto leest de rij, niet de naam — dat onderscheid is het
   * hele ontwerp en niet een tekortkoming. */
  expect(categorize(de("Blumen Wagner", ""), [])).toBe(PERSON_CATEGORY);
});
