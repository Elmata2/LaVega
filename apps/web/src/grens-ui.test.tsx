// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Account, EntityProfile, Tx, VatSettings } from "@lavega/core";
import Belasting from "./views/Belasting";

/* ── DE GRENS TUSSEN PRIVÉ EN ZAKELIJK, op zijn scherm ─────────────────────
 *
 * Wat hier getest wordt is niet de meting — die staat in
 * packages/core/src/crossScope.test.ts — maar de drie dingen die alleen op dit
 * niveau fout kunnen gaan:
 *
 *  1. DE LIJSTEN. De module krijgt met opzet de ONGESCOPEERDE lijsten. Gevoed
 *     met de gescopeerde ziet ze vanuit één helft de tegenboeking nooit, en het
 *     resultaat is dan niet leeg maar FOUT — elke kruising ongekoppeld, het
 *     totaal gehalveerd of verdubbeld, met een geloofwaardig scherm eromheen.
 *     Het type vangt die vergissing niet (beide props zijn `Tx[]`), dus een
 *     test moet het doen.
 *  2. DE OPSLAGVAL. Een antwoord gaat over een paar dat de twee helften
 *     doorkruist, dus de onderneming waar het op bewaard wordt staat vaak NIET
 *     in de ondernemingen-in-beeld. "Bereken & bewaar" bouwt alleen die in
 *     beeld opnieuw op. Zou het antwoord daarop meeliften, dan verdween het
 *     stilzwijgend en bleef de module dezelfde vraag stellen — voor altijd.
 *  3. BEVESTIGEN-EERST. Er wordt niets bewaard zonder een klik van hem.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASOF = "2026-08-16";

/* Voluit geschreven IBANs: `ownAccounts` telt alleen waarden van 8 tekens of
 * langer met een cijfer als eigen kenmerk, zodat een generieke naam als
 * "Betaalrekening" nooit per ongeluk op een omschrijving matcht. */
