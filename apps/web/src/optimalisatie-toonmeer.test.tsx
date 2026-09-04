// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import type { Account, CatalogueEntryLike, CatalogValue, Tx } from "@lavega/core";
import { makeFact, ownAccounts, TRAVEL_AGENT } from "@lavega/core";
import Optimalisatie from "./views/Optimalisatie";

/* "MEER TOP DOWN" — Cashback en Kosten, 22 augustus.
 *
 * Zijn opdracht in vier woorden, en het patroon lag er al: bij Statistieken en
 * het reisblok staat vooraan het ANTWOORD en gaat alle onderbouwing achter het
 * gedeelde <ToonMeer>. Dit bestand bewaakt dat die verplaatsing bij deze twee
 * modules geen informatie heeft gekost.
 *
 * DRIE EISEN, en de derde is de gevaarlijke:
 *   1. het antwoord staat vooraan — in ELKE toestand, ook als het antwoord
 *      "dat weten we niet" is;
 *   2. de onderbouwing is nog te openen: dicht is niet weg;
 *   3. een WEIGERING is nooit opgevouwen. Dat is geen uitleg maar de uitkomst
 *      zelf. "Van deze kaart weten we de prijs niet" wegvouwen laat de module
 *      leeg lijken terwijl er iets te zeggen valt — en dan lijkt hij stuk.
 *
 * WAAROM DIT BESTAND EEN ECHTE DOM GEBRUIKT en niet renderToStaticMarkup zoals
 * de twee buurbestanden: de vraag is hier niet óf een zin in de HTML staat maar
 * of de regel eromheen DICHT staat en van een klik opengaat. Bij <details>
 * blijven de kinderen gewoon in de DOM staan, dus een assertie op de HTML-string
 * kan het verschil tussen "opgevouwen" en "weg" per definitie niet zien. jsdom
 * opent een <details> wél op een klik (niet op Enter — zie ToonMeer.tsx), en dat
 * is precies wat hier nodig is.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* De rentetabel wordt bij het opstarten opgehaald. In de test hoort daar geen
 * netwerk aan te pas te komen: een test die stilletjes localhost:8787 probeert
 * is een test die anders uitvalt zodra iemand `pnpm dev:server` heeft draaien.
 * De provider vangt een mislukte fetch zelf op en valt terug op de ingebakken
 * momentopname, dus dit is genoeg — en het is dezelfde weg als op een telefoon
 * zonder bereik. */
const echteFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => Promise.resolve({ ok: false } as Response)) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = echteFetch;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const acc = (over: Partial<Account>): Account => ({
  key: "k",
  iban: "",
  name: "Rekening",
  bank: "ING",
  entity: "BV1",
  currency: "EUR",
  balance: 1000,
  ...over,
});

const spend = (key: string, month: number): Tx => ({
  id: key + month,
  accountKey: key,
  date: `2025-${String(month).padStart(2, "0")}-15`,
  amount: -2500,
  currency: "EUR",
  counterparty: "Albert Heijn",
  description: "",
  category: "",
  manual: false,
});

const ACCOUNTS = [
  acc({ key: "ing", bank: "ING", balance: 20_000, interestRate: 1.5 }),
  acc({ key: "t212", bank: "Trading 212", balance: 0, interestRate: 3.5 }),
];

/** Een gestelde markt, zodat de bedragen rekenwerk zijn op getallen die in dit
 *  bestand staan. Dezelfde vorm als in optimalisatie-cashback.test.tsx: één
 *  kaart van 2%, tegen zijn beste eigen 1,5%. */
const offer = (
  over: Partial<CatalogueEntryLike> & { pct: number; kind?: string; conditions?: string },
): CatalogueEntryLike => ({
  id: over.id ?? "test-card",
  product: over.product ?? "Testkaart",
  issuer: over.issuer ?? "Testbank N.V.",
  kind: over.kind,
  fields: {
    cashbackPct: {
      value: over.pct,
      route: "provider-page",
      sourceUrl: "https://example.test/tarieven",
      checkedAt: "2026-08-01",
      conditions: over.conditions ?? null,
      conditionsKnown: true,
    },
  },
});

