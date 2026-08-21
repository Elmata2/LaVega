import { describe, expect, test } from "vitest";
import type { Account } from "./model.js";
import {
  accountCosts,
  accountFees,
  hasCostsToShow,
  MIN_SAVING_PER_YEAR_CENTS,
  readAccountFee,
  type AccountFeeEntryLike,
} from "./accountCosts.js";

/* De cijfers hieronder komen uit de zoekronde van 21 augustus 2026
 * (docs/catalog/staging-account-fees.json): ING Go € 4,00 per maand, ING Student
 * gratis met een leeftijdsvoorwaarde, de ICS Visa World Card € 42,95 PER JAAR.
 * Ze staan hier letterlijk zo in, want de helft van wat dit bestand bewaakt is
 * juist dat een maandbedrag geen jaarbedrag wordt en andersom. */

const fee = (over: Record<string, unknown> = {}) => ({
  value: 4.0,
  period: "maand",
  route: "provider-pdf",
  sourceUrl: "https://assets.ing.com/kostenoverzicht.pdf",
  checkedAt: "2026-06-15",
  conditions: "Prijs voor een betaalrekening op 1 naam inclusief fysieke betaalpas.",
  conditionsKnown: true,
  ...over,
});

const entry = (over: Partial<AccountFeeEntryLike> & { fee?: Record<string, unknown> } = {}): AccountFeeEntryLike => {
  const { fee: f, ...rest } = over;
  return {
    id: "ing-go",
    product: "ING Go",
    issuer: "ING Bank N.V.",
    kind: "betaalpakket",
    fields: { accountFee: fee(f) },
    ...rest,
  };
};

const account = (over: Partial<Account> = {}): Account => ({
  key: "acc-1",
  iban: "NL01INGB0000000001",
  name: "Betaalrekening",
  bank: "ING",
  entity: "prive",
  currency: "EUR",
  balance: 1000,
  ...over,
});

const ING_GO = entry();
const ING_MORE = entry({ id: "ing-more", product: "ING More", fee: { value: 7.0 } });
const ING_STUDENT = entry({
  id: "ing-student",
  product: "ING Student",
  kind: "betaalrekening",
  fee: {
    value: 0,
    conditions:
      "Alleen voor rekeninghouders van 18 tot 30 jaar. Het document noemt de nul zelf ('gratis'); dit is dus een bekende nul en geen ontbrekend cijfer.",
  },
});
const ING_BASISPAKKET = entry({
  id: "ing-basispakket",
  product: "ING BasisPakket",
  fee: {
    value: 4.85,
    conditions: "Niet meer te openen pakket; geldt alleen voor bestaande klanten.",
  },
});
const BUNQ_FREE = entry({
  id: "bunq-free",
  product: "bunq Free",
  issuer: "bunq B.V.",
  kind: "betaalpakket",
  fee: { value: 0, conditions: "3 rekeningen inbegrepen. Extra rekeningen € 20 per maand per 25." },
});
const ICS_VISA_WORLD_CARD = entry({
  id: "ics-visa-world-card",
  product: "ICS Visa World Card",
  issuer: "International Card Services B.V.",
  kind: "creditcard",
  fee: { value: 42.95, period: "jaar", conditions: "Extra Card € 15 per jaar." },
});

describe("readAccountFee", () => {
  test("leest de eenheid uit `period`, en anders uit het `unit`-veld van de zoeklane", () => {
    expect(readAccountFee(entry())?.period).toBe("maand");
    expect(readAccountFee(entry({ fee: { period: undefined, unit: "EUR per jaar" } }))?.period).toBe("jaar");
  });

  test("WEIGERT een bedrag zonder eenheid — dat scheelt een factor twaalf", () => {
    // Stilzwijgend "per maand" aannemen maakt van € 42,95 per jaar € 515,40.
    expect(readAccountFee(entry({ fee: { period: undefined, unit: undefined } }))).toBeNull();
  });

  test("WEIGERT een eenheid die twee kanten op wijst", () => {
    expect(readAccountFee(entry({ fee: { period: "€ 48,00 per jaar, dus € 4,00 per maand" } }))).toBeNull();
  });

  test("WEIGERT een bedrag waarvan de voorwaarden nooit zijn vastgesteld", () => {
    expect(readAccountFee(entry({ fee: { conditionsKnown: false } }))).toBeNull();
  });

  test("WEIGERT een bedrag zonder bron of zonder datum", () => {
    expect(readAccountFee(entry({ fee: { sourceUrl: "" } }))).toBeNull();
    expect(readAccountFee(entry({ fee: { checkedAt: "" } }))).toBeNull();
  });

  test("een rekening zonder accountFee levert niets op — en zeker geen nul", () => {
    expect(readAccountFee({ id: "x", product: "X", fields: {} })).toBeNull();
    expect(readAccountFee({ id: "x", product: "X" })).toBeNull();
  });
});

