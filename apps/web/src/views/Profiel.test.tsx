// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/* These suites pin the behaviour that stays in the code while the business side
 * is archived (scope switch, entity classifier, invoice forwarding, the
 * registry entries). They run with the switch OFF; archive.test.ts and
 * archive-ui.test.tsx cover the switch ON. */
vi.mock("../archive", () => ({
  ARCHIVE_BUSINESS: false,
  ARCHIVED_VIEWS: [],
  ARCHIVED_WIDGETS: [],
  SHOW_SCOPE_SWITCH: true,
  SHOW_INVOICE_FORWARDING: true,
  SHOW_ENTITY_CLASSIFIER: true,
  // The hidden-for-now cards: shown here so their own behaviour stays pinned.
  // archive-profiel.test.tsx covers the real (hidden) values.
  SHOW_OWN_COLUMNS_IMPORT: true,
  SHOW_DOCUMENTS_CARD: true,
  SHOW_CASHBACK_CORRECTION: true,
  SHOW_NET_WORTH_SHARE: true,
  isArchivedView: () => false,
  isArchivedWidget: () => false,
  initialScope: () =>
    localStorage.getItem("lavega.defaultScope") === "business" ? "business" : "personal",
}));
import type { Account, LearnedFact } from "@lavega/core";
import { entitySummaries, factId, TRAVEL_AGENT } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import Profiel from "./Profiel";
import { forgetMemoryTheme } from "../hooks/useTheme";
import { intakeCopy } from "../copy/intake.js";
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
  forgetMemoryTheme();
  localStorage.clear();
  document.cookie = "lavega_locale=nl";
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  // Some tests render twice and orphan the first container; its radios would
  // share a name with the next test's and uncheck them.
  document.body.replaceChildren();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
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
const ACCOUNT = { kind: "account", id: "u1" } as const;

async function render(overrides: Partial<Parameters<typeof Profiel>[0]> = {}) {
  const props: Parameters<typeof Profiel>[0] = {
    owner: { kind: "device" },
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
    shareNetWorthEnabled: false,
    onShareNetWorthEnabledChange: () => {},
    shareNetWorthPendingDelete: false,
    ownerName: { first: "", last: "" },
    onOwnerNameChange: () => {},
    onLock: () => {},
    entity: "Persoonlijk",
    onEntityChange: () => {},
    busy: false,
    problems: [],
    onImport: () => {},
    onRefreshBank: () => {},
    storage,
    asOf: "2026-08-16",
    onRestored: () => {},
    planUnlocked: false,
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

/* ══════ ACCOUNT — inloggen tegen de geconfigureerde LaVega-server ══════════
 *
 * Sign-up blijft verborgen (dat regelt de server). Wat hier wordt bewaakt: de
 * drie standen van AuthState renderen elk het juiste — geen formulier zonder
 * server, wél een formulier zonder sessie, en de identiteit plus een uitweg
 * zodra er een sessie is — en dat een mislukte inlogpoging de Nederlandse
 * boodschap toont, nooit de rauwe servertekst. */

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

test("Account: zonder serveraccount staat er alleen de ene zin, geen formulier", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await render();
  const account = section("Algemeen").querySelector('[data-testid="general-account"]')!;
  expect(account.textContent).toContain("geen serveraccount ingesteld");
  expect(account.querySelector("form")).toBeNull();
  expect(account.querySelector("input")).toBeNull();
});

test("Account: zonder sessie staat het inlogformulier klaar", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ user: null }))),
  );
  await render();
  const account = section("Algemeen");
  expect(account.querySelector('input[type="email"]')).not.toBeNull();
  expect(account.querySelector('input[type="password"]')).not.toBeNull();
  expect([...account.querySelectorAll("button")].some((b) => b.textContent === "Inloggen")).toBe(
    true,
  );
});

test("Account: een mislukte inlogpoging toont de Nederlandse boodschap, niet de servertekst", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/sign-in/email")) {
        return new Response(JSON.stringify({ message: "invalid credentials" }), { status: 401 });
      }
      return new Response(JSON.stringify({ user: null }));
    }),
  );
  await render();
  const account = section("Algemeen");
  act(() =>
    setNativeValue(
      account.querySelector('input[type="email"]') as HTMLInputElement,
      "owner@example.com",
    ),
  );
  act(() =>
    setNativeValue(account.querySelector('input[type="password"]') as HTMLInputElement, "verkeerd"),
  );
  await act(async () => submit(account.querySelector("form") as HTMLFormElement));
  expect(account.querySelector('[role="alert"]')?.textContent).toBe(
    "Onjuist e-mailadres of wachtwoord.",
  );
});