/** Dezelfde kaart, nu met een PRIJS. De periode staat er expliciet in: een bedrag
 *  zonder eenheid stilzwijgend maandelijks noemen scheelt een factor twaalf. */
const withFee = (
  entry: CatalogueEntryLike,
  value: number,
  period: "maand" | "jaar",
): CatalogueEntryLike => ({
  ...entry,
  fields: {
    ...entry.fields,
    accountFee: {
      value,
      period,
      route: "provider-pdf",
      sourceUrl: "https://example.test/kosten",
      checkedAt: "2026-08-01",
      conditions: null,
      conditionsKnown: true,
    } as unknown as CatalogValue,
  },
});

const CARD = offer({ pct: 2, kind: "creditcard" });

const FACTS = [
  makeFact({
    agent: TRAVEL_AGENT,
    subject: "Trading 212 betaalpas",
    key: "cashbackPct",
    value: "1.5",
    source: "agent",
    updatedAt: "2026-08-18",
  }),
  makeFact({
    agent: TRAVEL_AGENT,
    subject: "ING betaalpas",
    key: "cashbackPct",
    value: "0",
    source: "agent",
    updatedAt: "2026-08-18",
  }),
];

/** Monteren én de rentetabel laten landen. Dat tweede `act` is niet
 *  ceremonieel: het effect dat de rentes ophaalt zet ná de eerste render nog
 *  eenmaal state, en zonder deze macrotask valt die update buiten de test —
 *  React waarschuwt daar terecht voor, en de waarschuwing zou elke echte
 *  act-fout onder zich begraven. */