describe("maand versus jaar", () => {
  test("een maandbedrag houdt zijn eenheid; het jaarbedrag staat ernaast en is gemarkeerd als afgeleid", () => {
    const [f] = accountFees([ING_GO]);
    expect(f.amount.cents).toBe(400);
    expect(f.amount.period).toBe("maand");
    expect(f.amount.perYearCents).toBe(4800);
    expect(f.amount.perYearDerived).toBe(true);
  });

  test("een jaarbedrag wordt NIET door twaalf gedeeld en telt als niet-afgeleid", () => {
    const [f] = accountFees([ICS_VISA_WORLD_CARD]);
    expect(f.amount.cents).toBe(4295);
    expect(f.amount.period).toBe("jaar");
    expect(f.amount.perYearCents).toBe(4295);
    expect(f.amount.perYearDerived).toBe(false);
  });

  test("de markt staat goedkoopst-per-jaar eerst, over de eenheden heen", () => {
    const ids = accountFees([ICS_VISA_WORLD_CARD, ING_MORE, ING_GO, ING_STUDENT]).map((f) => f.productId);
    // ING Student € 0 · ING Go € 48/jr · ING More € 84/jr · ICS € 42,95/jr staat
    // dus TUSSEN Student en Go, niet onderaan omdat het toevallig per jaar is.
    expect(ids).toEqual(["ing-student", "ics-visa-world-card", "ing-go", "ing-more"]);
  });
});

describe("bekende nul versus onbekend", () => {
  const catalogue = [ING_GO, ING_MORE, ING_STUDENT];

  test("een uitgesproken nul is een BEKEND bedrag, met bron en datum", () => {
    const acc = account({ name: "ING Student", bank: "ING" });
    const { rows } = accountCosts([acc], catalogue);
    const cost = rows[0].cost;
    expect(cost.kind).toBe("known");
    if (cost.kind !== "known") throw new Error("onbereikbaar");
    expect(cost.amount.cents).toBe(0);
    expect(cost.amount.perYearCents).toBe(0);
    expect(cost.sourceUrl).toBe("https://assets.ing.com/kostenoverzicht.pdf");
    expect(cost.asOf).toBe("2026-06-15");
    expect(cost.conditions).toContain("18 tot 30 jaar");
  });

  test("een bank die de catalogus niet kent is ONBEKEND, niet gratis", () => {
    const { rows, total } = accountCosts([account({ bank: "Bank Ergens", name: "Betaalrekening" })], catalogue);
    expect(rows[0].cost).toEqual({ kind: "unknown", reason: "provider-unknown" });
    expect(total).toEqual({ kind: "none" });
  });

  test("bank bekend, pakket niet: onbekend — mét de pakketten die er zijn", () => {
    // ING Go, More en Student kosten niet hetzelfde, dus welk pakket dit is valt
    // niet af te leiden. Het alternatief — het goedkoopste pakken, of het
    // duurste — is een gok met een prijskaartje.
    const { rows } = accountCosts([account({ name: "NL01INGB0000000001" })], catalogue);
    expect(rows[0].cost).toEqual({ kind: "unknown", reason: "product-unknown" });
    expect(rows[0].candidates.map((c) => c.productId)).toEqual(["ing-student", "ing-go", "ing-more"]);
  });

  test("een rekening zonder banknaam kan niet opgezocht worden", () => {
    const { rows } = accountCosts([account({ bank: "" })], catalogue);
    expect(rows[0].cost).toEqual({ kind: "unknown", reason: "no-bank" });
  });

  test("zijn de producten van een bank het WEL eens, dan is het bedrag bekend", () => {
    // Wise: 'geen abonnementen of plannen', twee producten, allebei nul.
    const wiseAccount = entry({
      id: "wise-rekening",
      product: "Wise-rekening",
      issuer: "Wise Europe SA",
      kind: "betaalrekening",
      fee: { value: 0, conditions: "De pagina zegt expliciet 'geen abonnementen of plannen'.", checkedAt: "2026-08-20" },
    });
    const wiseEu = entry({
      id: "wise-eu-rekening",
      product: "Wise EU-rekening",
      issuer: "Wise Europe SA",
      kind: "betaalrekening",
      fee: { value: 0, conditions: "Geen abonnementskosten.", checkedAt: "2026-08-21" },
    });
    const { rows, total } = accountCosts([account({ bank: "Wise", name: "Wise" })], [wiseAccount, wiseEu]);
    const cost = rows[0].cost;
    expect(cost.kind).toBe("known");
    if (cost.kind !== "known") throw new Error("onbereikbaar");
    expect(cost.matchedBy).toBe("provider-consensus");
    expect(cost.amount.perYearCents).toBe(0);
    // De OUDSTE datum van de rijen die het eens zijn: ze zijn het eens over het
    // bedrag, niet over hoe recent iemand gekeken heeft.
    expect(cost.asOf).toBe("2026-08-20");
    expect(total).toEqual({ kind: "complete", perYearCents: 0, accounts: 1 });
  });

  test("één product bij een bank is geen consensus maar gewoon dat ene product", () => {
    const solo = entry({ id: "knab-prive", product: "Knab Privérekening", issuer: "Knab (Aegon Bank N.V.)", kind: "betaalrekening", fee: { value: 6 } });
    const { rows } = accountCosts([account({ bank: "Knab", name: "Betaalrekening" })], [solo]);
    expect(rows[0].cost).toEqual({ kind: "unknown", reason: "product-unknown" });
    // Maar het bedrag dat we WEL kennen gaat niet verloren.
    expect(rows[0].candidates).toHaveLength(1);
  });
});