test("Account: een geslaagde inlog toont het e-mailadres in Algemeen, zonder eigen Uitloggen-knop", async () => {
  let loggedIn = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("/sign-in/email") && init?.method === "POST") {
        loggedIn = true;
        return new Response(JSON.stringify({ user: { id: "u1", email: "owner@example.com" } }));
      }
      return new Response(
        JSON.stringify(
          loggedIn ? { user: { id: "u1", email: "owner@example.com" } } : { user: null },
        ),
      );
    }),
  );
  await render();
  const account = section("Algemeen");
  act(() =>
    setNativeValue(
      account.querySelector('input[type="email"]') as HTMLInputElement,
      "owner@example.com",
    ),
  );
  act(() =>
    setNativeValue(
      account.querySelector('input[type="password"]') as HTMLInputElement,
      "geheim123",
    ),
  );
  await act(async () => submit(account.querySelector("form") as HTMLFormElement));
  expect(section("Algemeen").textContent).toContain("owner@example.com");
  expect(
    [...section("Algemeen").querySelectorAll("button")].some((b) => b.textContent === "Uitloggen"),
  ).toBe(false);
});

/* ONE sign-out control on the page. With an account session it signs out of the
 * account and then locks the vault; without a session it only locks. */
function signOutButtons(): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter(
    (b) => b.textContent === "Uitloggen",
  ) as HTMLButtonElement[];
}

test("Uitloggen: met accountsessie eerst uitloggen bij het account, dan de kluis vergrendelen", async () => {
  let loggedIn = true;
  const order: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/sign-out") && init?.method === "POST") {
      loggedIn = false;
      order.push("signOut");
      return new Response(null);
    }
    return new Response(
      JSON.stringify(
        loggedIn ? { user: { id: "u1", email: "owner@example.com" } } : { user: null },
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const onLock = vi.fn(() => {
    order.push("lock");
  });
  await render({ onLock });
  expect(signOutButtons()).toHaveLength(1);
  await act(async () =>
    signOutButtons()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(order).toEqual(["signOut", "lock"]);
  expect(onLock).toHaveBeenCalledTimes(1);
});

test("Uitloggen: zonder sessie alleen vergrendelen, geen sign-out-verzoek", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: null })));
  vi.stubGlobal("fetch", fetchMock);
  const onLock = vi.fn();
  await render({ onLock });
  expect(signOutButtons()).toHaveLength(1);
  await act(async () =>
    signOutButtons()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(onLock).toHaveBeenCalledTimes(1);
  expect(
    (fetchMock.mock.calls as unknown as [string, RequestInit?][]).some(([u]) =>
      String(u).includes("/sign-out"),
    ),
  ).toBe(false);
});

test("Koppelingen, Back-up and Import render inside the profile", async () => {
  await render();
  expect(container!.querySelector('[aria-label="Koppelingen"]')).not.toBeNull();
  expect(section("Importeren").querySelector('input[type="file"]')).not.toBeNull();
  expect(section("Back-up")).toBeTruthy();
});

/* REGELS STAAT HIER NIET MEER. Zijn verzoek bij de UI-ronde van 21 september:
 * regels horen bij de transactiestap en niet in de instellingenkaart — een
 * regel is een antwoord op een transactie die verkeerd is ingedeeld, dus hij
 * hoort waar je dat ziet gebeuren. App.tsx rendert hem nu naast Transacties. */
test("the rules are no longer buried in the settings card", async () => {
  await render();
  expect(container!.querySelector('[aria-label="Regels"]')).toBeNull();
  expect(container!.textContent).not.toContain("albert heijn");
});

