// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import type {
  Account,
  EntityProfile,
  Invoice,
  Tx,
  VatNote,
  VatPosition,
  VatSettings,
} from "@lavega/core";
import { DE_TAX_PACK, makeInvoice, NL_TAX_PACK, sumTaxFigures, vatPosition } from "@lavega/core";
import Belasting, { noteText, readBookkeepingSheet } from "./views/Belasting";
import { setHomeCountry } from "./settings";
import { adminCopy } from "./copy/admin.js";
import { optimiseCopy } from "./copy/optimise.js";
import { formatEuroIn } from "./format.js";

/* Belasting after the UI review: no grey instruction paragraph, and one module
 * per tax that the profile's country actually has rules for. The modules are
 * driven by packages/core/src/taxpacks — NL has VAT only (its voorlopige
 * aanslag is set by the Belastingdienst, so LaVega does not model it), DE also
 * prepays profit tax. Nothing may appear that the engine cannot compute. */

const ACCOUNTS: Account[] = [
  {
    key: "A1",
    iban: "NL01",
    name: "Zakelijk",
    bank: "ING",
    entity: "BV1",
    currency: "EUR",
    balance: 10_000,
  },
];

function tx(id: string, date: string, amount: number): Tx {
  return {
    id,
    accountKey: "A1",
    date,
    amount,
    currency: "EUR",
    counterparty: "Klant",
    description: "",
    category: "",
    manual: false,
  };
}

/* ── De grens: een vault met ALLEBEI de kanten erin ────────────────────────
 *
 * De IBANs zijn voluit, en dat is nodig: `ownAccounts` telt alleen waarden van
 * 8 tekens of langer met een cijfer als eigen kenmerk, zodat "Betaalrekening"
 * nooit per ongeluk op een omschrijving matcht. Met "NL01" (de fixture van de
 * btw-tests hierboven) is er dus geen enkel eigen kenmerk, en dan kan een rij
 * met één been ook geen bewijs dragen. */
const GRENS_ACCOUNTS: Account[] = [
  {
    key: "A1",
    iban: "NL01INGB0001234567",
    name: "Zakelijk",
    bank: "ING",
    entity: "BV1",
    currency: "EUR",
    balance: 10_000,
  },
  {
    key: "P1",
    iban: "NL02INGB0007654321",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Privé",
    currency: "EUR",
    balance: 5_000,
  },
];
/** Alleen BV1 is ingedeeld. "Privé" heeft geen rij en is dus privé via de harde
 *  standaard van entities.ts — precies zoals in een echte vault. */
const GRENS_PROFILES: EntityProfile[] = [{ entity: "BV1", scope: "business" }];

function gtx(o: Partial<Tx> & Pick<Tx, "id" | "accountKey" | "date" | "amount">): Tx {
  return { currency: "EUR", counterparty: "", description: "", category: "", manual: false, ...o };
}

const GRENS_TXS: Tx[] = [
  // GEKOPPELD: beide benen staan in de vault, één dag uit elkaar, op de cent gelijk.
  gtx({
    id: "x1",
    accountKey: "A1",
    date: "2026-03-14",
    amount: -4_300,
    counterparty: "Privé",
    description: "Naar NL02INGB0007654321",
  }),
  gtx({
    id: "x2",
    accountKey: "P1",
    date: "2026-03-15",
    amount: 4_300,
    counterparty: "BV1",
    description: "Van NL01INGB0001234567",
  }),
  // ÉÉN BEEN: de BV boekt naar een rekening waarvan geen afschrift geïmporteerd
  // is. Er is dus geen tegenboeking; de rij telt mee omdat er een eigen
  // rekening op staat, aan de andere kant van de grens.
  gtx({
    id: "x3",
    accountKey: "A1",
    date: "2026-05-08",
    amount: -1_900,
    counterparty: "Privé",
    description: "NL02INGB0007654321 aanvulling",
  }),
  // HET BIJPRODUCT: één tegenpartij aan allebei de kanten. Twee afschrijvingen,
  // dus ze kunnen elkaars tegenboeking niet zijn.
  gtx({ id: "x4", accountKey: "P1", date: "2026-02-01", amount: -640, counterparty: "Coolblue" }),
  gtx({ id: "x5", accountKey: "A1", date: "2026-07-20", amount: -310, counterparty: "Coolblue" }),
  // BUITEN DE METING: een transactie op een rekening die niet in de vault staat.
  gtx({ id: "x6", accountKey: "GONE", date: "2026-04-01", amount: -50, counterparty: "Onbekend" }),
];

type RenderOpts = {
  invoices?: Invoice[];
  vatSettings?: VatSettings[];
  asOf?: string;
  /* De grensmodule krijgt bewust EIGEN, ONGESCOPEERDE lijsten — dat is de hele
   * reden dat die props bestaan. Standaard zijn ze gelijk aan de gescopeerde
   * lijsten, zoals in een vault waarin nog niets is ingedeeld. */
  allAccounts?: Account[];
  allTxs?: Tx[];
  entityProfiles?: EntityProfile[];
};

