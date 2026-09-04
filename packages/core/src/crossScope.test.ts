import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import type { EntityProfile } from "./entities.js";
import { parseOwnName } from "./categories.js";
import {
  answerCrossScope,
  businessCostsPaidPrivately,
  crossScopeStreamKey,
  crossScopeTransfers,
  type CrossScopeAnswer,
  type CrossScopeReport,
} from "./crossScope.js";

/* De grens tussen privé en zakelijk. The tests are the argument here, not the
 * decoration: every number this module puts on a screen is one he could check
 * against his own bank, so the ways it could be quietly wrong — counting one
 * euro twice, counting it half, or answering € 0 to a question it never
 * measured — each get a test that fails when they come back. */

const BV_IBAN = "NL01BANK0000000001";
const PRIVE_IBAN = "NL02BANK0000000002";
const AMEX_IBAN = "NL03AMEX0000000003";
const BV2_IBAN = "NL04BANK0000000004";

const acc = (key: string, entity: string, iban: string): Account => ({
  key,
  iban,
  name: key,
  bank: "ING",
  entity,
  currency: "EUR",
  balance: null,
});

const BV = acc("bv-1", "BV1", BV_IBAN);
const PRIVE = acc("prive-1", "Privé", PRIVE_IBAN);
const AMEX = acc("amex-1", "Privé", AMEX_IBAN); // known account, statement never imported
const BV2 = acc("bv-2", "BV2", BV2_IBAN);

const tx = (
  id: string,
  accountKey: string,
  date: string,
  amount: number,
  counterparty = "",
  description = "",
  currency = "EUR",
): Tx => ({
  id,
  accountKey,
  date,
  amount,
  currency,
  counterparty,
  description,
  category: "",
  manual: false,
});

const PROFILES: EntityProfile[] = [
  { entity: "BV1", scope: "business" },
  { entity: "Privé", scope: "personal" },
];
const ASOF = "2026-08-24";

/** Narrow the union. That this is NEEDED is the point of the union: a caller
 *  cannot reach a total without first saying what state it is in. */
function measured(r: CrossScopeReport) {
  if (r.state !== "gemeten") throw new Error(`verwacht "gemeten", kreeg "${r.state}"`);
  return r;
}

const run = (txs: Tx[], over: Partial<Parameters<typeof crossScopeTransfers>[0]> = {}) =>
  crossScopeTransfers({ accounts: [BV, PRIVE], txs, profiles: PROFILES, asOf: ASOF, ...over });

test("een gematchte overboeking over de grens telt ÉÉN keer, met twee benen eronder", () => {
  const r = measured(
    run([
      tx("o1", BV.key, "2026-03-10", -5000, "A. Steunenberg", `Overboeking naar ${PRIVE_IBAN}`),
      tx("i1", PRIVE.key, "2026-03-10", 5000, "Steunenberg Holding B.V.", `Van ${BV_IBAN}`),
    ]),
  );

  expect(r.crossings).toHaveLength(1);
  const c = r.crossings[0];
  expect(c.amountCents).toBe(500_000);
  expect(c.legs).toHaveLength(2);
  expect(c.matched).toBe(true);
  expect(c.evidence).toBe("twee-benen");
  expect(c.fromEntity).toBe("BV1");
  expect(c.toEntity).toBe("Privé");
  expect(c.fromScope).toBe("business");
  expect(c.toScope).toBe("personal");
  expect(c.date).toBe("2026-03-10"); // de dag dat het geld wegging
  expect(r.totalCents).toBe(500_000);
  expect(r.matchedCents).toBe(500_000);
  expect(r.unmatchedCents).toBe(0);

  // DE DUBBELTEL-TEST. Optellen over de BENEN in plaats van over de crossings
  // verdubbelt elke gematchte regel; deze assertie valt om zodra iemand dat doet.
  const overLegs = r.crossings
    .flatMap((x) => x.legs)
    .reduce((n, l) => n + Math.abs(l.signedCents), 0);
  expect(overLegs).toBe(1_000_000);
  expect(r.totalCents).not.toBe(overLegs);

  // Eén stroom, met de zin uit het ontwerp erin: totaal, en het onbekende deel.
  expect(r.streams).toHaveLength(1);
  expect(r.streams[0].totalCents).toBe(500_000);
  expect(r.streams[0].unknownCents).toBe(500_000); // niemand heeft nog gezegd wat het was
  expect(r.streams[0].count).toBe(1);
});