test("the country that sets the card-terms market is set here, and says what it covers", async () => {
  const onHomeCountryChange = vi.fn();
  await render({ onHomeCountryChange });
  const select = section("Algemeen").querySelector("select") as HTMLSelectElement;
  expect(select.value).toBe("NL");
  expect(getHomeCountry()).toBe("NL"); // the same preference App reads
  expect(section("Algemeen").textContent).toContain("kaartvoorwaarden opzoekt");

  act(() => {
    select.value = "BE";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onHomeCountryChange).toHaveBeenCalledWith("BE");
});

test("the country list is EVERY country, in Dutch, sorted", async () => {
  await render();
  const options = [...section("Algemeen").querySelectorAll("select option")];
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
  const us = section("Algemeen");
  expect(us.querySelector('input[list="home-regions"]')).not.toBeNull();
  const states = [...us.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));
  expect(states).toContain("Texas");
  expect(states).toContain("New York");

  // …and a country whose subdivisions LaVega cannot vouch for gets free text,
  // rather than a dropdown of guesses.
  await render({ homeCountry: "NL" });
  const nl = section("Algemeen");
  expect(nl.querySelector("datalist")).toBeNull();
});

test("the region is typed by hand, and the app never infers where he is", async () => {
  const onHomeRegionChange = vi.fn();
  await render({ homeCountry: "US", onHomeRegionChange });
  const input = section("Algemeen").querySelector('input[list="home-regions"]') as HTMLInputElement;
  act(() => setNativeValue(input, "Texas"));
  expect(onHomeRegionChange).toHaveBeenCalledWith("Texas");
  expect(section("Algemeen").textContent).toContain("LaVega leidt nooit af waar je bent");
});

test("Algemeen holds the name fields, and says the name stays here", async () => {
  await render({ ownerName: { first: "Alexander", last: "Steunenberg" } });
  const general = section("Algemeen");
  expect((general.querySelector('input[aria-label="Voornaam"]') as HTMLInputElement).value).toBe(
    "Alexander",
  );
  expect((general.querySelector('input[aria-label="Achternaam"]') as HTMLInputElement).value).toBe(
    "Steunenberg",
  );
  expect(general.textContent).toContain("nooit meegestuurd naar een model");
});

test("typing a name reports both halves back, unmangled", async () => {
  const onOwnerNameChange = vi.fn();
  await render({ ownerName: { first: "Alexander", last: "" }, onOwnerNameChange });
  const last = section("Algemeen").querySelector(
    'input[aria-label="Achternaam"]',
  ) as HTMLInputElement;
  act(() => setNativeValue(last, "Steunenberg"));
  expect(onOwnerNameChange).toHaveBeenCalledWith({ first: "Alexander", last: "Steunenberg" });
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
    entities: entitySummaries(
      [{ key: "bv1", entity: "BV1" } as Account],
      [{ entity: "BV1", scope: "business" }],
    ),
  });
  const list = section("Persoonlijk of zakelijk");
  expect(
    (list.querySelector('[aria-label="BV1 zakelijk"]') as HTMLButtonElement).getAttribute(
      "aria-pressed",
    ),
  ).toBe("true");
  expect(
    (list.querySelector('[aria-label="BV1 persoonlijk"]') as HTMLButtonElement).getAttribute(
      "aria-pressed",
    ),
  ).toBe("false");
  expect(list.textContent).not.toContain("niet ingedeeld");
});

test("Uitloggen (formerly Vergrendelen) lives here and still locks", async () => {
  const onLock = vi.fn();
  await render({ onLock });
  const button = [...section("Uitloggen").querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Uitloggen"),
  );
  expect(button).toBeTruthy();
  act(() => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onLock).toHaveBeenCalledTimes(1);
});