function render(txs: Tx[], entities = ["BV1"], opts: RenderOpts = {}) {
  return renderToStaticMarkup(
    <Belasting
      entities={entities}
      txs={txs}
      accounts={ACCOUNTS}
      asOf={opts.asOf ?? "2026-08-16"}
      vatSettings={opts.vatSettings ?? []}
      invoices={opts.invoices ?? []}
      scheduledFlows={[]}
      allAccounts={opts.allAccounts ?? ACCOUNTS}
      allTxs={opts.allTxs ?? txs}
      entityProfiles={opts.entityProfiles ?? []}
      busy={false}
      onSaveVatSettings={() => {}}
      onSaveScheduledFlows={() => {}}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=nl; Path=/";
});

afterEach(() => {
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
});

test("countryLabel and caveatsByCountry (copy/admin.ts) stay byte-identical to the Dutch source packs", () => {
  expect(adminCopy.nl.belasting.header.countryLabel.NL).toBe(NL_TAX_PACK.label);
  expect(adminCopy.nl.belasting.header.countryLabel.DE).toBe(DE_TAX_PACK.label);
  expect(adminCopy.nl.belasting.header.caveatsByCountry.NL).toEqual(NL_TAX_PACK.caveats);
  expect(adminCopy.nl.belasting.header.caveatsByCountry.DE).toEqual(DE_TAX_PACK.caveats);
  /* The German profit-tax prose was rendered STRAIGHT FROM THE PACK until
   * 17 Sep, so an English reader got two Dutch paragraphs on the Tax screen
   * while every other string on it was translated. Same pattern as the
   * caveats above: the pack stays the Dutch source, copy mirrors it, English
   * is authored. */
  expect(adminCopy.nl.belasting.header.profitTaxDE.what).toBe(DE_TAX_PACK.profitTax?.what);
  expect(adminCopy.nl.belasting.header.profitTaxDE.rateBasis).toBe(
    DE_TAX_PACK.profitTax?.rateBasis,
  );
});

/* The bug itself, not just its cause: read the rendered German tax screen in
 * English and insist no Dutch survives it. A key-parity check cannot catch
 * this — both languages HAD a key, the view just never asked for it. */
test("the German profit-tax screen has no Dutch left in it when the reader is English", () => {
  setHomeCountry("DE");
  document.cookie = "lavega_locale=en; Path=/";
  const html = render([]);
  for (const dutch of [
    "vooruitbetalen op vier vaste data",
    "kort na afloop van het jaar",
    "daarover",
    "afgerond op",
    "waar ondernemers op stuklopen",
  ])
    expect(html, `Dutch leaked into the English Tax screen: ${dutch}`).not.toContain(dutch);
  expect(html).toContain("four fixed dates");
  /* The statutory terms are NOT translated, deliberately: "Vorauszahlung" and
   * "Nachzahlung" are what the Finanzamt calls them. */
  expect(html).toContain("Vorauszahlung");
});

test("the grey instruction sentence under the title is gone", () => {
  const html = render([]);
  expect(html).not.toContain("LaVega schat per BV het BTW-bedrag dat je opzij moet zetten");
  expect(html).not.toContain("indicatieve schatting</span>");
});

test("NL gets exactly one tax module — its VAT — because that is all LaVega can compute there", () => {
  const html = render([tx("t1", "2026-08-01", 12_100)]);
  const titles = [...html.matchAll(/class="module-title">([^<]*)</g)].map((m) => m[1]);
  // "Privé en zakelijk" is GEEN belasting en telt daarom niet mee in de eyebrow
  // hieronder — het is een meting die naast de belasting staat. "Niet
  // berekend" is geen eigen module meer (zie hieronder): de kop droeg zijn
  // eigen ⓘ ernaast en de module-titel is dus weg, niet zijn inhoud.
  expect(titles).toEqual(["BTW", "Privé en zakelijk"]);

  expect(html).toContain("Belasting · Nederland");
  expect(html).toContain("1 belasting");
  expect(html).toContain("Tarieven in Nederland: 21% / 9% / 0%");
  // Het ⓘ staat naast de kop, dicht — en de lijst zelf staat er dus, want
  // <details> houdt zijn kinderen in de DOM. Beide apart getoetst: het ene
  // bewijst dat het ⓘ er is, het andere dat de inhoud niet is verdwenen.
  expect(html).toContain('class="toonmeer toonmeer-info"');
  expect(html).toContain("Wat LaVega hier niet berekent");
  expect(html).toContain("voorlopige aanslag vennootschapsbelasting");
  expect(html).not.toContain("Vorauszahlung");
});

