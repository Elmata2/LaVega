// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, LearnedFact } from "@lavega/core";
import { entitySummaries, factId, TRAVEL_AGENT } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import Profiel from "./Profiel";
import { WIDGETS, enabledModules } from "../components/moduleRegistry";
import { COUNTRY_CODES } from "../countries";
import { getHomeCountry } from "../settings";

/* Regels, Koppelingen, Back-up and Import were never workspaces — they are
 * settings, and they now live in the profile. These prove they are really
 * THERE (the same components, rendered on this page), that the country the tax
 * rules read is editable here, and that Vergrendelen is reachable. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Wat de kluis in deze tests doet. Back-up raakt hem pas bij een klik, maar de
 *  cashbackmodule LEEST hem bij het openen van de pagina — vandaar de drie
 *  echte methoden. `putFacts` schrijft naar dezelfde array die `getFacts`
 *  teruggaf, zodat een test kan zien wat er is opgeslagen in plaats van alleen
 *  dat er iets is opgeslagen. */
function fakeStorage(accounts: Account[] = [], facts: LearnedFact[] = []) {
  const stored = { facts: [...facts] };
  return {
    storage: {
      export: () => null,
      restore: async () => false,
      getAccounts: async () => accounts,
      getFacts: async () => stored.facts,
      putFacts: async (f: LearnedFact[]) => {
        stored.facts = [...f];
      },
    } as unknown as VaultStorage,
    stored,
  };
}

const storage = fakeStorage().storage;

async function render(overrides: Partial<Parameters<typeof Profiel>[0]> = {}) {
  const props: Parameters<typeof Profiel>[0] = {
    enabledModules: enabledModules(null),
    onModulesChange: () => {},
    focusModules: 0,
    entities: entitySummaries(
      [
        { key: "prive", entity: "Privé" } as Account,
        { key: "bv1", entity: "BV1 Holding" } as Account,
      ],
      [],
    ),
    onClassifyEntity: () => {},
    homeCountry: "NL",
    onHomeCountryChange: () => {},
    homeRegion: "",
    onHomeRegionChange: () => {},
    ownerName: { first: "", last: "" },
    onOwnerNameChange: () => {},
    onLock: () => {},
    entity: "Persoonlijk",
    onEntityChange: () => {},
    busy: false,
    problems: [],
    onImport: () => {},
    rules: [{ id: "r1", match: "albert heijn", category: "Boodschappen" }],
    ruleMatch: "",
    onRuleMatchChange: () => {},
    ruleCategory: "",
    onRuleCategoryChange: () => {},
    onSaveRules: () => {},
    storage,
    asOf: "2026-08-16",
    onRestored: () => {},
    ...overrides,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Profiel {...props} />));
  // De cashbackmodule leest rekeningen en feiten uit de kluis in een effect. Die
  // belofte landt een tick later, dus zonder deze flush gebeurt de state-update
  // buiten act() en klaagt React daar in élke test op deze pagina over — een
  // waarschuwing die niets met de test te maken heeft en die je daarna negeert,
  // wat precies de manier is waarop een echte waarschuwing wordt gemist.
  await act(async () => {});
  return container;
}

/** React tracks an input's value, so a bare `el.value = x` is invisible to it —
 *  the native setter has to be used or onChange never fires. */
function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function section(label: string): HTMLElement {
  const el = container!.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`no section labelled "${label}"`);
  return el as HTMLElement;
}

test("Regels, Koppelingen, Back-up and Import all render inside the profile", async () => {
  await render();
  expect(section("Regels").textContent).toContain("albert heijn");
  // Koppelingen has no aria-label wrapper of its own; its fields identify it.
  expect(container!.querySelector('[aria-label="n8n webhook-URL"]')).not.toBeNull();
  expect(section("Importeren").querySelector('input[type="file"]')).not.toBeNull();
  expect(container!.textContent).toContain("Back-up");
});

test("the module picker is on the profile, with Overzicht locked on", async () => {
  await render();
  const picker = section("Modules");
  expect(picker.querySelectorAll(".mp-item").length).toBeGreaterThan(1);
  const home = picker.querySelector('[aria-label="Overzicht in de navigatie"]') as HTMLButtonElement;
  expect(home.disabled).toBe(true);
});

