// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, Tx } from "@lavega/core";

beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
});

afterEach(() => {
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
  vi.doUnmock("../archive");
  vi.resetModules();
});

const ACCOUNTS: Account[] = [
  {
    key: "NL01INGB",
    iban: "NL01INGB",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Persoonlijk",
    currency: "EUR",
    balance: 100,
  },
];

const TX: Tx = {
  id: "t1",
  accountKey: "NL01INGB",
  date: "2026-07-14",
  amount: -20,
  currency: "EUR",
  counterparty: "Albert Heijn",
  description: "Aankoop",
  category: "",
  manual: false,
};

const html = async (flag: boolean) => {
  vi.resetModules();
  vi.doMock("../archive", async (orig) => ({
    ...(await orig<typeof import("../archive")>()),
    SHOW_ENTITY_CLASSIFIER: flag,
  }));
  const { default: Transacties } = await import("./Transacties");
  const props = {
    accounts: ACCOUNTS,
    scopedTxs: [TX],
    rules: [],
    own: { all: [], byKey: new Map<string, string[]>() },
    fxHistory: {},
    mode: "separate",
    entityOptions: ["Persoonlijk"],
    entityScope: "",
    fEntity: "",
    onFEntityChange: () => {},
    fAccount: "",
    onFAccountChange: () => {},
    fSearch: "",
    onFSearchChange: () => {},
    fFrom: "",
    onFFromChange: () => {},
    fTo: "",
    onFToChange: () => {},
    fCategory: "",
    onFCategoryChange: () => {},
    configured: false,
    onApplyCategories: async () => {},
    onChooseCategory: async () => ({ followers: 0, rulesAdded: 0 }),
    transfers: [],
    suggestions: [],
    onConfirmTransfer: () => {},
    onRejectTransfer: () => {},
  } as unknown as Parameters<typeof Transacties>[0];
  return renderToStaticMarkup(<Transacties {...props} />);
};

test("the Entiteit filter and column are hidden while the entity classifier is archived", async () => {
  expect(await html(false)).not.toMatch(/Entiteit|Entity/);
});

test("the Entiteit filter and column show when the entity classifier is on", async () => {
  expect(await html(true)).toMatch(/Entiteit<\/th>/);
  expect(await html(true)).toMatch(/Entiteit /);
});