test("switching the profile to DE adds the prepayment module, with its dated instalments", () => {
  setHomeCountry("DE");
  // € 100.000 profit realised this year.
  const html = render([tx("t1", "2026-02-01", 100_000)]);

  const titles = [...html.matchAll(/class="module-title">([^<]*)</g)].map((m) => m[1]);
  expect(titles).toEqual(["USt", "Vorauszahlung", "Privé en zakelijk"]);
  expect(html).toContain("Belasting · Duitsland");
  expect(html).toContain("2 belastingen");
  expect(html).toContain("Tarieven in Duitsland: 19% / 7% / 0%");

  // 30% of € 100.000 = € 30.000, cut into the four statutory dates. The two
  // that already passed roll into the Nachzahlung of the following year.
  expect(html).toContain("2026-09-10");
  expect(html).toContain("2026-12-10");
  expect(html).toContain("Nachzahlung 2026");
  expect(html).toContain("2027-03-10");
  // It is an estimate until the Finanzamt assesses it, and says so.
  expect(html).toContain("schatting");
});

test("a quarter with only costs is money BACK, not a dash and never € 0,00", () => {
  // This test used to assert a dash. A quarter whose movements are net negative
  // is the proxy saying "terug te vragen", and rendering that as an absence is
  // defect (c)'s cousin: a refund shown as nothing (design 2026-08-20).
  const html = render([tx("t1", "2026-08-01", -5_000)]);
  expect(html).toContain("BTW");
  expect(html).not.toContain("€&nbsp;0,00");
  expect(html).toContain("terug te vragen");
  // and LaVega does not invent the date the Belastingdienst pays
  expect(html).toContain("wanneer de Belastingdienst uitbetaalt");
});

test("an entity with no movements at all in the period says so — it does not say zero", () => {
  const html = render([tx("t1", "2026-01-05", 12_100)]); // Q1, and we stand in Q3
  expect(html).toContain("geen transacties");
  expect(html).not.toContain("€&nbsp;0,00");
});

/* ── Richting B op het scherm: de grens tussen privé en zakelijk ─────────── */

test("geen entiteit als zakelijk gemarkeerd is GEEN nul overboekingen, en het scherm zegt welke van de twee het is", () => {
  // De fout die dit voorkomt is de fout die dit project al twee keer betaald
  // heeft: `entities.ts` zet elke onbekende entiteit op privé, dus in een vault
  // waarin hij niets heeft ingedeeld is het aantal kruisingen STRUCTUREEL nul.
  // "€ 0,00" zou hier waar zijn en tegelijk het verkeerde antwoord.
  const html = render([tx("t1", "2026-03-14", -4_300)]);

  expect(html).toContain("Privé en zakelijk");
  expect(html).toContain('data-testid="grens-geen-zakelijke-entiteit"');
  expect(html).toContain("nog geen onderneming als zakelijk gemarkeerd");
  expect(html).toContain("Dat is iets anders dan nul overboekingen");
  // en het wijst naar de plek waar dat besluit al woont, in plaats van hem iets
  // op te dragen (sectie 7: wie beslist).
  expect(html).toContain("Persoonlijk of zakelijk");
  // Nergens een nul, en ook geen gemeten totaal — er is niets gemeten.
  expect(html).not.toContain("€&nbsp;0,00");
  expect(html).not.toContain("Gemeten in je transacties");
});

/* ── Richting A on screen (design 2026-08-20) ─────────────────────────────── */

test("mid-period the figure says it is the stand tot vandaag, not the aangifte", () => {
  // 16 Aug 2026 sits inside Q3 (1 Jul - 30 Sep), due 31 Oct.
  const html = render([tx("t1", "2026-07-10", 12_100)]);
  expect(html).toContain("Q3 2026");
  expect(html).toContain("uiterlijk 2026-10-31");
  expect(html).toContain("loopt nog");
  expect(html).toContain("stand tot 2026-08-16");
  expect(html).toContain("niet de aangifte");
});

test("a closed period says it is closed instead", () => {
  // 20 July: Q2 is over, its deadline (31 July) is not.
  const html = render([tx("t1", "2026-05-10", 12_100)], ["BV1"], { asOf: "2026-07-20" });
  expect(html).toContain("Q2 2026");
  expect(html).toContain("afgesloten");
  expect(html).not.toContain("loopt nog");
});

const invoice = (o: Partial<Invoice> = {}): Invoice =>
  makeInvoice({
    entity: "BV1",
    direction: "in",
    counterparty: "Klant",
    issueDate: "2026-07-10",
    dueDate: "2026-08-10",
    amount: 1210,
    vatAmount: 210,
    currency: "EUR",
    status: "expected",
    sourceType: "csv",
    ...o,
  });

test("(b) vatAmount reaches the screen: the invoice basis, with its coverage", () => {
  const invoices = [
    invoice(),
    invoice({ direction: "out", counterparty: "Leverancier", amount: 484, vatAmount: 84 }),
  ];
  const vatSettings: VatSettings[] = [
    {
      entity: "BV1",
      frequency: "quarterly",
      defaultRatePct: 21,
      mixedRates: false,
      vatBasis: "factuurstelsel",
    },
  ];
  // No bank movement at all in Q3: the proxy would know nothing, the invoices do.
  const html = render([], ["BV1"], { invoices, vatSettings });
  expect(html).toContain("je facturen");
  expect(html).toContain("2 van de 2 facturen");
  expect(html).toContain("126,00"); // 210 - 84 = € 126 te betalen
  expect(html).toContain("te betalen");
});