describe("het totaal", () => {
  const catalogue = [ING_GO, ING_MORE, ING_STUDENT, ICS_VISA_WORLD_CARD];

  test("alles bekend: één totaal per jaar", () => {
    const accounts = [
      account({ key: "a", name: "ING Go", bank: "ING" }),
      account({ key: "b", name: "ICS Visa World Card", bank: "ICS", type: "Creditcard" }),
    ];
    expect(accountCosts(accounts, catalogue).total).toEqual({
      kind: "complete",
      perYearCents: 4800 + 4295,
      accounts: 2,
    });
  });

  test("EEN GAT ERIN ZEGT DAT HET EEN GAT HEEFT, en de onbekende telt niet als nul mee", () => {
    const accounts = [
      account({ key: "a", name: "ING Go", bank: "ING" }),
      account({ key: "b", name: "Betaalrekening", bank: "Bank Ergens" }),
    ];
    const total = accountCosts(accounts, catalogue).total;
    expect(total).toEqual({ kind: "incomplete", knownPerYearCents: 4800, known: 1, unknown: 1 });
    // De veldnaam verschilt per variant: een som met gaten kan niet per ongeluk
    // als hét totaal gelezen worden.
    expect(total).not.toHaveProperty("perYearCents");
  });

  test("niets bekend: geen totaal, ook geen nul", () => {
    const { total } = accountCosts([account({ bank: "Bank Ergens" })], catalogue);
    expect(total).toEqual({ kind: "none" });
  });

  test("een spaarrekening staat niet in deze telling", () => {
    const { rows } = accountCosts([account({ name: "Oranje Spaarrekening", bank: "ING" })], catalogue);
    expect(rows).toHaveLength(0);
  });
});

