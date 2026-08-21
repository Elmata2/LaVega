import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { accountCosts, accountFees, readAccountFee, type AccountFeeEntryLike } from "./accountCosts.js";
import { catalogueCandidates } from "./travel.js";
// CatalogueEntryLike woont in catalogRates.ts; travel.ts importeert hem daar zelf
// vandaan en exporteert hem niet door. Uit travel.js halen gaf TS2459.
import type { CatalogueEntryLike } from "./catalogRates.js";
import type { Account } from "./model.js";

/* HET GECOMMITTEERDE ARTEFACT ZELF, niet een fixture ervan.
 *
 * Elke andere test in dit pakket toetst een functie tegen verzonnen invoer, en
 * dat is de goede verdeling: pure logica hoort zonder schijf te toetsen. Maar de
 * twee bestanden in docs/catalog zijn een ARTEFACT dat meerdere lanes met de hand
 * bijwerken, en de fouten die daar gemaakt worden zijn geen logicafouten. Ze zijn
 * van het soort "het staat in de ene lijst en niet in de andere" — en precies dat
 * soort is met een fixture per constructie niet te vinden.
 *
 * De samenvoeging van 20 augustus 2026 noemde dit als reden om 52 producten NIET
 * toe te voegen: state.json en catalog.json droegen exact dezelfde 122 producten,
 * en een rij die maar in één van de twee staat gaat stuk bij de eerstvolgende
 * sweep (mergeCatalogEntries zet een id dat state.json niet kent achteraan en de
 * sweep vraagt een id dat catalog.json niet kent elke ronde opnieuw op). Toen die
 * 52 er op 21 augustus in gingen, was er nog niets dat de gelijkheid bewaakte
 * behalve de belofte van de lane die het deed. Nu wel.
 *
 * I/O in een test van packages/core is geen I/O in packages/core: het pakket
 * blijft puur, dit bestand leest alleen wat het moet toetsen — dezelfde
 * uitzondering die bankNl.test.ts en pdfText.test.ts al maken. */

const REPO = new URL("../../../", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, REPO), "utf8"));

const state = read("docs/catalog/state.json") as { products: Record<string, { product: string; kind: string }> };
const catalog = read("docs/catalog/catalog.json") as { entries: (AccountFeeEntryLike & CatalogueEntryLike)[] };

const stateIds = Object.keys(state.products);
const catalogIds = catalog.entries.map((e) => e.id);

test("state.json en catalog.json dragen dezelfde producten, in dezelfde volgorde", () => {
  // Volgorde en niet alleen inhoud, omdat mergeCatalogEntries de catalogus
  // sorteert op de volgorde van state.json: een rij die daar niet in staat krijgt
  // rank = order.length en schuift naar achteren. Twee lijsten die dezelfde
  // producten in een andere volgorde dragen geven dus een diff die niemand heeft
  // gemaakt, en die diff verstopt de volgende echte.
  expect(catalogIds).toEqual(stateIds);
  // Geen bovengrens: een volgende ronde mag producten toevoegen. Wél een
  // ondergrens, want een half weggeschreven artefact is de faalmodus die de
  // sweep zelf ook al weigert ("een lege catalogus is geen bevinding").
  expect(stateIds.length).toBeGreaterThanOrEqual(185);
});

test("elk product draagt in beide bestanden dezelfde naam en dezelfde soort", () => {
  // De sweep schrijft product/issuer/kind uit state.json OVER de catalogusrij
  // heen (catalog-sweep.ts, entries.push). Staan ze uit elkaar, dan verandert de
  // catalogus bij de eerstvolgende run zonder dat iemand iets heeft gevonden — en
  // `kind` bepaalt of een rij op Reizen (betaalpas/creditcard) of op
  // Optimalisatie (betaalpakket/betaalrekening) landt.
  for (const e of catalog.entries) {
    expect([e.id, e.product, e.kind]).toEqual([e.id, state.products[e.id].product, state.products[e.id].kind]);
  }
});