test("without a stelsel the invoices are counted but not used, and it asks which one", () => {
  const invoices = [invoice(), invoice({ direction: "out", amount: 484, vatAmount: 84 })];
  const html = render([tx("t1", "2026-07-10", 12_100)], ["BV1"], { invoices });
  expect(html).toContain("Factuurstelsel of kasstelsel?");
  expect(html).not.toContain("je facturen (factuurstelsel)");
  expect(html).toContain("marge-benadering");
});

test("(a) the bookkeeping sheet reaches the BTW figure through the view's own reader", () => {
  // The seam the view uses on a CSV he picks: text -> rows -> figures -> basis.
  const csv = [
    "Periode;Omzet;Kosten;Btw over omzet;Voorbelasting",
    "Q3 2026;100000;20000;21000;4200",
    "Q2 2026;50000;10000;10500;2100",
  ].join("\n");
  const sheet = readBookkeepingSheet(csv);
  expect(sheet.rows).toHaveLength(2);
  const figures = sumTaxFigures(sheet.rows, "2026-07-01", "2026-09-30");
  expect(figures.vatChargedCents).toBe(2_100_000);
  const p = vatPosition({
    txs: [],
    asOf: "2026-08-16",
    settings: { entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false },
    figures,
  });
  expect(p.basis).toBe("sheet");
  expect(p.netCents).toBe(1_680_000); // 21000 - 4200, his own numbers
});

/* ── DE WOORDTEST ──────────────────────────────────────────────────────────
 *
 * Sectie 7 van docs/superpowers/specs/2026-08-20-belastingoptimalisatie-design.md:
 * LaVega mag zeggen wat er gebeurd is, wanneer de volgende datum valt en wat een
 * gepubliceerde regel zegt — niet wat hij ermee moet doen. Goede voornemens in
 * een comment hebben een houdbaarheidsdatum; een rode test niet.
 *
 * VIER DINGEN OVER DEZE TEST, alle vier met opzet:
 *
 *  1. HIJ IS GESCOPEERD OP DIT ONDERDEEL en dat moet zo blijven. Hij rendert de
 *     Belasting-boom en loopt de copy van deze feature af — nooit de repo. Op
 *     Op 25 augustus gemeten: `grep -rn -iE "optimaal|bespaar" apps/web/src`
 *     raakt BUITEN dit testbestand precies één regel — een comment in
 *     Optimalisatie.tsx ("bespaard"). Dat scherm VERGELIJKT twee rentes die hij
 *     echt heeft, en dat is een meting over andere data — daar is dat woord
 *     terecht. Een repo-brede variant van deze test blaft op dag één op een
 *     legitieme feature en wordt daarna weggegooid, en dan is de structurele
 *     bescherming van sectie 7 er ook niet meer.
 *  2. HIJ LEEST GERENDERDE STRINGS, dus een comment kan hem niet laten afgaan
 *     en een zin kan zich er niet achter verstoppen.
 *  3. HIJ LOOPT OOK DE GEËXPORTEERDE COPY AF (`optimiseCopy.nl.grens`,
 *     `noteText`, `pack.caveats`). Een tak die geen enkele fixture bereikt, wordt door HTML
 *     nooit gelezen: `VatNote` heeft acht takken en de vorige versie van deze
 *     test raakte er twee. `boekhouding-andere-periode` is met props zelfs
 *     helemaal niet te bereiken (hij hangt aan een bestand dat hij kiest).
 *  4. WAT ER NOG BUITEN VALT, eerlijk opgeschreven: een zin die RECHTSTREEKS in
 *     de JSX staat en alleen onder een voorwaarde rendert die geen fixture
 *     raakt, ziet deze test niet. In dit scherm is dat vandaag nog de regel over
 *     het geïmporteerde boekhoudbestand (Belasting.tsx, achter de bestandskiezer).
 *     Nieuwe copy hoort daarom in een geëxporteerd object, niet los in de JSX.
 */
const FORBIDDEN = [
  "advies",
  "adviseer",
  "adviseren",
  "adviseert",
  "wij raden aan",
  "we raden aan",
  "je moet",
  "u moet",
  "moet je",
  "moet u",
  "optimaal",
  "bespaar",
  "besparing",
  "besparen",
  "bespaart",
  "fiscaal voordeel",
  "belastingvoordeel",
  "belastingvoordelen",
  // GEVONDEN OP 25 AUGUSTUS 2026, bij een adversariële audit van Richting B:
  // de eerste versie van deze lijst ving alleen de stam ("bespaar", "adviseer")
  // en niet de vervoeging. "besparen" en "adviseren" bevatten die stam NIET
  // als substring — Nederlandse spelling verkort de klinker in de open lettergreep
  // ("spaar" -> "sparen"), dus "Je zou € 4.100 besparen als je…" — de zin die
  // sectie 7 zelf als verboden voorbeeld noemt — kwam er zonder deze regels
  // ongehinderd doorheen. "moet je" (omgekeerde woordvolgorde, "dan moet je…")
  // had hetzelfde gat. Geen stam-substring erbij (zoals "spar"): dit is een
  // spaarapp, en "spaarrekening" zou daarmee zichzelf verbieden.
  //
  // Sectie 4, en dit was tot nu toe het enige verbod in het hele ontwerp zonder
  // test: "rekening-courant" is een boekhoudkundige conclusie over een
  // rechtsverhouding, geen meting, en mag het scherm niet halen. Beide
  // schrijfwijzen, want een streepje minder is geen ander woord.
  "rekening-courant",
  "rekening courant",
];