test("the country that drives the tax rules is set here, and says what it covers", async () => {
  const onHomeCountryChange = vi.fn();
  await render({ onHomeCountryChange });
  const select = section("Land en regio").querySelector("select") as HTMLSelectElement;
  expect(select.value).toBe("NL");
  expect(getHomeCountry()).toBe("NL"); // the same preference App reads
  expect(section("Land en regio").textContent).toContain("alleen voor Nederland");

  act(() => {
    select.value = "BE";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onHomeCountryChange).toHaveBeenCalledWith("BE");
});

test("the country list is EVERY country, in Dutch, sorted", async () => {
  await render();
  const options = [...section("Land en regio").querySelectorAll("select option")];
  expect(options.length).toBe(COUNTRY_CODES.length);
  expect(options.length).toBeGreaterThan(200); // a list, not a shortlist

  const names = options.map((o) => o.textContent ?? "");
  expect(names).toContain("Nederland");
  expect(names).toContain("Verenigde Staten"); // Dutch, not "United States"
  expect([...names].sort((a, b) => a.localeCompare(b, "nl"))).toEqual(names);
});

test("a region sits under the country, and is only a LIST where we have one", async () => {
  // His example: Texas is not New York. The US gets a real list…
  await render({ homeCountry: "US" });
  const us = section("Land en regio");
  expect(us.querySelector('input[list="home-regions"]')).not.toBeNull();
  const states = [...us.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));
  expect(states).toContain("Texas");
  expect(states).toContain("New York");

  // …and a country whose subdivisions LaVega cannot vouch for gets free text
  // plus a sentence saying so, rather than a dropdown of guesses.
  await render({ homeCountry: "NL" });
  const nl = section("Land en regio");
  expect(nl.querySelector("datalist")).toBeNull();
  expect(nl.textContent).toContain("geen geverifieerde regiolijst");
});

test("the region is typed by hand, and the app never infers where he is", async () => {
  const onHomeRegionChange = vi.fn();
  await render({ homeCountry: "US", onHomeRegionChange });
  const input = section("Land en regio").querySelector('input[list="home-regions"]') as HTMLInputElement;
  act(() => setNativeValue(input, "Texas"));
  expect(onHomeRegionChange).toHaveBeenCalledWith("Texas");
  expect(section("Land en regio").textContent).toContain("LaVega leidt nooit af waar je bent");
});

test("the profile opens with his own name, and says the name stays here", async () => {
  await render({ ownerName: { first: "Alexander", last: "Steunenberg" } });
  const head = section("Profiel");
  expect(head.querySelector(".profile-head-name")?.textContent).toBe("Alexander Steunenberg");
  expect(head.querySelector(".profile-head-avatar")?.textContent).toBe("AS"); // drawn, never fetched
  expect(head.textContent).toContain("nooit meegestuurd naar een model");
});

test("no name is 'no name', not a blank greeting", async () => {
  await render();
  const head = section("Profiel");
  expect(head.querySelector(".profile-head-name")?.textContent).toBe("Nog geen naam ingevuld");
  expect(head.querySelector(".profile-head-avatar")?.textContent).toBe("");
});

test("typing a name reports both halves back, unmangled", async () => {
  const onOwnerNameChange = vi.fn();
  await render({ ownerName: { first: "Alexander", last: "" }, onOwnerNameChange });
  const last = section("Profiel").querySelector('input[aria-label="Achternaam"]') as HTMLInputElement;
  act(() => setNativeValue(last, "Steunenberg"));
  expect(onOwnerNameChange).toHaveBeenCalledWith({ first: "Alexander", last: "Steunenberg" });
});