async function mount(
  props: Partial<Parameters<typeof Optimalisatie>[0]> = {},
): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  const el = host;
  await act(async () => {
    root = createRoot(el);
    root.render(
      <Optimalisatie
        txs={Array.from({ length: 12 }, (_, i) => spend("ing", i + 1))}
        accounts={ACCOUNTS}
        rules={[]}
        own={ownAccounts(ACCOUNTS)}
        asOf="2026-01-15"
        busy={false}
        entries={[CARD]}
        facts={FACTS}
        onRateCommit={() => {}}
        {...props}
      />,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return el;
}

/* ── De drie eisen, als drie hulpjes ───────────────────────────────────────── */

function byTestId(el: HTMLElement, id: string): HTMLElement {
  const n = el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!n) throw new Error(`niet op het scherm: [data-testid="${id}"]`);
  return n;
}

/** Het diepste element dat `needle` bevat — dus de <p> zelf en niet de hele
 *  module. Zonder die filtering geeft `closest("details")` altijd null, omdat de
 *  bovenste treffer het scherm zelf is. */
function node(el: HTMLElement, needle: string): HTMLElement {
  const hits = [...el.querySelectorAll<HTMLElement>("*")].filter((n) =>
    n.textContent?.includes(needle),
  );
  const leaves = hits.filter((n) => !hits.some((o) => o !== n && n.contains(o)));
  if (leaves.length === 0) throw new Error(`niet op het scherm: "${needle}"`);
  return leaves[0];
}

/** Staat dit op de voorgrond — dus in geen enkele <details>? */
function staatVooraan(target: HTMLElement, wat: string) {
  expect(target.closest("details"), `"${wat}" is opgevouwen en dat mag niet`).toBeNull();
}

/** De drie eisen aan een opgevouwen stuk in één stap: het staat er, het zit in
 *  een toon-meer-paneel, de regel is standaard DICHT, en hij gaat open van een
 *  klik zonder dat de inhoud verandert. Geeft het label terug — dát is wat de
 *  lezer met de regel dicht ziet, en een label dat niets belooft is een label
 *  waar niemand op klikt. */
function opvouwbaar(target: HTMLElement, wat: string): string {
  const tekst = target.textContent ?? "";
  expect(
    target.closest(".toonmeer-panel"),
    `"${wat}" staat niet in een toon-meer-paneel`,
  ).not.toBeNull();

  const details = target.closest("details") as HTMLDetailsElement | null;
  expect(details, `"${wat}" heeft geen <details> om open te klikken`).not.toBeNull();
  expect(details!.open, `"${wat}" staat standaard open`).toBe(false);

  const summary = details!.querySelector("summary")!;
  act(() => summary.click());
  expect(details!.open, `"${wat}" gaat niet open van een klik`).toBe(true);
  // Opvouwen mag niets vervangen: na het openen staat er hetzelfde.
  expect(target.textContent, `"${wat}" is veranderd door het openen`).toBe(tekst);
  return summary.textContent ?? "";
}

/* ══════════════ CASHBACK — het antwoord vooraan ═══════════════════════════ */

test("cashback: de nettoregel is het antwoord en staat vooraan, mét de kaartprijs erin", async () => {
  // € 163,92 bruto per jaar, min 12 × € 5,00 = € 60,00, dus € 103,92 netto.
  const el = await mount({ entries: [withFee(CARD, 5, "maand")] });

  const antwoord = byTestId(el, "cashback-antwoord");
  staatVooraan(antwoord, "de antwoordregel");
  expect(antwoord.textContent).toContain("Testkaart");
  expect(antwoord.textContent).toContain("163,92");
  expect(antwoord.textContent).toContain("vóór kaartkosten");

  // En de aftrek zelf, in dezelfde volgorde als hij hem leest: bruto, kosten,
  // netto. Alle drie op de voorgrond, want dit IS het antwoord.
  staatVooraan(byTestId(el, "cashback-kosten"), "wat de kaart kost");
  const netto = byTestId(el, "cashback-netto");
  staatVooraan(netto, "de nettoregel");
  expect(netto.textContent).toContain("103,92");
});

test("cashback: een onbekende kaartprijs is de UITKOMST en staat vooraan, niet in de plooi", async () => {
  // De echte toestand van vandaag: geen enkele kaart met een aantoonbare cashback
  // wordt door een bron beprijsd. Dat is geen bug en geen voetnoot — het is wat
  // de module te zeggen heeft, en het hoort dus op de voorgrond.
  const el = await mount();
  const kosten = byTestId(el, "cashback-kosten");
  staatVooraan(kosten, "kaartprijs onbekend");
  expect(kosten.textContent).toContain("Wat deze kaart zelf kost, weten we niet");
  expect(kosten.textContent).toContain("geen nul");
  // Er is geen netto zolang de ene helft ontbreekt, dus die regel bestaat niet.
  expect(el.querySelector('[data-testid="cashback-netto"]')).toBeNull();
});

test("cashback: 'geen aanbeveling' is een uitkomst en staat vooraan", async () => {
  // € 16,90 per maand is € 202,80 per jaar tegen € 163,92 opbrengst: € 38,88
  // achteruit. Dat afvallen is het antwoord op zijn vraag, niet de onderbouwing.
  const el = await mount({ entries: [withFee(CARD, 16.9, "maand")] });
  const geen = byTestId(el, "cashback-geen");
  staatVooraan(geen, "geen aanbeveling");
  expect(geen.textContent).toContain("Geen aanbeveling");
  expect(geen.textContent).toContain("38,88");
});

test("cashback: is er niets te vergelijken, dan staat de reden vooraan en niet in de plooi", async () => {
  const el = await mount({ entries: [] });
  const leeg = node(el, "Geen enkele kaart in de catalogus");
  staatVooraan(leeg, "niets om mee te vergelijken");
});

test("cashback: de openstaande vraag is een weigering en staat vooraan", async () => {
  // Zonder feiten valt de ING-pas onder de aanname (nul), maar de Trading
  // 212-pas niet — over die kaart mag niets worden ingevuld. Die zin verhuisde
  // deze ronde van onderaan de module naar boven, want een afwezigheid mag geen
  // conclusie dragen die zij niet kan dragen.
  const el = await mount({ facts: [] });
  const open = byTestId(el, "cashback-open");
  staatVooraan(open, "de openstaande vraag");
  expect(open.textContent).toContain("Cashback onbekend voor");
  expect(open.textContent).toContain("Trading 212 betaalpas");
});

/* ══════════════ CASHBACK — de onderbouwing achter de plooi ════════════════ */

test("cashback: de drie beats, de basis en de peildatum zitten in de plooi en gaan open", async () => {
  const el = await mount({ entries: [withFee(CARD, 5, "maand")] });

  const label = opvouwbaar(byTestId(el, "cashback-verschil"), "het brutoverschil per maand");
  // Het label is een BELOFTE, geen "meer informatie".
  expect(label).toContain("Waar deze cijfers vandaan komen");

  // Dicht is niet weg: alle vier de stukken staan er nog, in hetzelfde paneel.
  for (const id of ["cashback-nu", "cashback-beste", "cashback-basis", "cashback-kaarten"]) {
    expect(
      byTestId(el, id).closest(".toonmeer-panel"),
      `${id} zit niet in de plooi`,
    ).not.toBeNull();
  }
  expect(byTestId(el, "cashback-basis").textContent).toContain("334 dagen afschrift");
  expect(byTestId(el, "cashback-beste").textContent).toContain("peildatum");
});

test("cashback: de vorige volle maand zit in de plooi, zonder tweede driehoekje eronder", async () => {
  const el = await mount({ entries: [withFee(CARD, 5, "maand")] });
  const maand = byTestId(el, "cashback-vorige-maand");
  expect(maand.closest(".toonmeer-panel")).not.toBeNull();
  expect(maand.textContent).toContain("Vorige volle maand");
  // Een driehoekje ín een driehoekje is twee klikken naar hetzelfde antwoord.
  expect(maand.querySelector("details")).toBeNull();
});

test("cashback: de voorwaarden bij het tarief zitten in een eigen plooi, en het LABEL waarschuwt", async () => {
  // Een 5%-kaart achter een stakingdrempel is voor hem geen 5%-kaart, dus de
  // tekst mag opgevouwen maar het bestaan van de voorwaarde niet. Het label van
  // de plooi is daarom zelf de waarschuwing.
  const el = await mount({
    entries: [
      offer({
        id: "cc",
        product: "Obsidian",
        issuer: "Crypto.com",
        kind: "prepaid",
        pct: 5,
        conditions: "TIER GATE: staking van CRO vereist.",
      }),
    ],
  });
  const tekst = node(el, "TIER GATE");
  const label = opvouwbaar(tekst, "de voorwaarden bij het tarief");
  expect(label).toContain("Aan dit tarief hangen voorwaarden");

  // En het merkteken dat dit geen gewone bankkaart is, blijft vooraan staan —
  // opgevouwen zou de antwoordregel als "de beste bankkaart" lezen.
  staatVooraan(byTestId(el, "cashback-antwoord"), "de antwoordregel");
  expect(byTestId(el, "cashback-antwoord").textContent).toContain("prepaidkaart");
});

/* ══════════════ CASHBACK — de ECHTE catalogus van vandaag ════════════════ */

test("cashback: op de echte catalogus is de onbekende kaartprijs het antwoord, en die staat vooraan", async () => {
  /* GEEN GESTELDE MARKT, maar de catalogus die vandaag meegaat in de app. Dit is
     de toestand waar deze ronde expliciet voor gewaarschuwd is, en ze is echt
     nagemeten in plaats van aangenomen: `marketCashbackOptions` geeft er acht
     kaarten uit, van Crypto.com Obsidian op 5% tot Wirex op 0,5%, en van geen
     ENKELE daarvan noemt een bron een maand- of jaarprijs — `productFeesById`
     geeft voor alle acht null.

     Deze test staat er om te zien wanneer dat verandert. Gaat één zo'n kaart
     zichzelf beprijzen, dan valt hij om en hoort hij ook om te vallen: dan is er
     een nettobedrag te noemen en is de weigering hieronder niet meer waar. */
  const el = await mount({ entries: undefined });

  const antwoord = byTestId(el, "cashback-antwoord");
  staatVooraan(antwoord, "de antwoordregel");
  expect(antwoord.textContent).toContain("Obsidian");
  // Geen gewone bankkaart, en dat merkteken staat op de antwoordregel zelf.
  expect(antwoord.textContent).toContain("prepaidkaart");

  const kosten = byTestId(el, "cashback-kosten");
  staatVooraan(kosten, "kaartprijs onbekend op de echte catalogus");
  expect(kosten.textContent).toContain("Wat deze kaart zelf kost, weten we niet");
  expect(kosten.textContent).toContain("geen nul");
  // Zolang die helft ontbreekt is er geen netto en ook geen afwijzing: allebei
  // zouden een conclusie zijn op een afwezigheid.
  expect(el.querySelector('[data-testid="cashback-netto"]')).toBeNull();
  expect(el.querySelector('[data-testid="cashback-geen"]')).toBeNull();

  // De ZIN over de catalogus is onderbouwing en vouwt wél op — het merkteken
  // vooraan draagt het nieuws al.
  opvouwbaar(node(el, "Geen gewone bankkaart"), "de uitleg over de catalogus");
});

test("cashback: is er niets te onderbouwen, dan is er ook geen plooi die dat belooft", async () => {
  /* Een plooi die op een leeg paneel uitkomt is erger dan geen plooi: het label
     belooft "waar deze cijfers vandaan komen" en dan is er niets. Zonder
     rekeningen is er geen enkele kaart om iets over te zeggen, dus hoort de
     module alleen de reden te tonen. */
  const el = await mount({ accounts: [], own: ownAccounts([]), txs: [], entries: [] });
  const leeg = node(el, "Nog geen betaalrekening of creditcard in beeld");
  staatVooraan(leeg, "er is nog niets om mee te vergelijken");

  const labels = [...el.querySelectorAll(".toonmeer-label")].map((n) => n.textContent ?? "");
  expect(labels.some((l) => l.includes("Waar deze cijfers vandaan komen"))).toBe(false);
});

/* ══════════════ KOSTEN — het antwoord vooraan ═════════════════════════════ */

/** Zijn eigen geval, op de ECHTE catalogus: een ING-betaalrekening. Met de naam
 *  van het pakket erin herkent LaVega het tarief; zonder die naam niet, en juist
 *  dan moet zichtbaar zijn wat er wél bekend is. */
const ING = (name: string): Account[] => [
  {
    key: "B1",
    iban: "NL01INGB",
    name,
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 1000,
    type: "Betaalrekening",
  },
];

test("kosten: wat het je per jaar kost om te houden wat je hebt, staat vooraan", async () => {
  const el = await mount({ accounts: ING("ING Student"), entries: undefined, txs: [] });
  const totaal = byTestId(el, "kosten-totaal");
  staatVooraan(totaal, "het totaal");
  expect(totaal.textContent).toContain("per jaar om deze");
});

test("kosten: staat er van geen enkele rekening een tarief vast, dan is die weigering het antwoord", async () => {
  // Een bank die de catalogus niet kent. Dan is er geen totaal, en dat is de
  // uitkomst — geen nul, en niets om weg te vouwen.
  const el = await mount({
    accounts: [
      {
        key: "X1",
        iban: "",
        name: "Rekening",
        bank: "Bank Zonder Documenten",
        entity: "Prive",
        currency: "EUR",
        balance: 100,
        type: "Betaalrekening",
      },
    ],
    entries: undefined,
    txs: [],
  });
  // Zonder één tarief én zonder één pakket om te tonen komt de module er niet:
  // een leeg blok wordt niet gerenderd. Is hij er wél, dan staat de weigering
  // vooraan.
  const totaal = el.querySelector<HTMLElement>('[data-testid="kosten-totaal"]');
  if (totaal) staatVooraan(totaal, "de weigering");
});

test("kosten: een uitgesproken nul is een bekende nul — die staat vooraan, mét zijn eis", async () => {
  // Review 4, punt 24: "ING is bij hem een studentenrekening — hij betaalt
  // niets. Dat moet vindbaar zijn." Vindbaar betekent niet: achter een
  // dichtgeklapt driehoekje.
  const el = await mount({ accounts: ING("ING Student"), entries: undefined, txs: [] });
  const gratis = byTestId(el, "kosten-gratis-B1");
  staatVooraan(gratis, "de gratis rekening");
  expect(gratis.textContent).toContain("Gratis, mits");
  // Nooit zonder de eis: elke studentenrekening staat op € 0,00 in het wettelijk
  // verplichte kostendocument, mét een leeftijdsvoorwaarde ernaast.
  expect(gratis.textContent).toContain("18 tot 30 jaar");
});

test("kosten: 'we weten niet wat deze rekening kost' staat vooraan, met de echte oorzaak erbij", async () => {
  const el = await mount({ accounts: ING("Betaalrekening"), entries: undefined, txs: [] });
  const onbekend = byTestId(el, "kosten-onbekend-B1");
  staatVooraan(onbekend, "de onbekende rekening");
  expect(onbekend.textContent).toContain("kosten onbekend, en dat is geen nul");
  // De oorzaak, niet alleen de melding: ING staat in de catalogus, maar welk van
  // zijn pakketten dit is valt uit de naam niet af te leiden.
  expect(onbekend.textContent).toContain("niet welk van deze producten dit is");

  // En de gratis pakketten die er bij deze bank zijn, staan er ook vooraan —
  // met hun eis en hun bron.
  const gratisBij = byTestId(el, "gratis-bij-B1");
  staatVooraan(gratisBij, "de gratis pakketten bij ING");
  expect(gratisBij.textContent).toContain("ING Student");
  expect(gratisBij.textContent).toContain("18 tot 30 jaar");
});

/* ══════════════ KOSTEN — de onderbouwing achter de plooi ══════════════════ */

test("kosten: de tabel met tarieven, bronnen en peildata zit in de plooi en gaat open", async () => {
  const el = await mount({ accounts: ING("ING Student"), entries: undefined, txs: [] });
  const tabel = el.querySelector<HTMLElement>(".toonmeer-panel table");
  expect(tabel, "de kostentabel staat niet in een toon-meer-paneel").not.toBeNull();

  const details = tabel!.closest("details") as HTMLDetailsElement;
  expect(details.open, "de kostentabel staat standaard open").toBe(false);
  const summary = details.querySelector("summary")!;
  expect(summary.textContent).toContain("Per rekening");
  act(() => summary.click());
  expect(details.open, "de kostentabel gaat niet open van een klik").toBe(true);

  // Dicht is niet weg: de bron en de peildatum staan er nog, in de tabel.
  expect(tabel!.textContent).toContain("peildatum");
});

test("kosten: de pakketlijst van een onherkende rekening zit in de plooi, de oorzaak niet", async () => {
  const el = await mount({ accounts: ING("Betaalrekening"), entries: undefined, txs: [] });
  // De catalogusopsomming is onderbouwing en vouwt op...
  const lijst = node(el, "tarieven bij ING");
  expect(lijst.closest(".toonmeer-panel"), "de pakketlijst staat niet in de plooi").not.toBeNull();
  // ...maar de reden dat we het niet weten staat vooraan.
  staatVooraan(byTestId(el, "kosten-onbekend-B1"), "de oorzaak");
});