/** Vindt het verboden woord en NOEMT het, plus waar het stond. De oude vorm
 *  (`expect(html).not.toContain(word)`) drukte de hele gerenderde HTML af als
 *  "Received" en noemde het woord, het scherm noch het bestand. */
function assertGeenVerbodenWoord(text: string, where: string) {
  const lower = text.toLowerCase();
  const hit = FORBIDDEN.find((w) => lower.includes(w));
  expect(
    hit,
    `verboden woord "${hit}" in ${where} — zie sectie 7 van ` +
      "docs/superpowers/specs/2026-08-20-belastingoptimalisatie-design.md: meten of zwijgen. " +
      "Herkomst: apps/web/src/views/Belasting.tsx, apps/web/src/copy/optimise.ts (grens) of packages/core/src/taxpacks/.",
  ).toBeUndefined();
}

/** Elke tak van elke zin die de grensmodule kan tonen. Het type dwingt
 *  volledigheid af: een nieuwe sleutel op `optimiseCopy.nl.grens` zonder regel
 *  hier laat `npm run typecheck` vallen, niet pas een reviewer. */
function buildGrensCopySamples(
  grensCopy: typeof optimiseCopy.nl.grens,
): Record<keyof typeof optimiseCopy.nl.grens, () => string[]> {
  return {
    header: () => [grensCopy.header.title],
    sideFallback: () => [grensCopy.sideFallback.personal, grensCopy.sideFallback.business],
    emptyStates: () => [
      ...grensCopy.emptyStates.geenZakelijkeEntiteit({ unclassified: ["BV1", "Holding"], personal: ["Privé"] }),
      ...grensCopy.emptyStates.geenZakelijkeEntiteit({ unclassified: [], personal: ["Privé"] }),
      ...grensCopy.emptyStates.geenZakelijkeEntiteit({ unclassified: [], personal: [] }),
      ...grensCopy.emptyStates.geenPersoonlijkeEntiteit({ business: ["BV1", "BV2"] }),
      ...grensCopy.emptyStates.geenTransacties({
        business: ["BV1"],
        personal: ["Privé"],
        from: "2026-01-01",
        to: "2026-08-16",
      }),
      ...grensCopy.emptyStates.nietsGekruist({
        from: "2026-01-01",
        to: "2026-08-16",
        obsFrom: "2026-02-01",
        obsTo: "2026-08-01",
      }),
    ],
    // Alle vier de combinaties van de twee blinde vlekken, want dit is de alinea
    // die onder een NUL komt te staan en daar het meeste kan beloven.
    coverage: () => [
      ...grensCopy.coverage({ unknownCounterAccount: 3, ownNameKnown: false }),
      ...grensCopy.coverage({ unknownCounterAccount: 1, ownNameKnown: true }),
      ...grensCopy.coverage({ unknownCounterAccount: 0, ownNameKnown: false }),
      ...grensCopy.coverage({ unknownCounterAccount: 0, ownNameKnown: true }),
    ],
    provenance: () =>
      grensCopy.provenance({
        from: "2026-01-01",
        to: "2026-08-16",
        obsFrom: "2026-02-01",
        obsTo: "2026-08-01",
        pairWindowDays: 4,
      }),
    stream: () => [
      ...grensCopy.stream.heading({
        fromLabel: "BV1",
        toLabel: "Privé",
        count: 7,
        totalCents: 1_240_000,
        matchedCents: 1_050_000,
        unmatchedCents: 190_000,
        knownCents: 430_000,
        unknownCents: 810_000,
      }),
      ...grensCopy.stream.heading({
        fromLabel: "BV1",
        toLabel: "Privé",
        count: 1,
        totalCents: 100_000,
        matchedCents: 100_000,
        unmatchedCents: 0,
        knownCents: 100_000,
        unknownCents: 0,
      }),
      ...grensCopy.stream.heading({
        fromLabel: "BV1",
        toLabel: "Privé",
        count: 2,
        totalCents: 100_000,
        matchedCents: 0,
        unmatchedCents: 100_000,
        knownCents: 0,
        unknownCents: 100_000,
      }),
      ...grensCopy.stream.answer({
        kind: "dividend",
        source: "user",
        at: "2026-08-20",
        count: 6,
        firstDate: "2026-01-10",
        lastDate: "2026-07-02",
      }),
      ...grensCopy.stream.answer({
        kind: "salaris",
        source: "agent",
        at: null,
        count: 1,
        firstDate: "2026-01-10",
        lastDate: "2026-01-10",
      }),
      ...grensCopy.stream.answer({
        kind: "onbekend",
        source: "user",
        at: "2026-08-20",
        count: 3,
        firstDate: "2026-01-10",
        lastDate: "2026-07-02",
      }),
      ...grensCopy.stream.question({
        fromLabel: "BV1",
        toLabel: "Privé",
        unknownCents: 810_000,
        unknownCount: 6,
        lastDate: "2026-07-02",
      }),
      ...grensCopy.stream.question({
        fromLabel: "Privé",
        toLabel: "BV1",
        unknownCents: 5_000,
        unknownCount: 1,
        lastDate: "2026-07-02",
      }),
    ],
    crossing: () => [
      ...grensCopy.crossing.twoLegs({
        amountCents: 430_000,
        date: "2026-03-14",
        fromLabel: "BV1",
        toLabel: "Privé",
        uitLabel: "BV1",
        uitDate: "2026-03-14",
        uitCents: -430_000,
        inLabel: "Privé",
        inDate: "2026-03-15",
        inCents: 430_000,
      }),
      ...grensCopy.crossing.oneLeg({
        amountCents: 190_000,
        date: "2026-05-08",
        fromLabel: "BV1",
        toLabel: "Privé",
        evidence: "eigen-rekening-genoemd",
        uitgaand: true,
      }),
      ...grensCopy.crossing.oneLeg({
        amountCents: 190_000,
        date: "2026-05-08",
        fromLabel: "Privé",
        toLabel: "BV1",
        evidence: "eigen-naam-genoemd",
        uitgaand: false,
      }),
      ...grensCopy.crossing.oneLeg({
        amountCents: 190_000,
        date: "2026-05-08",
        fromLabel: "BV1",
        toLabel: "Privé",
        evidence: "twee-benen",
        uitgaand: true,
      }),
      ...grensCopy.crossing.moreRows({ hidden: 4, shown: 8, count: 12 }),
    ],
    excluded: () => [
      ...grensCopy.excluded({
        noAccount: 3,
        noEntity: 2,
        currencyMismatch: 1,
        mirrorSuppressed: 1,
      }),
      ...grensCopy.excluded({
        noAccount: 1,
        noEntity: 1,
        currencyMismatch: 2,
        mirrorSuppressed: 2,
      }),
      ...grensCopy.excluded({
        noAccount: 0,
        noEntity: 0,
        currencyMismatch: 0,
        mirrorSuppressed: 0,
      }),
    ],
    betweenBusiness: () => grensCopy.betweenBusiness({ business: ["BV1", "BV2"] }),
    byproduct: () => [
      grensCopy.byproduct.heading,
      ...grensCopy.byproduct.summary({ rows: 5 }),
      ...grensCopy.byproduct.summary({ rows: 1 }),
      ...grensCopy.byproduct.summary({ rows: 0 }),
      ...grensCopy.byproduct.row({
        label: "Coolblue",
        personalCount: 3,
        personalCents: 64_000,
        businessCount: 1,
        businessCents: 31_000,
        firstDate: "2026-02-01",
        lastDate: "2026-07-20",
      }),
    ],
    // De uitleg, de bevestiging en de tabelkoppen van de "review"-fase (zie
    // `phase === "review"` in Grens.tsx) — die fase rendert `renderToStaticMarkup`
    // nooit, dus dit is de enige plek die haar tekst alsnog aan de
    // verbodenwoordenscan onderwerpt.
    answerForm: () => [
      ...grensCopy.answerForm.explanation({ streams: 2 }),
      ...grensCopy.answerForm.explanation({ streams: 1 }),
      ...grensCopy.answerForm.savedNote({ saved: 2 }),
      ...grensCopy.answerForm.savedNote({ saved: 1 }),
      ...grensCopy.answerForm.savedNote({ saved: 0 }),
      grensCopy.answerForm.reviewButtonLabel(2),
      grensCopy.answerForm.reviewButtonLabel(1),
      grensCopy.answerForm.toonMeerSummary,
      grensCopy.answerForm.ariaWhatWas("BV1 → Privé"),
      ...Object.values(grensCopy.answerForm.table),
    ],
    footer: () => grensCopy.footer,
    labels: () => [
      ...Object.values(grensCopy.labels.kind),
      ...Object.values(grensCopy.labels.source),
      ...Object.values(grensCopy.labels.evidenceReason),
    ],
  };
}
const GRENS_COPY_SAMPLES = buildGrensCopySamples(optimiseCopy.nl.grens);