describe("waar het loont", () => {
  const catalogue = [ING_GO, ING_MORE, ING_STUDENT, ING_BASISPAKKET, ICS_VISA_WORLD_CARD];

  test("een goedkoper pakket bij dezelfde bank, met het verschil per jaar en de VOORWAARDE erbij", () => {
    const { rows } = accountCosts([account({ name: "ING Go", bank: "ING" })], catalogue);
    const alt = rows[0].cheaperAtProvider;
    expect(alt?.fee.productId).toBe("ing-student");
    expect(alt?.savingPerYearCents).toBe(4800);
    // Zonder de voorwaarde is dit advies dat voor de meeste lezers niet werkt:
    // gratis is het alleen tussen 18 en 30.
    expect(alt?.conditional).toBe(true);
    expect(alt?.fee.conditions).toContain("18 tot 30 jaar");
  });

  test("een pakket dat je niet meer kunt openen wordt nooit aangeraden", () => {
    // ING BasisPakket (€ 4,85) is duurder dan ING Go, dus hij zou hier sowieso
    // niet komen — omgekeerd wél: een ING More-houder zou er anders heen gestuurd
    // worden terwijl het pakket voor nieuwe klanten niet bestaat.
    const { rows } = accountCosts([account({ name: "ING More", bank: "ING" })], catalogue);
    expect(rows[0].cheaperAtProvider?.fee.productId).toBe("ing-student");
    expect(rows[0].cheaperAtProvider?.fee.productId).not.toBe("ing-basispakket");
    expect(accountFees(catalogue).find((f) => f.productId === "ing-basispakket")?.openToNewCustomers).toBe(false);
  });

  test("een creditcard wordt niet vergeleken met een betaalpakket", () => {
    const acc = account({ name: "ICS Visa World Card", bank: "ICS", type: "Creditcard" });
    const { rows } = accountCosts([acc], catalogue);
    // ING Student is goedkoper dan € 42,95 per jaar, maar het is geen creditcard.
    expect(rows[0].cheaperElsewhere).toBeNull();
    expect(rows[0].cheaperAtProvider).toBeNull();
  });

  test("zonder bekend eigen bedrag geen tip: een besparing tegen een onbekende is een gok", () => {
    const { rows } = accountCosts([account({ name: "NL01INGB0000000001" })], catalogue);
    expect(rows[0].cost.kind).toBe("unknown");
    expect(rows[0].cheaperAtProvider).toBeNull();
    expect(rows[0].cheaperElsewhere).toBeNull();
  });

  test("een andere aanbieder telt apart van dezelfde bank", () => {
    // ING More € 7,00 p/m = € 84 per jaar. Bij ING zelf is Go € 36 goedkoper,
    // bunq Free scheelt de hele € 84 — dus allebei, elk met hun eigen bedrag.
    const zonderStudent = [ING_GO, ING_MORE, BUNQ_FREE];
    const { rows } = accountCosts([account({ name: "ING More", bank: "ING" })], zonderStudent);
    expect(rows[0].cheaperAtProvider?.fee.productId).toBe("ing-go");
    expect(rows[0].cheaperAtProvider?.savingPerYearCents).toBe(3600);
    expect(rows[0].cheaperElsewhere?.fee.productId).toBe("bunq-free");
    expect(rows[0].cheaperElsewhere?.savingPerYearCents).toBe(8400);
  });

  test("van bank wisselen voor hetzelfde bedrag is geen tweede tip", () => {
    // Met ING Student erbij levert de eigen bank net zoveel op als bunq. Twee
    // regels met hetzelfde bedrag lezen als twee adviezen waar er maar één is.
    const { rows } = accountCosts([account({ name: "ING More", bank: "ING" })], [...catalogue, BUNQ_FREE]);
    expect(rows[0].cheaperAtProvider?.savingPerYearCents).toBe(8400);
    expect(rows[0].cheaperElsewhere).toBeNull();
  });

  test("een bedrag dat aan een ANDER product hangt is geen alternatief", () => {
    // "Alleen binnen het ING Max-pakket (€ 44,99 per maand); de kaart zelf kost
    // daarbovenop niets." Als tip zou die nul beloven dat je € 30,60 per jaar
    // bespaart door € 539,88 per jaar te gaan betalen.
    const ingCardMax = entry({
      id: "ing-creditcard-max",
      product: "ING Creditcard Max",
      kind: "creditcard",
      fee: {
        value: 0,
        conditions: "Alleen binnen het ING Max-pakket (€ 44,99 per maand); de kaart zelf kost daarbovenop niets.",
      },
    });
    const acc = account({ name: "ICS Visa World Card", bank: "ICS", type: "Creditcard" });
    const { rows } = accountCosts([acc], [ICS_VISA_WORLD_CARD, ingCardMax]);
    expect(accountFees([ingCardMax])[0].pricedOnItsOwn).toBe(false);
    expect(rows[0].cheaperElsewhere).toBeNull();
    // Een kaart die zijn afhankelijkheid in zijn NAAM draagt gaat er ook uit.
    expect(accountFees([entry({ id: "x", product: "SNS Creditcard bij Studentenrekening", kind: "creditcard", fee: { value: 27.5, period: "jaar" } })])[0].pricedOnItsOwn).toBe(false);
  });

  test("een besparing onder een euro per maand is ruis, geen advies", () => {
    // Kleiner dan de prijsverhogingen die twee bronnen zelf al aankondigen
    // (ICS + € 1,55 per 15 september 2026, ANWB + € 1,75 per 1 november 2026).
    const netTeWeinig = entry({
      id: "ics-mastercard-classic",
      product: "ICS Mastercard Classic",
      issuer: "International Card Services B.V.",
      kind: "creditcard",
      fee: { value: 38.95, period: "jaar", conditions: "Geen." },
    });
    const acc = account({ name: "ICS Visa World Card", bank: "ICS", type: "Creditcard" });
    const dichtbij = accountCosts([acc], [ICS_VISA_WORLD_CARD, netTeWeinig]);
    expect(4295 - 3895).toBeLessThan(MIN_SAVING_PER_YEAR_CENTS);
    expect(dichtbij.rows[0].cheaperAtProvider).toBeNull();
  });
});