const ACCOUNTS: Account[] = [
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
/** Alleen BV1 is ingedeeld; "Privé" is privé via de harde standaard van
 *  entities.ts, precies zoals in een vault waarin hij één keuze maakte. */
const PROFILES: EntityProfile[] = [{ entity: "BV1", scope: "business" }];

function gtx(o: Partial<Tx> & Pick<Tx, "id" | "accountKey" | "date" | "amount">): Tx {
  return { currency: "EUR", counterparty: "", description: "", category: "", manual: false, ...o };
}

const TXS: Tx[] = [
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
  gtx({
    id: "x3",
    accountKey: "A1",
    date: "2026-05-08",
    amount: -1_900,
    counterparty: "Privé",
    description: "NL02INGB0007654321 aanvulling",
  }),
  gtx({ id: "x4", accountKey: "P1", date: "2026-02-01", amount: -640, counterparty: "Coolblue" }),
  gtx({ id: "x5", accountKey: "A1", date: "2026-07-20", amount: -310, counterparty: "Coolblue" }),
  gtx({ id: "x6", accountKey: "GONE", date: "2026-04-01", amount: -50, counterparty: "Onbekend" }),
  // ZIJN EIGEN GELD, aan allebei de kanten en met dezelfde naam erop. Zonder de
  // uitsluitingen in core zou hij hier als zijn eigen grootste "leverancier"
  // bovenaan de bijproductlijst staan. Twee afschrijvingen, dus geen kruising.
  gtx({
    id: "x7",
    accountKey: "P1",
    date: "2026-04-10",
    amount: -2_000,
    counterparty: "A Steunenberg",
    category: "Eigen overboeking",
    manual: true,
  }),
  gtx({
    id: "x8",
    accountKey: "A1",
    date: "2026-06-10",
    amount: -3_000,
    counterparty: "A Steunenberg",
    category: "Eigen overboeking",
    manual: true,
  }),
];

type Opts = {
  entities?: string[];
  allAccounts?: Account[];
  allTxs?: Tx[];
  entityProfiles?: EntityProfile[];
  vatSettings?: VatSettings[];
};

function markup(opts: Opts = {}) {
  return renderToStaticMarkup(
    <Belasting
      entities={opts.entities ?? ["BV1"]}
      txs={[]}
      accounts={ACCOUNTS}
      asOf={ASOF}
      vatSettings={opts.vatSettings ?? []}
      scheduledFlows={[]}
      allAccounts={opts.allAccounts ?? ACCOUNTS}
      allTxs={opts.allTxs ?? TXS}
      entityProfiles={opts.entityProfiles ?? PROFILES}
      busy={false}
      onSaveVatSettings={() => {}}
      onSaveScheduledFlows={() => {}}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});

/* ── Wat er op het scherm komt ─────────────────────────────────────────────*/

test("een gekoppelde overboeking noemt allebei de transacties waar het bedrag uit komt", () => {
  const html = markup();

  // De rolop van de stroom: het totaal is 4.300 + 1.900, en de twee sterktes
  // van bewijs staan apart — ze worden nooit tot één claim samengetrokken.
  expect(html).toContain("ging van BV1 naar Privé");
  expect(html).toContain("6.200,00");
  expect(html).toContain("4.300,00");
  expect(html).toContain("1.900,00");
  expect(html).toContain("maar één kant");

  // Herkomst: allebei de benen, met hun eigen rekening en hun eigen datum.
  expect(html).toContain("Beide kanten staan in je vault");
  expect(html).toContain("2026-03-14");
  expect(html).toContain("2026-03-15");

  // Het venster waarover gemeten is, en wat er in dat venster aan data stond.
  expect(html).toContain("Gemeten in je transacties van 2026-01-01 t/m 2026-08-16");
  // Het aantal dagen komt uit core en staat niet als los "4" in de view.
  expect(html).toContain("0 tot 4 dagen na de afschrijving");

  // De vraag, want niemand heeft gezegd wat dit was.
  expect(html).toContain("LaVega ziet niet wat deze overboekingen waren. Wat was dit?");
});

test("een rij met één been zegt waarom hij meetelt, en dat hij één keer meetelt", () => {
  const html = markup();
  expect(html).toContain("LaVega ziet geen tegenboeking in je vault");
  expect(html).toContain("een andere rekening van jezelf op staat");
  expect(html).toContain("telt één keer mee in het totaal hierboven");
  expect(html).toContain("Waar kwam dit terecht?");
});

test("wat buiten de meting viel wordt geteld, niet weggelaten", () => {
  // x6 staat op een accountKey die in geen enkele Account voorkomt. Core telt
  // die als `unseen.noAccount` in plaats van hem via de harde privé-standaard
  // aan een kant toe te wijzen; het scherm moet dat doorgeven, anders staat er
  // een totaal zonder zijn eigen uitzonderingen.
  const html = markup();
  expect(html).toContain("op een rekening die niet in je vault staat");
});

test("het bijproduct noemt een tegenpartij aan beide kanten en zegt niets over aftrekbaarheid", () => {
  const html = markup();
  expect(html).toContain("Coolblue");
  expect(html).toContain("zowel een privérekening als een zakelijke rekening");
  expect(html).toContain("het zegt niets over aftrekbaarheid");
  expect(html).toContain("Horen die privébetalingen bij je onderneming?");
  // Richting C is hier niet binnengeslopen: geen aftrek, geen btw-teruggaaf,
  // geen euro die hij zou kunnen terugvragen.
  expect(html.toLowerCase()).not.toContain("aftrekbaar zijn");
  expect(html.toLowerCase()).not.toContain("terugvragen van deze");
});

test("zijn eigen overboekingen zijn geen tegenpartij van zichzelf in het bijproduct", () => {
  // x1/x2/x3 noemen zijn eigen rekening; die mogen niet als "leverancier Privé"
  // in de bijproductlijst belanden, anders staat hij bovenaan zijn eigen lijst.
  const html = markup();
  const bijproduct = html.slice(html.indexOf('data-testid="grens-bijproduct"'));
  // Precies één tegenpartij op de lijst, en dat is Coolblue. "Privé" en "BV1"
  // staan als tegenpartij op zijn eigen overboekingen (x1/x2/x3) en zouden
  // zonder de uitsluiting in core bovenaan zijn eigen kostenlijst komen.
  const rijen = [...bijproduct.matchAll(/Horen die privébetalingen/g)];
  expect(rijen).toHaveLength(1);
  expect(bijproduct).toContain("Coolblue: 1 betaling");
  // x7 en x8 staan met dezelfde naam aan allebei de kanten van de grens en zijn
  // allebei door hem als "Eigen overboeking" gemerkt. Zonder de uitsluiting in
  // core zou hij hier zijn eigen grootste leverancier zijn.
  expect(bijproduct).not.toContain("A Steunenberg");
});

/* ── De lijsten: dit is de vergissing die het type niet vangt ──────────────*/

test("met de GESCOPEERDE lijsten ziet de module maar één kant — daarom krijgt ze de volledige", () => {
  // Sta in Zakelijk: dan zijn alleen de zakelijke rekening en haar transacties
  // in beeld. Zo gevoed vindt de module geen privékant en zegt ze dat ook, in
  // plaats van een gehalveerd totaal te tonen.
  const zakelijkeAccounts = ACCOUNTS.filter((a) => a.entity === "BV1");
  const zakelijkeTxs = TXS.filter((t) => t.accountKey === "A1");
  const fout = markup({ allAccounts: zakelijkeAccounts, allTxs: zakelijkeTxs });
  expect(fout).toContain('data-testid="grens-geen-persoonlijke-entiteit"');
  expect(fout).not.toContain("ging van BV1 naar Privé");

  // En met de volledige lijsten is dezelfde vault wél te meten.
  expect(markup()).toContain("ging van BV1 naar Privé");
});

test("ingedeeld maar geen transacties is geen nul", () => {
  const html = markup({ allTxs: [] });
  expect(html).toContain('data-testid="grens-geen-transacties"');
  expect(html).toContain("Dat is geen nul — er is niets om te meten.");
  expect(html).not.toContain("€&nbsp;0,00");
});

test("gemeten en niets over de grens is de enige nul die deze module uitspreekt, en hij zegt waaruit hij volgt", () => {
  // Alleen de twee Coolblue-rijen: allebei afschrijvingen, dus ze kunnen elkaars
  // tegenboeking niet zijn en er steekt niets over.
  const html = markup({ allTxs: TXS.filter((t) => t.counterparty === "Coolblue") });
  expect(html).toContain('data-testid="grens-niets-gekruist"');
  // "VOND LaVega geen overboeking", niet "er STAAT er geen in je vault": het
  // tweede is een uitspraak over zijn vault en die kan deze meting niet doen.
  // Zie de test hieronder voor het bedrag dat achter dat verschil zat.
  expect(html).toContain(
    "vond LaVega geen overboeking die de grens tussen zakelijk en privé oversteekt",
  );
  expect(html).not.toContain("er geen gevonden");
  expect(html).toContain("Dit is wél gemeten");
  // De nul staat nooit alleen: eronder staat waar deze meting blind is.
  expect(html).toContain("LaVega herkent een overboeking naar jezelf aan één van drie dingen");
  // Het bijproduct staat er nog steeds: een tegenpartij aan beide kanten heeft
  // geen kruising nodig.
  expect(html).toContain("Coolblue");
});

test("een afboeking naar een rekening die niet in je vault staat, wordt onder de nul GETELD", () => {
  /* DE STILLE NUL. Zijn Rabobank-privérekening is nooit geïmporteerd, dus deze
   * € 12.400 draagt geen enkel bewijs en wordt — terecht — geen kruising. Wat
   * er fout was: hij werd nergens geteld, en het scherm zei daarna dat er
   * gemeten was en niets gekruist. Nu telt core hem (`unknownCounterAccount`)
   * en zegt het scherm wat het niet kon zien.
   *
   * De regel zelf blijft buiten het totaal: LaVega weet niet van wie
   * NL77RABO0123456789 is, en een bedrag noemen zou suggereren dat het naar hem
   * ging. Vandaar een AANTAL onder de nul, en geen euro erbij. */
  const html = markup({
    allTxs: [
      gtx({
        id: "z1",
        accountKey: "A1",
        date: "2026-02-05",
        amount: -12_400,
        description: "SEPA Overboeking NL77RABO0123456789",
      }),
    ],
  });
  expect(html).toContain('data-testid="grens-niets-gekruist"');
  expect(html).toContain(
    "Op 1 afschrijving van een zakelijke rekening staat een rekeningnummer dat in geen enkele rekening van je vault voorkomt",
  );
  expect(html).toContain("die rij telt hier niet mee");
  // Geen bedrag bij de blinde vlek: niet in euro's en niet als nul.
  expect(html).not.toContain("12.400");
  expect(html).not.toContain("€&nbsp;0,00");
  // En de oude volledigheidsclaim is weg: LaVega kon deze rij wél op BV1
  // plaatsen, maar niet zien waar het geld heen ging.
  expect(html).not.toContain("kon LaVega op een onderneming plaatsen");
});

test("zonder zijn naam in het profiel zegt het scherm dat die derde herkenning ontbreekt", () => {
  // `Belasting` krijgt in deze fixtures geen ownNames mee, dus core meet met een
  // van zijn drie herkenningen uit — precies de helft van het bewijs die in de
  // audit ontbrak. Dat mag niet stil zijn.
  const html = markup();
  expect(html).toContain("Je eigen naam staat niet in je profiel");
  expect(html).toContain("herkent LaVega daardoor niet als kruising");
});

/* ── Bevestigen-eerst en de opslagval ──────────────────────────────────────*/

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Wat App.tsx is: hij houdt de instellingen vast en geeft de nieuwe lijst
 *  meteen weer naar beneden. Zonder die lus test je een scherm dat zijn eigen
 *  antwoord nooit terugziet. */
const savedBox: { current: VatSettings[] } = { current: [] };
function Host({
  entities,
  initial,
  accounts,
}: {
  entities: string[];
  initial: VatSettings[];
  accounts: Account[];
}) {
  const [vatSettings, setVatSettings] = useState<VatSettings[]>(initial);
  useEffect(() => {
    savedBox.current = vatSettings;
  }, [vatSettings]);
  return (
    <Belasting
      entities={entities}
      txs={[]}
      accounts={accounts}
      asOf={ASOF}
      vatSettings={vatSettings}
      scheduledFlows={[]}
      allAccounts={accounts}
      allTxs={TXS}
      entityProfiles={PROFILES}
      busy={false}
      onSaveVatSettings={setVatSettings}
      onSaveScheduledFlows={() => {}}
    />
  );
}

function render(entities: string[], opts: { initial?: VatSettings[]; accounts?: Account[] } = {}) {
  savedBox.current = opts.initial ?? [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <Host
        entities={entities}
        initial={opts.initial ?? []}
        accounts={opts.accounts ?? ACCOUNTS}
      />,
    ),
  );
  return container;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const byText = (text: string) =>
  [...container!.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    (b.textContent ?? "").includes(text),
  );
const streamSelect = () =>
  container!.querySelector<HTMLSelectElement>('select[aria-label^="Wat was "]');
const answersOf = (entity: string) =>
  savedBox.current.find((s) => s.entity === entity)?.crossScopeAnswers ?? [];

test("de vraag wordt per STROOM gesteld, één keer, en niet per overboeking", () => {
  render(["BV1"]);
  // Twee kruisingen (een gekoppelde en een met één been), één stroom.
  expect(byText("Beantwoord 1 stroom")).toBeTruthy();
  click(byText("Beantwoord 1 stroom")!);
  expect(container!.querySelectorAll('select[aria-label^="Wat was "]')).toHaveLength(1);
});

test("er wordt niets bewaard zonder zijn bevestiging", () => {
  render(["BV1"]);
  click(byText("Beantwoord 1 stroom")!);

  // Alleen het keuzemenu aanraken schrijft niets weg.
  type(streamSelect()!, "dividend");
  expect(savedBox.current).toEqual([]);

  // En annuleren gooit het concept weg in plaats van het te bewaren.
  click(byText("Annuleer")!);
  expect(savedBox.current).toEqual([]);
  click(byText("Beantwoord 1 stroom")!);
  expect(streamSelect()!.value).toBe("");

  // "Bewaar antwoorden" zonder ingevuld antwoord bewaart ook niets, en zegt dat.
  click(byText("Bewaar antwoorden")!);
  expect(savedBox.current).toEqual([]);
  expect(container!.textContent).toContain("Niets bewaard");
});

test("zijn antwoord wordt een bewaard feit op de ZAKELIJKE onderneming, en de vraag stopt", () => {
  render(["BV1"]);
  click(byText("Beantwoord 1 stroom")!);
  type(streamSelect()!, "dividend");
  click(byText("Bewaar antwoorden")!);

  const answers = answersOf("BV1");
  expect(answers).toHaveLength(1);
  expect(answers[0].kind).toBe("dividend");
  expect(answers[0].source).toBe("user"); // een feit van hem, niet van een agent
  expect(answers[0].updatedAt).toBe(ASOF);
  // Op de zakelijke kant bewaard: bij elke kruising is precies één kant
  // zakelijk, dus die keuze is eenduidig en overleeft de privékant.
  expect(savedBox.current.map((s) => s.entity)).toEqual(["BV1"]);

  // Het scherm geeft zijn antwoord terug, met de dekking erbij — een antwoord
  // per stroom spreekt ook voor de latere overboekingen van die stroom.
  expect(container!.textContent).toContain("Jij noemde deze stroom “dividend” op 2026-08-16");
  expect(container!.textContent).toContain("Dat antwoord staat bij alle 2 overboekingen");
  // en er wordt niet nog een keer naar gevraagd.
  expect(byText("Beantwoord 1 stroom")).toBeFalsy();
  expect(container!.textContent).not.toContain("Wat was dit?");
});

test("“weet ik niet” is een antwoord: het wordt bewaard en er wordt niet meer naar gevraagd", () => {
  render(["BV1"]);
  click(byText("Beantwoord 1 stroom")!);
  type(streamSelect()!, "onbekend");
  click(byText("Bewaar antwoorden")!);

  expect(answersOf("BV1")).toHaveLength(1);
  expect(answersOf("BV1")[0].kind).toBe("onbekend");
  expect(byText("Beantwoord 1 stroom")).toBeFalsy();
});

/* DE OPSLAGVAL, in twee vormen. Allebei zijn stil: het antwoord verdwijnt en de
 * module vraagt het opnieuw, zonder foutmelding. */

test("een antwoord over een stroom overleeft “Bereken & bewaar” terwijl de onderneming NIET in beeld is", () => {
  // Hij staat in Persoonlijk: "Privé" is de onderneming in beeld, BV1 niet.
  // `berekenEnBewaar` bouwt alleen de instellingen van de ondernemingen in
  // beeld opnieuw op — dus als het antwoord op die knop had meegelift, was het
  // hier weg geweest.
  render(["Privé"]);
  click(byText("Beantwoord 1 stroom")!);
  type(streamSelect()!, "salaris");
  click(byText("Bewaar antwoorden")!);
  expect(answersOf("BV1")).toHaveLength(1);

  click(byText("Bereken & bewaar")!);
  expect(answersOf("BV1")).toHaveLength(1);
  expect(answersOf("BV1")[0].kind).toBe("salaris");
  // en de onderneming in beeld heeft nu ook een rij, zonder de antwoorden op te eten
  expect(savedBox.current.map((s) => s.entity).sort()).toEqual(["BV1", "Privé"]);
});

test("een antwoord overleeft “Bereken & bewaar” ook als er al een onbewaarde bewerking van dezelfde onderneming lag", () => {
  // De stille variant: hij zette eerst de frequentie om (dat maakt een concept
  // voor BV1), antwoordde daarna, en drukte toen pas op de knop. `resolve()`
  // geeft het concept voorrang op wat er bewaard staat, dus zonder de
  // concept-stap in `bewaarGrensAntwoorden` overschreef die knop het antwoord
  // met een concept van vóór het antwoord.
  render(["BV1"]);
  type(
    container!.querySelector<HTMLSelectElement>('select[aria-label="BTW-frequentie BV1"]')!,
    "monthly",
  );

  click(byText("Beantwoord 1 stroom")!);
  type(streamSelect()!, "dividend");
  click(byText("Bewaar antwoorden")!);
  expect(answersOf("BV1")).toHaveLength(1);

  click(byText("Bereken & bewaar")!);
  expect(savedBox.current.find((s) => s.entity === "BV1")?.frequency).toBe("monthly"); // zijn bewerking staat er nog
  expect(answersOf("BV1")).toHaveLength(1); // en zijn antwoord ook
  expect(answersOf("BV1")[0].kind).toBe("dividend");
});

test("een naam met een spatie erachter maakt geen tweede instellingenrij", () => {
  // Core geeft de ondernemingsnaam GETRIMD terug (`account.entity.trim()`),
  // terwijl `entityOptionsFor` in apps/web/src/scope.ts dat niet doet. Een
  // import die "BV1 " schreef zou dus een tweede rij naast "BV1" krijgen, en
  // dan staat zijn btw-instelling op de ene rij en zijn antwoord op de andere.
  const metSpatie = ACCOUNTS.map((a) => (a.entity === "BV1" ? { ...a, entity: "BV1 " } : a));
  render(["BV1 "], {
    accounts: metSpatie,
    initial: [{ entity: "BV1 ", frequency: "quarterly", defaultRatePct: 21, mixedRates: false }],
  });

  click(byText("Beantwoord 1 stroom")!);
  type(streamSelect()!, "dividend");
  click(byText("Bewaar antwoorden")!);

  expect(savedBox.current).toHaveLength(1);
  expect(savedBox.current[0].entity).toBe("BV1 ");
  expect(savedBox.current[0].crossScopeAnswers).toHaveLength(1);
  expect(savedBox.current[0].defaultRatePct).toBe(21); // zijn bestaande instelling staat er nog
});