/** Alle acht `VatNote`-takken, met een positie die de tellingen in de zinnen
 *  invult. Twee ervan waren met een fixture nooit te bereiken. */
const ALL_VAT_NOTES: VatNote[] = [
  "gemengde-tarieven",
  "stelsel-onbekend",
  "kasstelsel",
  "btw-onbekend-op-facturen",
  "omzetfacturen-onbekend",
  "voorbelasting-onbekend",
  "boekhouding-andere-periode",
  "geen-banktransacties",
];

test("the copy stays on the measuring side of the line", () => {
  const invoices = [invoice(), invoice({ direction: "out", amount: 484, vatAmount: 84 })];

  // ── (a) gerenderde schermen. Elk scherm zet ZIJN EIGEN land: in de vorige
  //    versie stond `setHomeCountry("DE")` midden in de lijst en muteerde die
  //    gedeelde localStorage, zodat een later toegevoegd scherm stilzwijgend als
  //    DE gerenderd werd en zijn label loog.
  const screens: { name: string; html: string }[] = [];
  const screen = (name: string, country: "NL" | "DE", make: () => string) => {
    setHomeCountry(country);
    screens.push({ name, html: make() });
  };

  screen("NL · btw met facturen, stelsel onbekend", "NL", () =>
    render([tx("t1", "2026-07-10", 12_100)], ["BV1"], { invoices }),
  );
  screen("NL · kwartaal met alleen kosten (terug te vragen)", "NL", () =>
    render([tx("t1", "2026-08-01", -5_000)]),
  );
  screen("NL · geen transacties in het tijdvak", "NL", () => render([]));
  screen("NL · gemengde tarieven", "NL", () =>
    render([tx("t1", "2026-07-10", 12_100)], ["BV1"], {
      vatSettings: [
        { entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: true },
      ],
    }),
  );
  screen("NL · kasstelsel", "NL", () =>
    render([tx("t1", "2026-07-10", 12_100)], ["BV1"], {
      invoices,
      vatSettings: [
        {
          entity: "BV1",
          frequency: "quarterly",
          defaultRatePct: 21,
          mixedRates: false,
          vatBasis: "kasstelsel",
        },
      ],
    }),
  );
  screen("NL · zonder entiteiten", "NL", () => render([], []));

  // De vier toestanden van de grensmodule.
  screen("grens · niets als zakelijk gemarkeerd", "NL", () =>
    render([tx("t1", "2026-03-14", -4_300)]),
  );
  screen("grens · alles zakelijk, geen privékant", "NL", () =>
    render([tx("t1", "2026-03-14", -4_300)], ["BV1"], {
      entityProfiles: [{ entity: "BV1", scope: "business" }],
    }),
  );
  screen("grens · ingedeeld, geen transacties", "NL", () =>
    render([], ["BV1"], {
      allAccounts: GRENS_ACCOUNTS,
      allTxs: [],
      entityProfiles: GRENS_PROFILES,
    }),
  );
  screen("grens · gemeten: gekoppeld, één been, bijproduct", "NL", () =>
    render([], ["BV1"], {
      allAccounts: GRENS_ACCOUNTS,
      allTxs: GRENS_TXS,
      entityProfiles: GRENS_PROFILES,
    }),
  );

  screen("DE · vooruitbetalingen", "DE", () => render([tx("t1", "2026-02-01", 100_000)]));

  for (const { name, html } of screens) assertGeenVerbodenWoord(html, `het scherm "${name}"`);

  // ── (b) de geëxporteerde copy, inclusief takken die geen fixture rendert.
  for (const [key, make] of Object.entries(GRENS_COPY_SAMPLES)) {
    for (const zin of make())
      assertGeenVerbodenWoord(zin, `optimiseCopy.nl.grens.${key} (apps/web/src/copy/optimise.ts)`);
  }

  const positie: VatPosition = vatPosition({
    txs: [],
    asOf: "2026-08-16",
    settings: { entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false },
  });
  for (const note of ALL_VAT_NOTES) {
    assertGeenVerbodenWoord(
      noteText(note, { ...positie, coverage: { ...positie.coverage, total: 3, withVat: 1 } }, "nl"),
      `noteText("${note}")`,
    );
    assertGeenVerbodenWoord(
      noteText(note, { ...positie, coverage: { ...positie.coverage, total: 1, withVat: 0 } }, "nl"),
      `noteText("${note}", enkelvoud)`,
    );
  }

  // ── (c) de caveats komen nu uit copy/admin.ts (zie header.caveatsByCountry),
  //    niet meer rechtstreeks uit de pack — dat is precies wat dit scherm
  //    rendert, dus die toets hoort hierbij.
  for (const land of ["NL", "DE"] as const) {
    for (const cav of adminCopy.nl.belasting.header.caveatsByCountry[land])
      assertGeenVerbodenWoord(cav, `adminCopy.nl.belasting.header.caveatsByCountry.${land}`);
  }
});

