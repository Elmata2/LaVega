// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Account, LearnedFact } from "@lavega/core";
import { entitySummaries } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import Profiel from "./views/Profiel";
import { WIDGETS, enabledModules } from "./components/moduleRegistry";
import { ARCHIVED_WIDGETS } from "./archive";

/* Switch ON (no archive mock): the profile hides the business-only cards. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=nl";
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

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
    fxConversionMode: "convert",
    onFxConversionModeChange: () => {},
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

test("profile hides the entity classifier and the forwarding card, and counts only live widgets", async () => {
  await render();
  expect(container!.querySelector('[aria-label="Persoonlijk of zakelijk"]')).toBeNull();
  expect(container!.querySelector('[aria-label="Koppelingen"]')).toBeNull();
  expect(container!.textContent).not.toContain("factuuradres");
  const live = WIDGETS.filter((w) => !ARCHIVED_WIDGETS.includes(w.id)).length;
  expect(WIDGETS.length).toBeGreaterThan(live);
  expect(container!.textContent).toMatch(new RegExp(`van ${live} aan`));
});