test("elke accountFee in het artefact komt door de toelatingseis", () => {
  // readAccountFee weigert een rij zonder eenheid, zonder bron, zonder datum of
  // met onvastgestelde voorwaarden. Een rij die er niet doorheen komt is geen
  // halve rij maar een onzichtbare: het scherm slaat hem stil over, en dan staat
  // er een bedrag in een bestand dat nergens meetelt.
  const withFee = catalog.entries.filter((e) => e.fields?.accountFee !== undefined);
  const refused = withFee.filter((e) => readAccountFee(e) === null).map((e) => e.id);
  expect(refused).toEqual([]);

  /* EEN ONDERGRENS EN GEEN MOMENTOPNAME, en dat verschil is de hele waarde van
   * deze regel. Hier stond `toHaveLength(71)`, en die brak dezelfde dag nog: een
   * lane haalde er achttien rijen bij met een gedateerd tariefdocument, alles
   * netjes door de toelatingseis, en de test viel om op een terechte verbetering.
   * Zo'n test leert de volgende alleen om het getal op te hogen zonder te kijken.
   *
   * Wat WEL de moeite waard is om te bewaken is de andere kant op: het aantal mag
   * niet DALEN. Precies die fout stond klaar - een volledige sweep vraagt alleen
   * fxFeePct en interestPct en schreef zijn resultaat integraal weg, wat 68
   * velden zou hebben gewist. Deze ondergrens vangt dat, en gaat nooit af op
   * iemand die zijn werk goed doet. */
  expect(withFee.length).toBeGreaterThanOrEqual(89);
});

test("geen enkele accountFee draagt de dag waarop hij is toegevoegd als datum", () => {
  // De datum is die van het DOCUMENT. De ophaaldag invullen maakt van een
  // onbekende een cijfer, en dat is de fout die de rondes van 20 en 21 augustus
  // 2026 allebei expliciet hebben geweigerd: 21 rijen bleven buiten de catalogus
  // omdat hun bron geen eigen datum droeg. Maandprecisie ("2026-01") mag, want
  // het ABN-informatieblad zegt alleen "Januari 2026".
  for (const e of catalog.entries) {
    const v = readAccountFee(e);
    if (v === null) continue;
    expect(v.checkedAt).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
    expect(v.checkedAt < "2026-08-21").toBe(true);
  }
});

test("een pakket dat het document niet meer aanbiedt wordt nooit aangeraden", () => {
  // ING zet vier pakketten onder "Niet meer te openen betaalpakketten" en het
  // OranjePakket staat in geen van beide lijsten van zijn eigen bank. Een tip om
  // over te stappen naar zo'n pakket is advies dat in de toestand van de lezer
  // niet uit te voeren is; accountCosts filtert daarop via openToNewCustomers, en
  // dat leest de VOORWAARDENTEKST van deze rijen. De tekst is dus code.
  const byId = new Map(accountFees(catalog.entries).map((f) => [f.productId, f]));
  for (const id of [
    "ing-oranjepakket-met-korting",
    "ing-basispakket",
    "ing-betaalpakket",
    "ing-royaalpakket",
    "ing-oranjepakket",
  ]) {
    expect(byId.get(id)?.openToNewCustomers, id).toBe(false);
  }
  // En omgekeerd: een pakket dat wél te openen is moet aan te raden blijven,
  // anders zou de filter alles wegvagen en het scherm leeg blijven.
  expect(byId.get("ing-go")?.openToNewCustomers).toBe(true);
});

test("een kaartprijs die aan een ander product hangt is geen besparing", () => {
  const byId = new Map(accountFees(catalog.entries).map((f) => [f.productId, f]));
  // "Alleen binnen het ING Max-pakket (€ 44,99 per maand)" — de kaart kost € 0 en
  // is voor wie hem niet heeft € 539,88 per jaar duur.
  expect(byId.get("ing-creditcard-max")?.pricedOnItsOwn).toBe(false);
  expect(byId.get("ing-creditcard-more")?.pricedOnItsOwn).toBe(false);
  // "Aanvraag alleen via een erkende hulpverleningsinstantie" is geen pakket dat
  // je zelf kunt kiezen.
  expect(byId.get("sns-basis-priverekening")?.pricedOnItsOwn).toBe(false);
  // Een losse betaalrekening is wél op zichzelf te nemen.
  expect(byId.get("abn-losse-betaalrekening")?.pricedOnItsOwn).toBe(true);
});