/* ── DE ENGELSE WOORDTEST ──────────────────────────────────────────────────
 * Mirrors the Dutch scan above for the design partner's language: section 7's
 * meet-or-stay-silent rule is a regulatory line, not a Dutch-only style rule. */
const EN_FORBIDDEN = [
  "advice",
  "advise",
  "advised",
  "advises",
  "advisable",
  "we recommend",
  "we advise",
  "you should",
  "you must",
  "recommended",
  "optimal",
  "optimally",
  "optimize",
  "optimise",
  "you'd save",
  "you would save",
  "you could save",
  "you'll save",
  "in savings",
  "tax savings",
  "potential savings",
  "savings of",
  "tax benefit",
  "tax benefits",
  "tax advantage",
  "tax advantages",
  "current account",
];

function assertNoForbiddenWord(text: string, where: string, forbidden: readonly string[]) {
  const lower = text.toLowerCase();
  const hit = forbidden.find((w) => lower.includes(w));
  expect(
    hit,
    `forbidden word "${hit}" in ${where} — see section 7 of ` +
      "docs/superpowers/specs/2026-08-20-belastingoptimalisatie-design.md: measure or stay silent.",
  ).toBeUndefined();
}

test("the English copy stays on the measuring side of the line too", () => {
  document.cookie = "lavega_locale=en; Path=/";
  const invoices = [invoice(), invoice({ direction: "out", amount: 484, vatAmount: 84 })];

  const screens: { name: string; html: string }[] = [];
  const screen = (name: string, country: "NL" | "DE", make: () => string) => {
    setHomeCountry(country);
    screens.push({ name, html: make() });
  };

  screen("NL · VAT with invoices, basis unknown", "NL", () =>
    render([tx("t1", "2026-07-10", 12_100)], ["BV1"], { invoices }),
  );
  screen("NL · quarter with only costs (to reclaim)", "NL", () =>
    render([tx("t1", "2026-08-01", -5_000)]),
  );
  screen("NL · no transactions in the period", "NL", () => render([]));
  screen("NL · mixed rates", "NL", () =>
    render([tx("t1", "2026-07-10", 12_100)], ["BV1"], {
      vatSettings: [{ entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: true }],
    }),
  );
  screen("NL · cash basis", "NL", () =>
    render([tx("t1", "2026-07-10", 12_100)], ["BV1"], {
      invoices,
      vatSettings: [
        {
          entity: "BV1",
          frequency: "quarterly",
          defaultRatePct: 21,
          mixedRates: false,
          vatBasis: "kasstelsel",
        },
      ],
    }),
  );
  screen("NL · no entities", "NL", () => render([], []));
  screen("DE · prepayments", "DE", () => render([tx("t1", "2026-02-01", 100_000)]));

  for (const { name, html } of screens)
    assertNoForbiddenWord(html, `screen "${name}"`, EN_FORBIDDEN);

  const enGrensCopy = optimiseCopy.en.grens;
  const enGrensSamples = buildGrensCopySamples(enGrensCopy);
  for (const [key, make] of Object.entries(enGrensSamples)) {
    for (const zin of make())
      assertNoForbiddenWord(zin, `optimiseCopy.en.grens.${key}`, EN_FORBIDDEN);
  }

  const positie: VatPosition = vatPosition({
    txs: [],
    asOf: "2026-08-16",
    settings: { entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false },
  });
  for (const note of ALL_VAT_NOTES) {
    assertNoForbiddenWord(
      noteText(note, { ...positie, coverage: { ...positie.coverage, total: 3, withVat: 1 } }, "en"),
      `noteText("${note}", en)`,
      EN_FORBIDDEN,
    );
    assertNoForbiddenWord(
      noteText(note, { ...positie, coverage: { ...positie.coverage, total: 1, withVat: 0 } }, "en"),
      `noteText("${note}", en, singular)`,
      EN_FORBIDDEN,
    );
  }

  for (const land of ["NL", "DE"] as const) {
    for (const cav of adminCopy.en.belasting.header.caveatsByCountry[land])
      assertNoForbiddenWord(cav, `adminCopy.en.belasting.header.caveatsByCountry.${land}`, EN_FORBIDDEN);
  }
});