/* "Keep the manual linkage rules and their explanation." Nailed down, because
 * this round removes several blocks and this one must survive the cull. */
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
  {
    key: "B1",
    iban: "NL01INGB",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 1000,
    type: "Betaalrekening",
  } as Account,
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
  const btn = [...cashbackRow(product).querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
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
    cashbackButton("ING betaalpas", "Opslaan").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
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
    cashbackButton("ING betaalpas", "Opslaan").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
  await act(async () => {
    cashbackButton("ING betaalpas", "Wis mijn correctie").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
  expect(stored.facts).toHaveLength(0);
  expect(cashbackRow("ING betaalpas").textContent).toContain("aangenomen: geen cashback");
});

test("een onmogelijk percentage wordt geweigerd MET de reden, niet stil ingeslikt", async () => {
  const { storage: s, stored } = fakeStorage(ING);
  await render({ storage: s });
  act(() => setNativeValue(cashbackInput("ING betaalpas"), "honderdduizend euro"));
  await act(async () => {
    cashbackButton("ING betaalpas", "Opslaan").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
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
  const toggle = container!.querySelector(
    '[aria-label="Neem aan dat een gewone kaart geen cashback geeft"]',
  ) as HTMLInputElement;
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

test("zonder account (alleen dit apparaat) is er geen deel-kaart: er gaat niets weg", async () => {
  await render({ owner: { kind: "device" }, shareNetWorthEnabled: false });
  expect(container!.textContent).not.toContain("Delen met LaVega Investing");
});

test("de uitleg zegt dat het het totaal van al je bankrekeningen is, zakelijke rekeningen inbegrepen", async () => {
  await render({ owner: ACCOUNT, shareNetWorthEnabled: true });
  const text = container!.textContent ?? "";
  expect(text).toContain("alle bankrekeningen");
  expect(text).toContain("zakelijke");
});

test("de uitleg bij de schakelaar zegt dat hij standaard aan staat, wat er gaat en dat uitzetten kan", async () => {
  await render({ owner: ACCOUNT, shareNetWorthEnabled: true });
  const text = container!.textContent ?? "";
  expect(text).toContain("Staat standaard aan");
  expect(text).toContain("alleen je dagtotaal");
  expect(text).toContain("geen rekeningen of transacties");
  expect(text).toContain("jouw account");
  expect(text).toContain("uitzetten");
});

test("de net-worth-share schakelaar meldt de verandering naar boven", async () => {
  const onChange = vi.fn();
  await render({
    owner: ACCOUNT,
    shareNetWorthEnabled: false,
    onShareNetWorthEnabledChange: onChange,
  });
  const toggle = container!.querySelector(
    '[aria-label="Deel mijn Totale positie met LaVega Investing"]',
  ) as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  act(() => toggle.click());
  expect(onChange).toHaveBeenCalledWith(true);
});

test("de net-worth-share schakelaar volgt de prop als hij al aan staat", async () => {
  await render({ owner: ACCOUNT, shareNetWorthEnabled: true });
  const toggle = container!.querySelector(
    '[aria-label="Deel mijn Totale positie met LaVega Investing"]',
  ) as HTMLInputElement;
  expect(toggle.checked).toBe(true);
});

test("een mislukte verwijdering na het uitzetten toont de terugval-melding", async () => {
  await render({ owner: ACCOUNT, shareNetWorthEnabled: false, shareNetWorthPendingDelete: true });
  expect(container!.textContent).toContain("Kon je gedeelde bedragen niet verwijderen");
});

test("geen terugval-melding zolang er niets mislukt is", async () => {
  await render({ owner: ACCOUNT, shareNetWorthEnabled: false, shareNetWorthPendingDelete: false });
  expect(container!.textContent).not.toContain("Kon je gedeelde bedragen niet verwijderen");
});

test("een Amex blijft onbekend, ook met de aanname aan, en zegt waarom", async () => {
  // De afbakening in het klein: bij een kaart die op zijn beloning wordt verkocht
  // is nul niet voorzichtig maar onjuist. En de melding noemt de oorzaak, want
  // "onbekend" zonder reden stuurt hem naar de verkeerde knop.
  const amex: Account[] = [
    {
      key: "C1",
      iban: "",
      name: "Green Card",
      bank: "American Express",
      entity: "Prive",
      currency: "EUR",
      balance: -100,
      type: "Creditcard",
    } as Account,
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
  const twee: Account[] = [ING[0], { ...ING[0], key: "B2", name: "Tweede rekening" } as Account];
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
    cashbackButton("ING betaalpas", "Opslaan").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
  expect(stored.facts[0]).toMatchObject({ value: "0", source: "user" });
  expect(cashbackRow("ING betaalpas").textContent).toContain("door jou ingesteld");

  const toggle = container!.querySelector(
    '[aria-label="Neem aan dat een gewone kaart geen cashback geeft"]',
  ) as HTMLInputElement;
  act(() => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const row = cashbackRow("ING betaalpas").textContent ?? "";
  expect(row).toContain("door jou ingesteld");
  expect(row).not.toContain("uitgezet");
});

test("the page renders in English when the locale cookie says en", async () => {
  document.cookie = "lavega_locale=en";
  await render();
  expect(container!.textContent).toContain("Correct cashback");
  expect(container!.textContent).toContain("Personal or business");
  expect(container!.textContent).toContain("Sign out");
  expect(container!.textContent).not.toContain("Cashback corrigeren");
  expect(container!.textContent).not.toContain("Persoonlijk of zakelijk");
  expect(container!.textContent).not.toContain("Uitloggen");
});

test("the language switch flips the page's copy live, without a remount", async () => {
  await render();
  const switcher = section("Taal / Language");
  expect(section("Uitloggen")).toBeTruthy();

  const englishButton = [...switcher.querySelectorAll("button")].find(
    (b) => b.textContent === "English",
  ) as HTMLButtonElement;
  expect(englishButton).toBeTruthy();
  await act(async () => {
    englishButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(section("Sign out")).toBeTruthy();
  expect(container!.querySelector('[aria-label="Uitloggen"]')).toBeNull();
});

test("the secondary link in Jouw plan opens what LaVega knows about you", async () => {
  const onNavigate = vi.fn();
  await render({ onNavigate });
  const card = section("Jouw plan");
  const open = [...card.querySelectorAll("button")].find(
    (b) => b.textContent === "Bekijk wat LaVega weet",
  )!;
  act(() => open.click());
  expect(onNavigate).toHaveBeenCalledWith("about-you");
});

/* ══════ WEERGAVE — thema-keuze (Midnight / Zwart-wit) ═════════════════════ */

/** Een radio aanklikken. Onder jsdom staat de `checked`-eigenschap van een
 *  gecontroleerde radio pas goed na een tweede flush; de state en het attribuut
 *  op <html> zijn al meteen goed. */
async function pick(radio: HTMLInputElement) {
  act(() => radio.click());
  await act(async () => {});
}

test("Weergave: twee gelabelde radio's in een radiogroup, in Algemeen", async () => {
  await render();
  const card = section("Algemeen");
  const group = card.querySelector('[role="radiogroup"]');
  expect(group).not.toBeNull();
  expect(group!.getAttribute("aria-label")).toBe("Thema");
  const radios = [...card.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  expect(radios.map((r) => r.value)).toEqual(["midnight", "light"]);
  expect(radios).toHaveLength(2);
  expect(card.textContent).toContain("Donker");
  expect(card.textContent).toContain("Licht");
  expect(card.textContent).not.toContain("Zwart-wit");
  for (const r of radios) expect(r.labels?.length).toBe(1);
});

test("Weergave: Engels gebruikt 'Dark' en 'Light'", async () => {
  document.cookie = "lavega_locale=en";
  await render();
  expect(container!.textContent).toContain("Dark");
  expect(container!.textContent).toContain("Light");
  expect(container!.textContent).not.toContain("Black and white");
});

test("Weergave: een opgeslagen 'mono' staat als Licht aan", async () => {
  localStorage.setItem("lavega.theme", "mono");
  await render();
  const radios = [...section("Algemeen").querySelectorAll<HTMLInputElement>("input[type=radio]")];
  expect(radios.find((r) => r.checked)?.value).toBe("light");
});

test("Weergave: de gekozen radio volgt het opgeslagen thema bij het laden", async () => {
  localStorage.setItem("lavega.theme", "light");
  await render();
  const radios = [...section("Algemeen").querySelectorAll<HTMLInputElement>("input[type=radio]")];
  expect(radios.find((r) => r.checked)?.value).toBe("light");
});

test("Weergave: kiezen bewaart en past direct toe", async () => {
  delete document.documentElement.dataset.theme;
  await render();
  const light = section("Algemeen").querySelector<HTMLInputElement>('input[value="light"]')!;
  await pick(light);
  expect(localStorage.getItem("lavega.theme")).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(light.checked).toBe(true);
  const mid = section("Algemeen").querySelector<HTMLInputElement>('input[value="midnight"]')!;
  await pick(mid);
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(localStorage.getItem("lavega.theme")).toBe("midnight");
});

test("Weergave: geblokkeerde opslag wisselt toch, zonder foutmelding", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  await render();
  const card = section("Algemeen");
  const before = card.textContent;
  await pick(card.querySelector<HTMLInputElement>('input[value="light"]')!);
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(card.querySelector<HTMLInputElement>('input[value="light"]')!.checked).toBe(true);
  expect(card.textContent).toBe(before);
  expect(card.querySelector('[role="alert"]')).toBeNull();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

test("Weergave: een storage-event van een ander tabblad werkt de keuze bij", async () => {
  delete document.documentElement.dataset.theme;
  await render();
  localStorage.setItem("lavega.theme", "light");
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "lavega.theme", newValue: "light" }));
  });
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(section("Algemeen").querySelector<HTMLInputElement>('input[value="light"]')!.checked).toBe(
    true,
  );
  delete document.documentElement.dataset.theme;
});

/* ══════ JOUW PLAN — the only way in now that the nav no longer lists it ═══════ */

test("Jouw plan card; unlocked it opens the plan view", async () => {
  const onNavigate = vi.fn();
  await render({ planUnlocked: true, onNavigate });
  const first = section("Jouw plan");
  expect(first.getAttribute("aria-label")).toBe("Jouw plan");
  expect(first.textContent).toContain("Jouw plan");
  const open = [...first.querySelectorAll("button, a")].find(
    (b) => b.textContent === "Open je plan",
  ) as HTMLElement;
  expect(open).toBeTruthy();
  act(() => open.click());
  expect(onNavigate).toHaveBeenCalledWith("plan");
});

test("Jouw plan card, locked: the intake prompt and a Begin button that opens the intake", async () => {
  const onNavigate = vi.fn();
  await render({ planUnlocked: false, onNavigate });
  const first = section("Jouw plan");
  expect(first.getAttribute("aria-label")).toBe("Jouw plan");
  expect(first.textContent).toContain(intakeCopy.nl.home.invite.intro);
  expect(first.textContent).not.toContain("Open je plan");
  const begin = [...first.querySelectorAll("button")].find((b) => b.textContent === "Begin")!;
  act(() => begin.click());
  expect(onNavigate).toHaveBeenCalledWith("intake");
});

test("Profiel shows five cards in order: Algemeen, Jouw plan, Importeren, Back-up, Uitloggen", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ user: null }))),
  );
  await render({ onNavigate: () => {} });
  const wanted = ["Algemeen", "Jouw plan", "Importeren", "Back-up", "Uitloggen"];
  const labels = [...container!.querySelectorAll("section[aria-label]")]
    .map((el) => el.getAttribute("aria-label")!)
    .filter((l) => wanted.includes(l));
  expect(labels).toEqual(wanted);
  // The removed cards are gone for good, not just moved.
  for (const gone of ["Modules", "Widgets", "Vreemde valuta"]) {
    expect(container!.querySelector(`section[aria-label="${gone}"]`)).toBeNull();
  }
  expect(container!.querySelector('[data-testid="build-stamp"]')).not.toBeNull();
});

test("Uitloggen: een mislukte sign-out-aanvraag vergrendelt de kluis toch", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/sign-out") && init?.method === "POST") throw new Error("offline");
      return new Response(JSON.stringify({ user: { id: "u1", email: "owner@example.com" } }));
    }),
  );
  const onLock = vi.fn();
  await render({ onLock });
  await act(async () =>
    signOutButtons()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(onLock).toHaveBeenCalledTimes(1);
});

test("Uitloggen: nog tijdens 'loading' wordt de account-sign-out geprobeerd en daarna vergrendeld", async () => {
  let release: (r: Response) => void = () => {};
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/sign-out") && init?.method === "POST") {
      return Promise.resolve(new Response(null));
    }
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const onLock = vi.fn();
  await render({ onLock });
  await act(async () =>
    signOutButtons()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(
    fetchMock.mock.calls.some(
      ([u, i]) =>
        String(u).includes("/sign-out") && (i as RequestInit | undefined)?.method === "POST",
    ),
  ).toBe(true);
  expect(onLock).toHaveBeenCalledTimes(1);
  release(new Response(JSON.stringify({ user: null })));
});
