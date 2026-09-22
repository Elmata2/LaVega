// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test } from "vitest";
import Onboarding from "./components/Onboarding";
import {
  isFreshVault,
  markOnboardingSeen,
  onboardingSeen,
  showOnboarding,
} from "./onboarding.js";
import {
  getDefaultScope,
  getHomeCountry,
  getHomeRegion,
  getOwnerName,
  setDefaultScope,
  setHomeCountry,
  setHomeRegion,
  setOwnerName,
  storedHomeCountry,
} from "./settings.js";

/* DE EENMALIGE INSTELSTAP. Hij bestaat om één reden: `getHomeCountry()` viel
 * terug op NL, dus een Duitse gebruiker opende op Nederlandse BTW-termijnen en
 * de KOR tot hij uit zichzelf Profiel vond. Dat is een verkeerd antwoord op een
 * belastingvraag en niet een voorkeur die mag sudderen. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=nl; Path=/";
});

const render = () => renderToStaticMarkup(<Onboarding onDone={() => {}} />);

test("the step asks the four things that decide what the app computes", () => {
  const html = render();
  expect(html).toContain("Taal");
  expect(html).toContain("Voornaam");
  expect(html).toContain("Achternaam");
  expect(html).toContain("Land");
  expect(html).toContain("Persoonlijk");
  expect(html).toContain("Zakelijk");
});

test("the step is in the reader's language, like every other screen", () => {
  document.cookie = "lavega_locale=en; Path=/";
  const html = render();
  expect(html).toContain("First name");
  expect(html).toContain("Country");
  expect(html).not.toContain("Voornaam");
  expect(html).not.toContain("Achternaam");
});

/* HET LAND IS DE HELE REDEN. Een lijst zonder Duitsland zou de stap zinloos
 * maken voor de ontwerp-partner waarvoor hij is gebouwd. */
test("the country list offers Germany, and nothing is preselected", () => {
  const html = render();
  expect(html).toContain('value="DE"');
  expect(html).toContain('value="NL"');
  // Geen gegokt land: leeg tot hij kiest, zodat "niet gezegd" zichtbaar blijft.
  expect(html).toMatch(/<option value="" selected="">/);
});

test("the seen flag survives a reload and defaults to unseen", () => {
  expect(onboardingSeen()).toBe(false);
  markOnboardingSeen();
  expect(onboardingSeen()).toBe(true);
});

/* NIETS AANRAKEN MAG NIETS VERANDEREN, en dat is de scherpe rand van deze stap.
 *
 * Hij komt ook langs bij het terugzetten van een BACK-UP op een nieuwe browser:
 * `gate` is dan "setup" terwijl de persoon allesbehalve nieuw is. `scope` begon
 * hardgecodeerd op "personal" en zette een eerder gekozen "business" dus terug
 * zodra hij op Klaar drukte — gevonden in review, niet door een test. */
test("submitting without touching anything overwrites nothing", async () => {
  setDefaultScope("business");
  setHomeCountry("DE");
  setHomeRegion("Bayern");
  setOwnerName({ first: "Tom", last: "Weber" });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Onboarding onDone={() => {}} />);
  });
  const form = container.querySelector("form") as HTMLFormElement;
  await act(async () => {
    form.requestSubmit();
  });

  expect(getDefaultScope()).toBe("business");
  expect(getHomeCountry()).toBe("DE");
  expect(getHomeRegion()).toBe("Bayern");
  expect(getOwnerName()).toEqual({ first: "Tom", last: "Weber" });
  await act(async () => root.unmount());
  container.remove();
});

/* OVERSLAAN IS EEN ECHTE UITWEG. Niets ingevuld, dus niets geschreven — en de
 * vlag gaat om, zodat hij de stap niet elke keer opnieuw krijgt. */
test("skipping writes no preference and does not ask again", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let done = false;
  await act(async () => {
    root.render(<Onboarding onDone={() => (done = true)} />);
  });
  const skip = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Overslaan",
  ) as HTMLButtonElement;
  await act(async () => skip.click());

  expect(done).toBe(true);
  expect(onboardingSeen()).toBe(true);
  expect(storedHomeCountry()).toBe(""); // niets geschreven, ook geen gegokte NL
  expect(getHomeRegion()).toBe("");
  expect(getOwnerName()).toEqual({ first: "", last: "" });
  await act(async () => root.unmount());
  container.remove();
});

/* EN DE TWEEDE HELFT VAN DE REGEL: één keer, en daarna nooit meer. */
test("the step shows once for a fresh vault and never again", () => {
  expect(showOnboarding(true, false)).toBe(true);
  expect(showOnboarding(true, true)).toBe(false);
  expect(showOnboarding(false, false)).toBe(false);
  expect(showOnboarding(false, true)).toBe(false);
});

/* WIE DE STAP NIET KRIJGT, en dat is de belangrijkere helft. Alexander's eigen
 * kluis bestaat al; als deze regel ooit omslaat krijgt hij een instelscherm dat
 * zijn land en taal met lege velden kan overschrijven. */
test("only a just-created vault triggers the step — never an existing one", () => {
  expect(isFreshVault("setup")).toBe(true);
  // Ontgrendelen is iemand die de kluis al had.
  expect(isFreshVault("unlock")).toBe(false);
  // Migreren is per definitie iemand met data van vóór de kluis.
  expect(isFreshVault("migrate")).toBe(false);
  expect(isFreshVault("loading")).toBe(false);
  expect(isFreshVault("ready")).toBe(false);
});

/* DEZELFDE OPMAAK ALS HET SCHERM ERVÓÓR. Dit stond eerst op een klasse die
 * niet bestaat (`gate` in plaats van `vault-gate`), en dan rendert de stap
 * ongecentreerd over de volle breedte — direct na een kluisscherm dat dat wél
 * netjes doet. Onzichtbaar in een test die alleen op tekst let. */
test("the step is laid out like the vault screen it follows", () => {
  const html = render();
  expect(html).toContain('class="vault-gate"');
  expect(html).toContain("vault-gate-card");
  // En het is één formulier, zodat Enter hem afrondt.
  expect(html).toContain("<form");
});