describe("de co-branded kaarten", () => {
  test("een ABN-kaart die door ICS wordt uitgegeven hoort bij ABN AMRO", () => {
    const abnCard = entry({
      id: "abn-credit-card",
      product: "ABN AMRO Credit Card",
      issuer: "International Card Services B.V.",
      kind: "creditcard",
      fee: { value: 2.55, conditions: "Informatieblad Betaaldiensten Particulieren." },
    });
    const acc = account({ bank: "ABN AMRO", name: "ABN AMRO Credit Card", type: "Creditcard" });
    const cost = accountCosts([acc], [abnCard]).rows[0].cost;
    expect(cost.kind).toBe("known");
    if (cost.kind !== "known") throw new Error("onbereikbaar");
    expect(cost.amount.perYearCents).toBe(3060);
  });

  test("Rabobank noemt zijn pakketten 'Rabo …' en dat is dezelfde bank", () => {
    const raboStandaard = entry({ id: "rabo-standaard", product: "Rabo Standaard", issuer: "Coöperatieve Rabobank U.A.", kind: "betaalpakket", fee: { value: 3.45 } });
    const raboFree = entry({ id: "rabo-free", product: "Rabo Free", issuer: "Coöperatieve Rabobank U.A.", kind: "betaalpakket", fee: { value: 0, conditions: "Bedoeld voor rekeninghouders van 18 tot en met 24 jaar." } });
    const { rows } = accountCosts([account({ bank: "Rabobank", name: "Rabo Standaard" })], [raboStandaard, raboFree]);
    const cost = rows[0].cost;
    expect(cost.kind).toBe("known");
    if (cost.kind !== "known") throw new Error("onbereikbaar");
    expect(cost.amount.cents).toBe(345);
    expect(rows[0].cheaperAtProvider?.fee.productId).toBe("rabo-free");
  });

  test("'Trading 212' bevat 'ing' en is geen ING-rekening", () => {
    const { rows } = accountCosts([account({ bank: "Trading 212", name: "Trading 212" })], [ING_GO, ING_MORE]);
    expect(rows[0].cost).toEqual({ kind: "unknown", reason: "provider-unknown" });
  });

  test("'ING Go' slaat niet aan op een rekening die 'ING Gouden' heet", () => {
    const { rows } = accountCosts([account({ bank: "ING", name: "ING Gouden Rekening" })], [ING_GO, ING_MORE]);
    expect(rows[0].cost.kind).toBe("unknown");
  });
});

describe("hasCostsToShow", () => {
  test("geen enkel bedrag en geen enkel pakket om te tonen: niets renderen", () => {
    const report = accountCosts([account({ bank: "Bank Ergens" })], [ING_GO]);
    expect(hasCostsToShow(report)).toBe(false);
  });

  test("een onbekend pakket met bekende alternatieven is wél iets om te zeggen", () => {
    const report = accountCosts([account({ name: "NL01INGB0000000001" })], [ING_GO, ING_MORE]);
    expect(hasCostsToShow(report)).toBe(true);
  });

  test("een lege catalogus geeft een leeg blok, en dat wordt niet gerenderd", () => {
    expect(hasCostsToShow(accountCosts([account()], []))).toBe(false);
  });
});