test("een paar dat een paar dagen uit elkaar ligt matcht nog steeds; vóór de afboeking of te ver weg niet", () => {
  const paar = (inDate: string) =>
    run([
      tx("o1", BV.key, "2026-03-10", -5000, "A. Steunenberg", "Overboeking"),
      tx("i1", PRIVE.key, inDate, 5000, "BV1", "Ontvangen"),
    ]);

  expect(measured(paar("2026-03-13")).crossings[0].matched).toBe(true); // 3 dagen
  expect(measured(paar("2026-03-14")).crossings[0].matched).toBe(true); // 4 dagen, de rand
  // 5 dagen: geen paar meer, en zonder bewijs op de regel is het GEEN crossing.
  // Zwijgen is hier het juiste antwoord: er staat niets op de regel dat bewijst
  // dat dit geld naar hem ging in plaats van naar een leverancier.
  expect(measured(paar("2026-03-15")).crossings).toHaveLength(0);
  // Geld arriveert niet vóór het weggaat.
  expect(measured(paar("2026-03-09")).crossings).toHaveLength(0);
});

test("twee even grote overboekingen in hetzelfde venster worden niet tot één samengeknepen", () => {
  const r = measured(
    run([
      tx("o1", BV.key, "2026-04-01", -1000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
      tx("o2", BV.key, "2026-04-01", -1000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
      tx("i1", PRIVE.key, "2026-04-01", 1000, "BV1", ""),
      tx("i2", PRIVE.key, "2026-04-02", 1000, "BV1", ""),
    ]),
  );
  expect(r.crossings).toHaveLength(2);
  expect(r.crossings.every((c) => c.matched)).toBe(true);
  expect(r.totalCents).toBe(200_000);
  // Elk been is precies één keer geclaimd.
  const txIds = r.crossings.flatMap((c) => c.legs.map((l) => l.txId)).sort();
  expect(txIds).toEqual(["i1", "i2", "o1", "o2"]);
});

test("twee afboekingen, één bijboeking: één gematcht, één als ONGEMATCHT gemeld — nooit stil verdubbeld of gehalveerd", () => {
  const r = measured(
    run([
      tx("o1", BV.key, "2026-04-01", -1000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
      tx("o2", BV.key, "2026-04-20", -1000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
      tx("i1", PRIVE.key, "2026-04-01", 1000, "BV1", ""),
    ]),
  );
  expect(r.crossings).toHaveLength(2);
  expect(r.crossings.filter((c) => c.matched)).toHaveLength(1);
  const los = r.crossings.find((c) => !c.matched)!;
  expect(los.legs).toHaveLength(1);
  expect(los.evidence).toBe("eigen-rekening-genoemd");
  expect(r.totalCents).toBe(200_000);
  expect(r.matchedCents).toBe(100_000);
  expect(r.unmatchedCents).toBe(100_000);
});

test("eenbenig: de BV betaalt rechtstreeks een privé-creditcard — gemeld als ongematcht, met de rekening als bewijs", () => {
  const r = measured(
    crossScopeTransfers({
      accounts: [BV, PRIVE, AMEX], // de Amex is bekend; zijn afschrift is nooit geïmporteerd
      txs: [
        tx("o1", BV.key, "2026-05-02", -1200.5, "American Express", `Aflossing kaart ${AMEX_IBAN}`),
      ],
      profiles: PROFILES,
      asOf: ASOF,
    }),
  );
  expect(r.crossings).toHaveLength(1);
  const c = r.crossings[0];
  expect(c.matched).toBe(false);
  expect(c.evidence).toBe("eigen-rekening-genoemd");
  expect(c.legs).toHaveLength(1);
  expect(c.amountCents).toBe(120_050);
  expect(c.fromEntity).toBe("BV1");
  expect(c.toEntity).toBe("Privé");
  expect(r.unmatchedCents).toBe(120_050);
});

test("een gewone leveranciersbetaling is GEEN crossing: zonder tegenbeen en zonder eigen rekening of naam is er geen bewijs", () => {
  const r = measured(
    run([
      tx("o1", BV.key, "2026-05-02", -900, "Coolblue B.V.", "Factuur 8823"),
      tx("o2", BV.key, "2026-05-03", -2500, "Belastingdienst", "Btw Q1"),
    ]),
  );
  expect(r.crossings).toHaveLength(0);
  expect(r.totalCents).toBe(0); // een ECHTE nul: er is gemeten en er kruiste niets
});

test("een bewijsloze afboeking naar een rekening die NIET in je vault staat wordt geteld, niet stil weggelaten", () => {
  /* DE VIERDE WEG NAAR HET SCHERM DAT DE UNION MOEST TEGENHOUDEN, en hij liep
   * er niet doorheen maar omheen. Zijn Rabobank-privérekening is nooit
   * geïmporteerd, dus de afboeking van € 12.400 draagt geen bewijs: geen
   * tegenbeen, geen rekening uit de vault, en zonder zijn naam in het profiel
   * ook geen naam. Ze werd stilzwijgend weggelaten en NERGENS geteld — anders
   * dan currencyMismatch en mirrorSuppressed — waarna de uitkomst "gemeten"
   * was met totalCents 0 en alle uitzonderingstellers op 0, en het scherm zei
   * dat er niets gekruist had. Er kruiste € 12.400.
   *
   * De teller repareert niet de meting (dat kan niet: van wie die rekening is,
   * staat nergens) maar de UITSPRAAK. Vandaar dat dit een aantal is en geen
   * bedrag — zie het commentaar bij `unknownCounterAccount`. */
  const r = measured(
    run([
      tx("o1", BV.key, "2026-02-05", -12400, "", "SEPA Overboeking NL77RABO0123456789"),
      tx("p1", PRIVE.key, "2026-02-06", -3.5, "Koffie", ""),
    ]),
  );
  expect(r.crossings).toHaveLength(0);
  expect(r.totalCents).toBe(0);
  // De nul staat er nog — maar niet meer alleen.
  expect(r.unknownCounterAccount).toBe(1);
  expect(r.ownNameKnown).toBe(false);

  // Een gewone leveranciersbetaling zonder rekeningnummer op de regel telt hier
  // NIET mee: dit is een teller van blinde vlekken, geen verdachtenlijst.
  const gewoon = measured(
    run(
      [
        tx("o1", BV.key, "2026-05-02", -900, "Coolblue B.V.", "Factuur 8823"),
        tx("o2", BV.key, "2026-05-03", -2500, "Belastingdienst", "Btw Q1"),
      ],
      { names: [parseOwnName("Alexander Steunenberg")!] },
    ),
  );
  expect(gewoon.unknownCounterAccount).toBe(0);
  expect(gewoon.ownNameKnown).toBe(true);

  // Een rij die WEL een rekening uit de vault noemt is een kruising en geen
  // blinde vlek — hij mag niet aan allebei de kanten meetellen.
  const bekend = measured(
    run([tx("o1", BV.key, "2026-02-05", -12400, "", `SEPA Overboeking ${PRIVE_IBAN}`)]),
  );
  expect(bekend.crossings).toHaveLength(1);
  expect(bekend.unknownCounterAccount).toBe(0);

  // En de eigen rekening van de rij zelf is geen vreemde rekening: een
  // bankkostenregel die zijn eigen IBAN citeert, mag geen blinde vlek worden.
  const eigen = measured(
    run([tx("o1", BV.key, "2026-02-05", -12.5, "ING", `Kosten rekening ${BV_IBAN}`)]),
  );
  expect(eigen.unknownCounterAccount).toBe(0);
});

test("niets als zakelijk gemarkeerd: een eigen staat, en de meting is niet eens bereikbaar", () => {
  const r = crossScopeTransfers({
    accounts: [BV, PRIVE],
    txs: [
      tx("o1", BV.key, "2026-03-10", -5000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
      tx("i1", PRIVE.key, "2026-03-10", 5000, "BV1", ""),
    ],
    profiles: [], // hij heeft nog niets geclassificeerd
    asOf: ASOF,
  });
  expect(r.state).toBe("geen-zakelijke-entiteit");
  expect(r.entities.business).toEqual([]);
  expect(r.entities.unclassified.sort()).toEqual(["BV1", "Privé"]);
  // HET HELE PUNT VAN DE UNION: er is geen totaal om per ongeluk als € 0 te tonen.
  expect(Object.hasOwn(r, "crossings")).toBe(false);
  expect(Object.hasOwn(r, "totalCents")).toBe(false);
  // en de spiegel is dezelfde staat, niet een lege lijst
  expect(
    businessCostsPaidPrivately({ accounts: [BV, PRIVE], txs: [], profiles: [], asOf: ASOF }).state,
  ).toBe("geen-zakelijke-entiteit");
});

test("alles zakelijk: de andere kant van de grens ontbreekt, en dat is óók een eigen staat", () => {
  const r = crossScopeTransfers({
    accounts: [BV, BV2],
    txs: [tx("o1", BV.key, "2026-03-10", -5000, "BV2", "")],
    profiles: [
      { entity: "BV1", scope: "business" },
      { entity: "BV2", scope: "business" },
    ],
    asOf: ASOF,
  });
  expect(r.state).toBe("geen-persoonlijke-entiteit");
});

test("een rekening zonder entiteit, en een transactie zonder rekening: geteld, nooit stilzwijgend privé genoemd", () => {
  const GEEN = acc("los-1", "   ", "NL09BANK0000000009");
  const r = measured(
    crossScopeTransfers({
      accounts: [BV, PRIVE, GEEN],
      txs: [
        tx("x1", GEEN.key, "2026-06-01", -400, "Coolblue", ""), // rekening zonder entiteit
        tx("x2", "onbekende-sleutel", "2026-06-01", -400, "Coolblue", ""), // rekening bestaat niet
        tx("o1", BV.key, "2026-06-02", -700, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
        tx("i1", PRIVE.key, "2026-06-02", 700, "BV1", ""),
      ],
      profiles: PROFILES,
      asOf: ASOF,
    }),
  );
  expect(r.unseen.noEntity).toBe(1);
  expect(r.unseen.noAccount).toBe(1);
  expect(r.crossings).toHaveLength(1); // alleen het paar dat wél te plaatsen is
  expect(r.totalCents).toBe(70_000);
  // De blanco entiteit staat in geen enkele lijst: hij zou anders via de
  // personal-default de grens geclassificeerd laten lijken.
  expect(r.entities.personal).toEqual(["Privé"]);
  expect(r.entities.business).toEqual(["BV1"]);

  // En als ALLE rekeningen zonder entiteit zijn, is er niets te classificeren.
  const leeg = crossScopeTransfers({
    accounts: [GEEN],
    txs: [tx("x1", GEEN.key, "2026-06-01", -400, "Coolblue", "")],
    profiles: [],
    asOf: ASOF,
  });
  expect(leeg.state).toBe("geen-zakelijke-entiteit");
  expect(leeg.unseen.noEntity).toBe(1);
});

test('zonder antwoord is de soort "onbekend" ZONDER bron — een echte staat, geen gok', () => {
  const r = measured(
    run([
      tx("o1", BV.key, "2026-03-10", -5000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
      tx("i1", PRIVE.key, "2026-03-10", 5000, "BV1", ""),
    ]),
  );
  expect(r.crossings[0].kind).toBe("onbekend");
  expect(r.crossings[0].kindSource).toBeNull();
  expect(r.streams[0].kindSource).toBeNull();
});

test("zijn antwoord op een stroom wint van elke latere gok, en opnieuw draaien vraagt het niet nog eens", () => {
  const txs = [
    tx("o1", BV.key, "2026-03-10", -5000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
    tx("i1", PRIVE.key, "2026-03-10", 5000, "BV1", ""),
    tx("o2", BV.key, "2026-06-10", -5000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
    tx("i2", PRIVE.key, "2026-06-10", 5000, "BV1", ""),
  ];
  const eerste = measured(run(txs));
  const stroom = eerste.streams[0].key;
  expect(stroom).toBe(crossScopeStreamKey("BV1", "Privé"));
  expect(eerste.streams[0].unknownCents).toBe(1_000_000);

  // Hij antwoordt één keer, op de STROOM: beide overboekingen zijn daarmee beantwoord.
  let answers: CrossScopeAnswer[] = answerCrossScope(
    [],
    [{ target: stroom, kind: "dividend", source: "user", updatedAt: "2026-08-20" }],
  );
  const tweede = measured(run(txs, { answers }));
  expect(tweede.crossings.map((c) => c.kind)).toEqual(["dividend", "dividend"]);
  expect(tweede.crossings.every((c) => c.kindSource === "user")).toBe(true);
  expect(tweede.streams[0].kind).toBe("dividend");
  expect(tweede.streams[0].unknownCents).toBe(0); // niets onbekends meer over
  expect(tweede.streams[0].unknownCount).toBe(0);

  // Een agent die er later overheen wil: geweigerd in de store én in de resolutie.
  answers = answerCrossScope(answers, [
    { target: stroom, kind: "salaris", source: "agent", updatedAt: "2026-08-24" },
  ]);
  expect(answers).toHaveLength(1);
  expect(answers[0].kind).toBe("dividend");
  const derde = measured(run(txs, { answers }));
  expect(derde.crossings.every((c) => c.kind === "dividend")).toBe(true);

  // Ook een gok op de PRECIEZERE regel verliest van zijn antwoord op de stroom:
  // bron gaat vóór nauwkeurigheid, precies zoals `upsertFacts` het doet.
  const perRegel = answerCrossScope(answers, [
    { target: derde.crossings[0].id, kind: "salaris", source: "agent", updatedAt: "2026-08-24" },
  ]);
  expect(measured(run(txs, { answers: perRegel })).crossings[0].kind).toBe("dividend");

  // Zijn eigen antwoord op één regel wint wél — dat is de uitzondering die het
  // eenmalige bedrag redt van het label van de maandelijkse stroom.
  const eenmalig = answerCrossScope(answers, [
    { target: derde.crossings[1].id, kind: "salaris", source: "user", updatedAt: "2026-08-24" },
  ]);
  const vierde = measured(run(txs, { answers: eenmalig }));
  expect(vierde.crossings.map((c) => c.kind)).toEqual(["dividend", "salaris"]);

  // OPNIEUW DRAAIEN VRAAGT NIETS OPNIEUW: de id's zijn stabiel, dus het antwoord
  // van gisteren landt vandaag op dezelfde regel.
  expect(vierde.crossings.map((c) => c.id)).toEqual(derde.crossings.map((c) => c.id));
  expect(measured(run(txs, { answers: eenmalig })).crossings.map((c) => c.kind)).toEqual([
    "dividend",
    "salaris",
  ]);
});

test('"ik weet het niet" is ook een antwoord: onbekend mét bron, zodat er niet opnieuw naar gevraagd wordt', () => {
  const txs = [
    tx("o1", BV.key, "2026-03-10", -5000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
    tx("i1", PRIVE.key, "2026-03-10", 5000, "BV1", ""),
  ];
  const stroom = crossScopeStreamKey("BV1", "Privé");
  const r = measured(run(txs, { answers: [{ target: stroom, kind: "onbekend", source: "user" }] }));
  expect(r.crossings[0].kind).toBe("onbekend");
  expect(r.crossings[0].kindSource).toBe("user"); // hij heeft geantwoord
});

test("zijn eigen naam op de regel telt alleen mét een naam die hij zelf gaf, en verzint zonder naam niets", () => {
  const txs = [tx("o1", BV.key, "2026-07-01", -3000, "A. Steunenberg", "Overboeking")];
  const names = [parseOwnName("Alexander Steunenberg")!];

  const zonder = measured(run(txs));
  expect(zonder.crossings).toHaveLength(0); // geen naam, geen claim

  const met = measured(run(txs, { names }));
  expect(met.crossings).toHaveLength(1);
  expect(met.crossings[0].evidence).toBe("eigen-naam-genoemd");
  expect(met.crossings[0].fromEntity).toBe("BV1");
  expect(met.crossings[0].toEntity).toBeNull(); // wélke privé-entiteit is niet te weten
  expect(met.crossings[0].toScope).toBe("personal");

  // Een familielid is niet hij: "B Steunenberg" spreekt de voorletter tegen.
  const familie = measured(
    run([tx("o2", BV.key, "2026-07-02", -3000, "B Steunenberg", "")], { names }),
  );
  expect(familie.crossings).toHaveLength(0);
});

test("valuta: een USD-been wordt niet tegen een EUR-been gelegd, en de weigering wordt geteld", () => {
  const r = measured(
    run([
      tx("o1", BV.key, "2026-03-10", -1000, "A. Steunenberg", "Overboeking", "EUR"),
      tx("i1", PRIVE.key, "2026-03-10", 1000, "BV1", "", "USD"),
    ]),
  );
  expect(r.crossings).toHaveLength(0);
  expect(r.currencyMismatch).toBe(1);
});

test("zakelijk naar zakelijk kruist geen grens", () => {
  const r = crossScopeTransfers({
    accounts: [BV, BV2, PRIVE],
    txs: [
      tx("o1", BV.key, "2026-03-10", -2000, "BV2", `naar ${BV2_IBAN}`),
      tx("i1", BV2.key, "2026-03-10", 2000, "BV1", `van ${BV_IBAN}`),
    ],
    profiles: [...PROFILES, { entity: "BV2", scope: "business" }],
    asOf: ASOF,
  });
  expect(measured(r).crossings).toHaveLength(0);
});

test("twee benen die het venster misten worden ÉÉN keer geteld, niet twee keer als losse regel", () => {
  // Acht dagen ertussen: geen paar meer, maar beide regels dragen bewijs. Zonder
  // de spiegelonderdrukking staat er € 10.000 waar € 5.000 bewoog.
  const r = measured(
    run([
      tx("o1", BV.key, "2026-03-10", -5000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
      tx("i1", PRIVE.key, "2026-03-18", 5000, "BV1", `van ${BV_IBAN}`),
    ]),
  );
  expect(r.crossings).toHaveLength(1);
  expect(r.crossings[0].matched).toBe(false); // er is niets gekoppeld: dat blijft eerlijk
  expect(r.crossings[0].legs).toHaveLength(1);
  expect(r.totalCents).toBe(500_000);
  expect(r.mirrorSuppressed).toBe(1);
});

/* DE ONDERDRUKKING MAG ALLEEN ÉÉN BEWEGING ONDERDRUKKEN, en dit zijn de drie
 * manieren waarop ze dat niet deed. Alle drie zijn op 25 augustus 2026 aan dit
 * bestand gemeten: de teller stond op bedrag + richting + |dagen| <= 14, en dat
 * is geen identiteit maar een toevalligheid. Wat het kostte staat per geval in
 * de test, want een halvering van een echt bedrag is geen randgeval — het is de
 * ergste fout die deze module kan maken en hij is op het scherm onzichtbaar. */

test("twee ECHTE overboekingen van gelijke omvang uit VERSCHILLENDE ondernemingen worden niet tot één spiegel geknepen", () => {
  // BV1 boekt € 5.000 af naar privé; zes dagen later komt er € 5.000 binnen van
  // BV2. Twee bedrijven, twee bewegingen. Vóór deze test: € 5.000 totaal, één
  // kruising, mirrorSuppressed 1 — en BV2 kwam in het hele rapport niet meer
  // voor, terwijl de overgebleven regel op naam van BV1 stond.
  const r = measured(
    crossScopeTransfers({
      accounts: [BV, BV2, PRIVE],
      txs: [
        tx("o1", BV.key, "2026-03-10", -5000, "Privé", `naar ${PRIVE_IBAN}`),
        tx("i1", PRIVE.key, "2026-03-16", 5000, "BV2", `van ${BV2_IBAN}`),
      ],
      profiles: [...PROFILES, { entity: "BV2", scope: "business" }],
      asOf: ASOF,
    }),
  );
  expect(r.totalCents).toBe(1_000_000);
  expect(r.crossings).toHaveLength(2);
  expect(r.mirrorSuppressed).toBe(0);
  expect(r.streams.map((s) => s.fromEntity).sort()).toEqual(["BV1", "BV2"]);

  // En dezelfde fout aan de andere kant van de grens: één BV, twee privékanten.
  const PARTNER = acc("partner-1", "Partner", "NL06BANK0000000006");
  const p = measured(
    crossScopeTransfers({
      accounts: [BV, PRIVE, PARTNER],
      txs: [
        tx("o1", BV.key, "2026-03-10", -3000, "Privé", `naar ${PRIVE_IBAN}`),
        tx("i1", PARTNER.key, "2026-03-16", 3000, "BV1", `van ${BV_IBAN}`),
      ],
      profiles: [...PROFILES, { entity: "Partner", scope: "personal" }],
      asOf: ASOF,
    }),
  );
  expect(p.totalCents).toBe(600_000);
  expect(p.streams.map((s) => s.toEntity).sort()).toEqual(["Partner", "Privé"]);
});

test("een bijboeking die VÓÓR de afboeking ligt is nooit dezelfde beweging", () => {
  // Koppelregel (c) zegt het al: geld arriveert niet voordat het weggaat. De
  // onderdrukker vergeleek het gat met Math.abs en weigerde daardoor te tellen
  // wat de koppelregel onmogelijk had verklaard — € 5.000 van de € 10.000 weg.
  const r = measured(
    run([
      tx("i1", PRIVE.key, "2026-03-05", 5000, "BV1", `van ${BV_IBAN}`),
      tx("o1", BV.key, "2026-03-10", -5000, "Privé", `naar ${PRIVE_IBAN}`),
    ]),
  );
  expect(r.totalCents).toBe(1_000_000);
  expect(r.crossings).toHaveLength(2);
  expect(r.mirrorSuppressed).toBe(0);

  // De spiegel van dezelfde twee regels — bijboeking ná de afboeking — blijft
  // wél één beweging, zodat deze test de onderdrukking niet stiekem uitzet.
  const andersom = measured(
    run([
      tx("o1", BV.key, "2026-03-05", -5000, "Privé", `naar ${PRIVE_IBAN}`),
      tx("i1", PRIVE.key, "2026-03-10", 5000, "BV1", `van ${BV_IBAN}`),
    ]),
  );
  expect(andersom.totalCents).toBe(500_000);
  expect(andersom.mirrorSuppressed).toBe(1);
});

test("een spiegel waarvan één kant alleen zijn NAAM draagt telt nog steeds één keer", () => {
  // De grens van de nieuwe regel, en hij hoort vast te staan: een naamregel weet
  // wel dat het geld naar HEM ging maar niet naar welke privé-entiteit, dus
  // `toEntity` is null. Null is ONBEKEND en mag voor een genoemde naam staan —
  // anders zou het aanscherpen van deze regel een stille verdubbeling terugzetten
  // op precies de rijen waar de bank niets uitschreef.
  const r = measured(
    run(
      [
        tx("o1", BV.key, "2026-03-10", -5000, "A. Steunenberg", "Overboeking"),
        tx("i1", PRIVE.key, "2026-03-18", 5000, "BV1", `van ${BV_IBAN}`),
      ],
      { names: [parseOwnName("Alexander Steunenberg")!] },
    ),
  );
  expect(r.totalCents).toBe(500_000);
  expect(r.mirrorSuppressed).toBe(1);

  // Twintig dagen ertussen is geen spiegel meer, ook niet met een onbekende kant.
  const ver = measured(
    run(
      [
        tx("o1", BV.key, "2026-03-10", -5000, "A. Steunenberg", "Overboeking"),
        tx("i1", PRIVE.key, "2026-03-30", 5000, "BV1", `van ${BV_IBAN}`),
      ],
      { names: [parseOwnName("Alexander Steunenberg")!] },
    ),
  );
  expect(ver.totalCents).toBe(1_000_000);
  expect(ver.crossings).toHaveLength(2);
});

test("een spiegel in een andere valuta wordt niet onderdrukt: hetzelfde getal is niet hetzelfde bedrag", () => {
  // Koppelregel (b) weigert twee benen van gelijke omvang in verschillende
  // valuta omdat er dan een koers ingevuld zou moeten worden. Een onderdrukker
  // die valuta negeert, gooit precies weg wat (b) weigerde te koppelen.
  const r = measured(
    run([
      tx("o1", BV.key, "2026-03-10", -5000, "Privé", `naar ${PRIVE_IBAN}`, "EUR"),
      tx("i1", PRIVE.key, "2026-03-18", 5000, "BV1", `van ${BV_IBAN}`, "USD"),
    ]),
  );
  expect(r.crossings).toHaveLength(2);
  expect(r.mirrorSuppressed).toBe(0);
});

test("het venster is standaard het kalenderjaar van asOf, en `from` verschuift het", () => {
  const txs = [
    tx("o0", BV.key, "2025-12-31", -1000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
    tx("i0", PRIVE.key, "2025-12-31", 1000, "BV1", ""),
    tx("o1", BV.key, "2026-02-02", -2000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
    tx("i1", PRIVE.key, "2026-02-02", 2000, "BV1", ""),
  ];
  const dit = measured(run(txs));
  expect(dit.window).toEqual({ from: "2026-01-01", to: ASOF });
  expect(dit.totalCents).toBe(200_000);
  expect(dit.observed).toEqual({ from: "2026-02-02", to: "2026-02-02" });

  const beide = measured(run(txs, { from: "2025-01-01" }));
  expect(beide.totalCents).toBe(300_000);
  expect(beide.crossings).toHaveLength(2);
});

test('geclassificeerd maar niets te zien in het venster: "geen-transacties", niet € 0', () => {
  const r = crossScopeTransfers({
    accounts: [BV, PRIVE],
    txs: [tx("o0", BV.key, "2025-12-31", -1000, "A. Steunenberg", `naar ${PRIVE_IBAN}`)],
    profiles: PROFILES,
    asOf: ASOF,
  });
  expect(r.state).toBe("geen-transacties");
  expect(Object.hasOwn(r, "totalCents")).toBe(false);
});

test("bedragen blijven hele centen — nergens een float", () => {
  const r = measured(
    run([
      tx("o1", BV.key, "2026-03-10", -1234.56, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
      tx("i1", PRIVE.key, "2026-03-11", 1234.56, "BV1", ""),
      tx("o2", BV.key, "2026-03-12", -0.07, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
    ]),
  );
  expect(r.crossings[0].amountCents).toBe(123_456);
  expect(r.crossings[1].amountCents).toBe(7);
  expect(r.totalCents).toBe(123_463);
  const alle = [
    r.totalCents,
    r.matchedCents,
    r.unmatchedCents,
    ...r.crossings.map((c) => c.amountCents),
    ...r.crossings.flatMap((c) => c.legs.map((l) => l.signedCents)),
    ...r.streams.flatMap((s) => [s.totalCents, s.matchedCents, s.unmatchedCents, s.unknownCents]),
  ];
  for (const n of alle) expect(Number.isInteger(n)).toBe(true);
});

/* ── Het bijproduct ────────────────────────────────────────────────────────── */

test("zakelijke kosten van een privérekening: dezelfde tegenpartij aan beide kanten van de grens", () => {
  const r = businessCostsPaidPrivately({
    accounts: [BV, PRIVE],
    txs: [
      tx("b1", BV.key, "2026-02-10", -1210, "Coolblue B.V.", "Factuur 1"),
      tx("p1", PRIVE.key, "2026-03-05", -455.5, "COOLBLUE", "Bestelling"),
      tx("p2", PRIVE.key, "2026-03-06", -300, "Coolblue Energie", "Termijnbedrag"), // net niet dezelfde
      tx("b2", BV.key, "2026-03-07", -80, "KPN", "Zakelijk abonnement"), // alleen zakelijk
      tx("p3", PRIVE.key, "2026-03-08", -60, "Albert Heijn", "Boodschappen"), // alleen privé
      tx("p4", PRIVE.key, "2026-03-09", 500, "Coolblue B.V.", "Retour"), // een bijboeking is geen kost
    ],
    profiles: PROFILES,
    asOf: ASOF,
  });
  if (r.state !== "gemeten") throw new Error(r.state);
  expect(r.rows).toHaveLength(1);
  const row = r.rows[0];
  expect(row.merchant).toBe("coolblue");
  expect(row.businessCents).toBe(121_000);
  expect(row.businessCount).toBe(1);
  expect(row.personalCents).toBe(45_550);
  expect(row.personalCount).toBe(1);
  expect(row.personalTxIds).toEqual(["p1"]);
  expect(row.firstDate).toBe("2026-02-10");
  expect(row.lastDate).toBe("2026-03-05");
  // De meting stelt niets vast over aftrekbaarheid: er is geen veld voor.
  expect(Object.keys(row).sort()).toEqual([
    "businessCents",
    "businessCount",
    "firstDate",
    "label",
    "lastDate",
    "merchant",
    "personalCents",
    "personalCount",
    "personalTxIds",
  ]);
});

test("zijn eigen geld verschijnt niet als zijn eigen leverancier", () => {
  const r = businessCostsPaidPrivately({
    accounts: [BV, PRIVE],
    txs: [
      tx("b1", BV.key, "2026-02-10", -1000, "A. Steunenberg", `naar ${PRIVE_IBAN}`),
      tx("p1", PRIVE.key, "2026-02-11", -1000, "Steunenberg Holding", `naar ${BV_IBAN}`),
      tx("b2", BV.key, "2026-02-12", -50, "A. Steunenberg", "Eigen overboeking"),
      tx("p2", PRIVE.key, "2026-02-13", -50, "A. Steunenberg", ""),
    ],
    profiles: PROFILES,
    asOf: ASOF,
    names: [parseOwnName("Alexander Steunenberg")!],
  });
  if (r.state !== "gemeten") throw new Error(r.state);
  expect(r.rows).toHaveLength(0);
});