test("het abonnement en de pas van bunq, N26 en Revolut zijn twee rijen die elkaar niet in de weg zitten", () => {
  // De beslissing van 21 augustus 2026: bunq Core en "bunq Core betaalpas" zijn
  // NIET hetzelfde catalogusproduct. De pasrij draagt de koersopslag en de punten
  // en moet kind "betaalpas" houden, want travel.ts filtert daarop
  // (catalogueCandidates) — die rij naar "betaalpakket" ompunten zou 14 gedekte
  // koersopslagen van het scherm Reizen halen. De abonnementsprijs staat daarom
  // op een eigen rij. Deze test is de rem op het terugdraaien daarvan.
  const kindOf = (id: string) => catalog.entries.find((e) => e.id === id)?.kind;
  for (const plan of ["bunq-core", "n26-smart", "revolut-plus"]) {
    expect(["betaalpakket", "betaalrekening"]).toContain(kindOf(plan));
  }
  for (const card of ["bunq-core-betaalpas", "n26-smart-betaalpas", "revolut-plus-betaalpas"]) {
    expect(kindOf(card), card).toBe("betaalpas");
  }
  // De prijs van het plan mag NOOIT op de pasrij staan: accountCosts koppelt een
  // rij met kind "betaalpas" nooit aan een rekening, dus daar zou hij onzichtbaar
  // zijn, en hij zou beweren dat de pas € 3,99 kost.
  for (const card of ["bunq-core-betaalpas", "n26-smart-betaalpas", "revolut-plus-betaalpas"]) {
    expect(catalog.entries.find((e) => e.id === card)?.fields?.accountFee).toBeUndefined();
  }
});

test("de catalogus kent per bank één betaalpas en één creditcard waar hij er één kende", () => {
  // De tegenhanger van de vorige test, en de reden dat vijf gevonden bedragen op
  // 21 augustus 2026 GEEN eigen rij kregen: "SNS Creditcard bij Studentenrekening"
  // en "ABN AMRO Studenten Credit Card" zijn dezelfde kaart onder een voorwaarde,
  // niet een tweede kaart. Een tweede rij met kind "creditcard" bij dezelfde bank
  // maakt catalogueProductFor ambigu, en dan zegt Reizen "de catalogus kent meer
  // dan één SNS creditcard en die rekenen niet hetzelfde" — een bewering die geen
  // van de twee documenten doet. Zelfde verhaal voor de Openbank-pas met Travel+,
  // waarvan de prijs al in de voorwaarden van de pas zelf staat.
  for (const product of ["SNS creditcard", "RegioBank creditcard", "ASN creditcard", "Openbank betaalpas"]) {
    expect(catalogueCandidates(catalog.entries, product).map((e) => e.product), product).toHaveLength(1);
  }
});

test("een ING-rekening die zijn pakket noemt krijgt het bedrag, en een die dat niet doet krijgt geen nul", () => {
  const base: Account = {
    key: "a1",
    iban: "NL01INGB0000000001",
    name: "Betaalrekening",
    bank: "ING",
    entity: "prive",
    currency: "EUR",
    balance: 1000,
  };
  const named = accountCosts([{ ...base, name: "ING Go" }], catalog.entries).rows[0];
  expect(named.cost.kind).toBe("known");
  if (named.cost.kind === "known") {
    expect(named.cost.amount).toEqual({ cents: 400, period: "maand", perYearCents: 4800, perYearDerived: true });
    expect(named.cost.asOf).toBe("2026-06-15");
  }

  // Dezelfde bank, geen pakketnaam: ING heeft twaalf geprijsde betaalpakketten en
  // ze kosten van € 0,00 tot € 44,99. Dan is het antwoord "onbekend, en dit zijn
  // de pakketten die er zijn" — nooit nul, en nooit het eerste dat past.
  const vague = accountCosts([base], catalog.entries).rows[0];
  expect(vague.cost).toEqual({ kind: "unknown", reason: "product-unknown" });
  expect(vague.candidates.length).toBeGreaterThan(1);
});