test("with no entities it asks for accounts instead of inventing one", () => {
  const html = render([], []);
  expect(html).toContain("Nog geen entiteiten");
  expect(html).not.toContain("module-title");
});

test("switches to English copy when the locale cookie says en, including a VAT note and the tax figure", () => {
  document.cookie = "lavega_locale=en; Path=/";
  const en = adminCopy.en.belasting;

  const invoices = [
    invoice(),
    invoice({ direction: "out", counterparty: "Supplier", amount: 484, vatAmount: 84 }),
  ];
  const vatSettings: VatSettings[] = [
    {
      entity: "BV1",
      frequency: "quarterly",
      defaultRatePct: 21,
      mixedRates: false,
      vatBasis: "factuurstelsel",
    },
  ];
  const html = render([], ["BV1"], { invoices, vatSettings });

  expect(html).toContain(en.header.title);
  expect(html).toContain(en.actions.saveButton.replace("&", "&amp;"));
  expect(html).toContain(en.vat.fields.frequencyLabel);
  expect(html).toContain(en.vat.basisLabels.invoices);
  expect(html).toContain(en.vat.coverageLine({ withVat: 2, total: 2 }));
  expect(html).toContain(en.vat.directionLabels.betalen);
  expect(html).toContain(formatEuroIn("en", 126));

  const positie: VatPosition = vatPosition({
    txs: [],
    asOf: "2026-08-16",
    settings: { entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false },
  });
  expect(
    noteText(
      "stelsel-onbekend",
      { ...positie, coverage: { ...positie.coverage, total: 3, withVat: 1 } },
      "en",
    ),
  ).toBe(en.vat.notes["stelsel-onbekend"]({ total: 3, missing: 2 }));
});