test("Koppelingen explains itself behind an eye, and the fields stay in the open", async () => {
  await render();
  // The value you came to set is visible without opening anything…
  expect(container!.querySelector('[aria-label="n8n webhook-URL"]')).not.toBeNull();
  expect(container!.textContent).not.toContain("Production URL — niet de Test URL");

  const eye = container!.querySelector('[aria-label="Uitleg bij de webhook-URL"]') as HTMLButtonElement;
  expect(eye).not.toBeNull();
  expect(eye.getAttribute("aria-expanded")).toBe("false");
  act(() => eye.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(container!.textContent).toContain("Production URL");
});

test("the half each entity belongs to is set here, and says what is not classified", async () => {
  const onClassifyEntity = vi.fn();
  await render({ onClassifyEntity });
  const list = section("Persoonlijk of zakelijk");
  expect(list.textContent).toContain("Privé");
  expect(list.textContent).toContain("BV1 Holding");
  // Neither is classified yet, so both count as persoonlijk — said out loud
  // rather than implied, and the name that reads as a company is flagged.
  expect(list.textContent).toContain("niet ingedeeld, telt als persoonlijk");
  expect(list.textContent).toContain("de naam leest als zakelijk");

  const zakelijk = list.querySelector('[aria-label="BV1 Holding zakelijk"]') as HTMLButtonElement;
  expect(zakelijk.getAttribute("aria-pressed")).toBe("false");
  act(() => {
    zakelijk.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onClassifyEntity).toHaveBeenCalledWith("BV1 Holding", "business");
});

test("an entity already classified shows its half as the pressed option", async () => {
  await render({
    entities: entitySummaries([{ key: "bv1", entity: "BV1" } as Account], [{ entity: "BV1", scope: "business" }]),
  });
  const list = section("Persoonlijk of zakelijk");
  expect((list.querySelector('[aria-label="BV1 zakelijk"]') as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
  expect((list.querySelector('[aria-label="BV1 persoonlijk"]') as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
  expect(list.textContent).not.toContain("niet ingedeeld");
});

test("Vergrendelen moved here from the app bar and still locks", async () => {
  const onLock = vi.fn();
  await render({ onLock });
  const button = [...section("Vergrendelen").querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Vergrendel"));
  expect(button).toBeTruthy();
  act(() => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onLock).toHaveBeenCalledTimes(1);
});

/* The two homescreen widgets he wants to be able to switch: "Positie per
 * onderneming […] I just want it to be a widget we can click on and off, so in
 * the profile I should be able to click it on and off instead of it always
 * being default there. Same applies to Aandacht." */

test("the overview widgets are switched here, and they start off", async () => {
  await render();
  const widgets = section("Widgets");
  /* GEEN VAST AANTAL MEER. Dit stond op 2 en viel om zodra Betaalagenda en
   * Transacties er als widget bij kwamen — een terechte uitbreiding die een test
   * liet omvallen, en dat leert de volgende alleen om het getal op te hogen. Wat
   * hier bewaakt hoort te worden is dat elke widget in het register OOK een
   * schakelaar krijgt: een widget die je niet kunt uitzetten is geen widget. */
  const items = widgets.querySelectorAll(".mp-item");
  expect(items.length).toBeGreaterThanOrEqual(2);
  expect(items.length).toBe(WIDGETS.length);
  expect(widgets.textContent).toContain("Aandacht");
  expect(widgets.textContent).toContain("Positie");

  for (const label of ["Aandacht", "Positie"]) {
    const toggle = widgets.querySelector(`[aria-label="${label} op je overzicht"]`) as HTMLButtonElement;
    expect(toggle, `no switch for ${label}`).not.toBeNull();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(false); // neither is locked on, unlike Overzicht in the nav
  }
});

test("switching a widget on is remembered, and does not touch the nav preference", async () => {
  await render();
  const toggle = section("Widgets").querySelector('[aria-label="Aandacht op je overzicht"]') as HTMLButtonElement;
  act(() => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  /* DE VORM IS {on, seen} GEWORDEN, en dat is opzet. Een kale lijst kon niet
   * uitdrukken of een widget UIT staat of NOG NIET BESTOND toen hij koos — en dat
   * verschil bepaalt of een nieuwe widget bij hem vanzelf verschijnt of stil weg
   * blijft. `seen` legt vast welke hij gezien heeft; ontbreken uit `on` betekent
   * pas "uit" voor de widgets die daarin staan. */
  const stored = JSON.parse(localStorage.getItem("lavega.overviewWidgets") ?? "null");
  /* WAT ER ONTHOUDEN IS, niet dat er verder niets aan staat. Een schakelaar
   * omzetten schrijft de HELE huidige keuze weg, en daar zit ook alles in wat al
   * standaard aan stond (Betaalagenda). Eisen dat `on` precies ["aandacht"] is,
   * zou dus eisen dat een andere widget stilletjes uitgaat. */
  expect(stored.on).toContain("aandacht");
  expect(stored.seen).toEqual(expect.arrayContaining(["aandacht"]));
  expect(localStorage.getItem("lavega.navModules")).toBeNull();
});

/* "Keep the manual linkage rules and their explanation." Nailed down, because
 * this round removes several blocks and this one must survive the cull. */
/* DE MIGRATIE, en dit is de test die er het meest toe doet.
 *
 * De voorkeur stond als KALE LIJST opgeslagen en is nu {on, seen}. Iedereen die
 * de app al gebruikte heeft die oude lijst nog in zijn browser staan. Wordt die
 * naief als de nieuwe vorm gelezen, dan betekent "staat er niet in" opeens
 * "uitgezet" — en dan verdwijnt een widget die er destijds nog niet eens WAS,
 * zonder dat iemand iets heeft uitgezet. Precies het soort stille regressie dat
 * niemand meldt omdat het eruitziet alsof het altijd zo was. */
test("een oude, kale widget-lijst blijft betekenen wat hij toen betekende", async () => {
  localStorage.setItem("lavega.overviewWidgets", JSON.stringify(["aandacht"]));
  await render();
  const widgets = section("Widgets");
  const aan = widgets.querySelector('[aria-label="Aandacht op je overzicht"]');
  expect(aan?.getAttribute("aria-checked")).toBe("true");
  // Betaalagenda bestond nog niet toen die lijst werd opgeslagen, dus zijn
  // afwezigheid daarin is geen keuze en mag hem niet uitzetten.
  const agenda = widgets.querySelector('[aria-label^="Betaalagenda"]');
  if (agenda) expect(agenda.getAttribute("aria-checked")).not.toBe("false");
});

test("the manual rules keep their explanation of how a match is decided", async () => {
  await render();
  const regels = section("Regels");
  expect(regels.textContent).toContain("Je eigen regels hieronder gaan vóór die automatische categorieën");
  expect(regels.textContent).toContain("eerste");
  expect(regels.querySelector("input")).not.toBeNull(); // and you can still add one
});

/* ══════ CASHBACK CORRIGEREN — de feedbackmodule ═════════════════════════════
 *
 * App review 4, punt 22. Hij vroeg om de aanname "een gewone kaart heeft geen
 * cashback", en om twee correctiewegen erbij: een jaarlijkse sweep en een plek
 * in de instellingen waar hij een cijfer kan rechtzetten. Dit is die plek.
 *
 * Wat deze suite bewaakt is niet dat er een invoerveld staat, maar de RANGORDE
 * eromheen: een aanname mag zichtbaar zijn, hij mag uit kunnen, en wat hij zelf
 * invult moet er altijd bovenop liggen. Draait één van die drie om, dan is de
 * aanname weer een stille nul — en dan zijn we terug bij de acht valse nullen in
 * de puntenkoersen, waar niemand achteraf kon zien welke nul gemeten was.
 */

const ING: Account[] = [
  { key: "B1", iban: "NL01INGB", name: "Betaalrekening", bank: "ING", entity: "Prive", currency: "EUR", balance: 1000, type: "Betaalrekening" } as Account,
];

/** Zoek de regel van één product op zijn testid. Faalt hard als hij er niet
 *  staat, zodat een verdwenen regel de test breekt in plaats van een assertie
 *  stil te laten slagen op tekst die ergens anders op de pagina staat. */
function cashbackRow(product: string): HTMLElement {
  const el = container!.querySelector(`[data-testid="cashback-fix-${product}"]`);
  if (!el) throw new Error(`geen regel voor "${product}"`);
  return el as HTMLElement;
}

function cashbackInput(product: string): HTMLInputElement {
  return container!.querySelector(`[aria-label="Cashback ${product}"]`) as HTMLInputElement;
}

/** De knop met deze tekst binnen de cashbacksectie. Op tekst en niet op volgorde,
 *  want "Opslaan" en "Wis mijn correctie" wisselen van plek zodra er een
 *  correctie staat. */
function cashbackButton(product: string, label: string): HTMLButtonElement {
  const btn = [...cashbackRow(product).querySelectorAll("button")].find((b) => b.textContent === label);
  if (!btn) throw new Error(`geen knop "${label}" bij ${product}`);
  return btn as HTMLButtonElement;
}

test("de module zegt wat LaVega nu aanneemt, met het woord aangenomen erbij", async () => {
  const { storage: s } = fakeStorage(ING);
  await render({ storage: s });
  const sec = section("Cashback corrigeren");
  expect(sec.textContent).toContain("ING betaalpas");
  // Het hele punt: de nul draagt zijn label. Een regel die alleen "0%" zou zeggen
  // is niet van een gemeten nul te onderscheiden.
  expect(cashbackRow("ING betaalpas").textContent).toContain("aangenomen: geen cashback");
  // En er staat bij dat er niets weggaat, want anders vult niemand dit in.
  expect(sec.textContent).toContain("Er gaat niets naar een server");
});

test("wat hij invult wordt een gebruikersfeit in zijn eigen kluis", async () => {
  const { storage: s, stored } = fakeStorage(ING);
  await render({ storage: s });
  act(() => setNativeValue(cashbackInput("ING betaalpas"), "1,5"));
  await act(async () => {
    cashbackButton("ING betaalpas", "Opslaan").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  // Eén feit, in de bestaande namespace, met bron "user" — geen tweede tabel
  // naast de feiten, want dan zijn er twee plekken waar een cijfer vandaan komt.
  expect(stored.facts).toHaveLength(1);
  expect(stored.facts[0]).toMatchObject({
    id: factId(TRAVEL_AGENT, "ING betaalpas", "cashbackPct"),
    agent: TRAVEL_AGENT,
    subject: "ING betaalpas",
    key: "cashbackPct",
    value: "1,5",
    source: "user",
    updatedAt: "2026-08-16",
  });
  // …en de regel zegt nu dat hij het zelf heeft gezet, niet dat het is aangenomen.
  const row = cashbackRow("ING betaalpas").textContent ?? "";
  expect(row).toContain("door jou ingesteld");
  expect(row).not.toContain("aangenomen");
});

test("een correctie is terug te draaien, en dan komt de aanname terug", async () => {
  // Een correctie die je niet kunt wissen is net zo min te controleren als een
  // aanname die je niet kunt uitzetten: wie zich vertypt zit er anders aan vast,
  // en een fout eigen cijfer verslaat élke agent — dat is de hele afspraak.
  const { storage: s, stored } = fakeStorage(ING);
  await render({ storage: s });
  act(() => setNativeValue(cashbackInput("ING betaalpas"), "1,5"));
  await act(async () => {
    cashbackButton("ING betaalpas", "Opslaan").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    cashbackButton("ING betaalpas", "Wis mijn correctie").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(stored.facts).toHaveLength(0);
  expect(cashbackRow("ING betaalpas").textContent).toContain("aangenomen: geen cashback");
});

test("een onmogelijk percentage wordt geweigerd MET de reden, niet stil ingeslikt", async () => {
  const { storage: s, stored } = fakeStorage(ING);
  await render({ storage: s });
  act(() => setNativeValue(cashbackInput("ING betaalpas"), "honderdduizend euro"));
  await act(async () => {
    cashbackButton("ING betaalpas", "Opslaan").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // De reden komt uit `checkFact` — dezelfde grens die elke agent moet passeren,
  // niet een tweede validatie die er net iets anders over denkt.
  const alert = container!.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("ING betaalpas");
  expect(alert?.textContent).toContain("geen getal");
  expect(stored.facts).toHaveLength(0);
});

test("de aanname is uit te zetten, en dan staat er weer onbekend", async () => {
  const { storage: s } = fakeStorage(ING);
  await render({ storage: s });
  const toggle = container!.querySelector('[aria-label="Neem aan dat een gewone kaart geen cashback geeft"]') as HTMLInputElement;
  expect(toggle.checked).toBe(true); // hij vroeg erom, dus hij staat aan

  // Een echte klik, niet `checked = false` + een los change-event: React leest
  // een checkbox uit het click-event, dus een handmatig gezette vlag verandert
  // wel de DOM maar nooit de component.
  act(() => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(cashbackRow("ING betaalpas").textContent).toContain("uitgezet");
  // De voorkeur overleeft het scherm — anders staat de aanname er bij de
  // volgende keer weer, zonder dat iemand hem heeft aangezet.
  expect(localStorage.getItem("lavega.cashbackAssumption")).toBe("0");
});

test("een Amex blijft onbekend, ook met de aanname aan, en zegt waarom", async () => {
  // De afbakening in het klein: bij een kaart die op zijn beloning wordt verkocht
  // is nul niet voorzichtig maar onjuist. En de melding noemt de oorzaak, want
  // "onbekend" zonder reden stuurt hem naar de verkeerde knop.
  const amex: Account[] = [
    { key: "C1", iban: "", name: "Green Card", bank: "American Express", entity: "Prive", currency: "EUR", balance: -100, type: "Creditcard" } as Account,
  ];
  const { storage: s } = fakeStorage(amex);
  await render({ storage: s });
  const row = cashbackRow("American Express creditcard").textContent ?? "";
  expect(row).toContain("onbekend");
  expect(row).toContain("wat je ermee verdient");
  expect(row).not.toContain("aangenomen");
});

test("twee rekeningen van hetzelfde product zijn één vraag, niet twee", async () => {
  // Feiten zijn gekeyd op de productnaam. Twee regels zouden suggereren dat je ze
  // los kunt zetten, en de tweede zou de eerste stil overschrijven.
  const twee: Account[] = [
    ING[0],
    { ...ING[0], key: "B2", name: "Tweede rekening" } as Account,
  ];
  const { storage: s } = fakeStorage(twee);
  await render({ storage: s });
  expect(container!.querySelectorAll('[data-testid^="cashback-fix-"]').length).toBe(1);
  expect(cashbackRow("ING betaalpas").textContent).toContain("2 rekeningen");
});

test("kan de kluis niet gelezen worden, dan zegt het scherm dát in plaats van een lege lijst", async () => {
  // Een lege lijst leest als "je hebt geen kaarten", en dat is een conclusie die
  // een mislukte leespoging niet kan dragen.
  const broken = {
    export: () => null,
    restore: async () => false,
    getAccounts: async () => {
      throw new Error("vault is locked");
    },
    getFacts: async () => [],
  } as unknown as VaultStorage;
  await render({ storage: broken });
  const sec = section("Cashback corrigeren");
  expect(sec.textContent).toContain("niet uit de kluis lezen");
  expect(sec.textContent).toContain("vault is locked");
});

test("een 0 die HIJ invult is een bekende nul, geen aanname — en overleeft de schakelaar", async () => {
  // De keerzijde van "onbekend is nooit nul", en die geldt net zo hard. Wie in de
  // voorwaarden heeft gelezen dat er niets terugkomt legt een feit vast, en een
  // feit mag niet verdwijnen als de aanname wordt uitgezet.
  const { storage: s, stored } = fakeStorage(ING);
  await render({ storage: s });
  act(() => setNativeValue(cashbackInput("ING betaalpas"), "0"));
  await act(async () => {
    cashbackButton("ING betaalpas", "Opslaan").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(stored.facts[0]).toMatchObject({ value: "0", source: "user" });
  expect(cashbackRow("ING betaalpas").textContent).toContain("door jou ingesteld");

  const toggle = container!.querySelector('[aria-label="Neem aan dat een gewone kaart geen cashback geeft"]') as HTMLInputElement;
  act(() => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const row = cashbackRow("ING betaalpas").textContent ?? "";
  expect(row).toContain("door jou ingesteld");
  expect(row).not.toContain("uitgezet");
});
