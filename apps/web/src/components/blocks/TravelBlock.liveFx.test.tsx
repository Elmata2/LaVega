// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, LearnedFact } from "@lavega/core";
import { makeFact, TRAVEL_AGENT } from "@lavega/core";
import TravelBlock, { type TravelBlockProps } from "./TravelBlock";
import { resetLiveFxForTests } from "../../liveFxRate";
import { ASOF } from "./fixtures";

/* No fresh rate in the vault's history: the block falls back to the rate Valuta
 * already fetches (GET /api/fx/rate, the whole ECB/aggregator table, no
 * parameters). Only ECB-origin rates are used: the aggregator's need a visible
 * credit this block does not carry. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetLiveFxForTests();
  try {
    sessionStorage.clear();
  } catch {
    /* no storage */
  }
});
beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
  resetLiveFxForTests();
});

const accounts: Account[] = [
  {
    key: "ing",
    iban: "NL01INGB0001",
    name: "Zakelijk",
    bank: "ING",
    entity: "Holding BV",
    currency: "EUR",
    balance: 4_000,
    type: "Betaalrekening",
  },
];
const fact = (subject: string, key: string, value: string): LearnedFact =>
  makeFact({ agent: TRAVEL_AGENT, subject, key, value, source: "agent", updatedAt: "2026-08-01" });

const props: TravelBlockProps = {
  accounts,
  txs: [],
  rates: [],
  facts: [fact("ING betaalpas", "fxFeePct", "1.4")],
  catalogue: [],
  asOf: ASOF,
  homeCountry: "NL",
  homeCountryChosen: true,
  busy: false,
  aiAvailable: false,
  onRefreshTerms: () => {},
  onRecheckAi: () => {},
  onCorrectFact: () => {},
  onNavigate: () => {},
};

const LIVE_DATE = "2026-08-14";
const payload = (over: Record<string, unknown> = {}) => ({
  base: "EUR",
  date: LIVE_DATE,
  rates: { NZD: 1.85, JPY: 170, MAD: 10.8 },
  origins: { NZD: "ecb", JPY: "ecb", MAD: "aggregator" },
  layers: {
    ecb: { status: "live", date: LIVE_DATE, count: 2 },
    aggregator: { status: "live", date: LIVE_DATE, count: 1, provider: "erapi", nextUpdate: null },
  },
  ...over,
});

function mockFetch(impl: () => Promise<unknown>) {
  const f = vi.fn(impl);
  vi.stubGlobal("fetch", f);
  return f;
}
const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body });

function setSelect(el: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
async function render(destination: string, over: Partial<TravelBlockProps> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<TravelBlock {...props} {...over} />);
  });
  act(() => setSelect(container!.querySelector("select")!, destination));
  await flush();
  return container;
}
const text = (el: HTMLElement, sel: string) =>
  (el.querySelector(sel)?.textContent ?? "").replace(/ /g, " ");
const buttons = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLButtonElement>(".travel-ccy button"),
];

test("no rate in history and a live ECB rate arrives: switch appears and amounts convert", async () => {
  const f = mockFetch(() => okJson(payload()));
  const el = await render("NZ", { fxHistory: {} });
  expect(f).toHaveBeenCalledTimes(1);
  expect(buttons(el).map((b) => b.textContent)).toEqual(["NZD", "EUR"]);
  expect(text(el, ".travel-winner-headline")).toContain("NZ$");
  const why = text(el, ".travel-winner .toonmeer-panel");
  expect(why).toContain("ECB-koers van 14 aug 2026");
  expect(why).toContain("je kaart rekent zelf in euro af");
});

test("the request carries nothing: no query, no body, no credentials option", async () => {
  const f = mockFetch(() => okJson(payload()));
  await render("NZ", { fxHistory: {} });
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit | undefined];
  expect(url).toMatch(/\/api\/fx\/rate$/);
  expect(init?.body).toBeUndefined();
  expect(init?.method ?? "GET").toBe("GET");
});

test("until the rate arrives the block is in euro, no switch", async () => {
  let release!: (v: unknown) => void;
  mockFetch(() => new Promise((r) => (release = r)));
  const el = await render("NZ", { fxHistory: {} });
  expect(buttons(el)).toHaveLength(0);
  expect(text(el, ".travel-winner-headline")).not.toContain("NZ$");
  await act(async () => {
    release({ ok: true, status: 200, json: async () => payload() });
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(buttons(el)).toHaveLength(2);
});

test("a failed fetch or a 401 leaves euro, no switch, no error shown", async () => {
  mockFetch(() => Promise.reject(new Error("offline")));
  const a = await render("NZ", { fxHistory: {} });
  expect(buttons(a)).toHaveLength(0);
  expect(text(a, ".travel-winner")).not.toContain("NZ$");
  expect(a.querySelector('[role="alert"]')).toBeNull();
  act(() => root!.unmount());
  a.remove();
  root = null;
  resetLiveFxForTests();

  mockFetch(() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) }));
  const b = await render("NZ", { fxHistory: {} });
  expect(buttons(b)).toHaveLength(0);
  expect(b.querySelector('[role="alert"]')).toBeNull();
});

test("one request across re-renders, EUR/NZD switching and changing country", async () => {
  const f = mockFetch(() => okJson(payload()));
  const el = await render("NZ", { fxHistory: {} });
  act(() => root!.render(<TravelBlock {...props} fxHistory={{}} />));
  act(() => buttons(el)[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
  act(() => buttons(el)[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
  act(() => setSelect(el.querySelector("select")!, "JP"));
  await flush();
  act(() => setSelect(el.querySelector("select")!, "NZ"));
  await flush();
  expect(f).toHaveBeenCalledTimes(1);
});

test("a failed fetch is retried at most once more, when the destination changes", async () => {
  const f = mockFetch(() => Promise.reject(new Error("offline")));
  const el = await render("NZ", { fxHistory: {} });
  expect(f).toHaveBeenCalledTimes(1);
  act(() => setSelect(el.querySelector("select")!, "JP"));
  await flush();
  expect(f).toHaveBeenCalledTimes(2);
  act(() => setSelect(el.querySelector("select")!, "NZ"));
  await flush();
  act(() => setSelect(el.querySelector("select")!, "JP"));
  await flush();
  expect(f).toHaveBeenCalledTimes(2);
});

test("a fresh rate in the vault history means no request at all", async () => {
  const f = mockFetch(() => okJson(payload()));
  const el = await render("NZ", { fxHistory: { NZD: { [LIVE_DATE]: 1.9 } } });
  expect(f).not.toHaveBeenCalled();
  expect(buttons(el)).toHaveLength(2);
});

test("a euro destination, or none picked, makes no request", async () => {
  const f = mockFetch(() => okJson(payload()));
  await render("DE", { fxHistory: {} });
  expect(f).not.toHaveBeenCalled();
  act(() => root!.unmount());
  container!.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<TravelBlock {...props} fxHistory={{}} />));
  await flush();
  expect(f).not.toHaveBeenCalled();
});

test("an aggregator-only currency, or a bundled snapshot, is not used", async () => {
  mockFetch(() => okJson(payload()));
  const a = await render("MA", { fxHistory: {} });
  expect(buttons(a)).toHaveLength(0);
  act(() => root!.unmount());
  a.remove();
  root = null;
  resetLiveFxForTests();
  mockFetch(() =>
    okJson(
      payload({
        layers: { ecb: { status: "bundel", date: "2026-08-04", count: 2 }, aggregator: null },
      }),
    ),
  );
  const b = await render("NZ", { fxHistory: {} });
  expect(buttons(b)).toHaveLength(0);
});

test("a rate older than the freshness window is not used", async () => {
  mockFetch(() =>
    okJson(
      payload({
        layers: { ecb: { status: "geheugen", date: "2026-06-01", count: 2 }, aggregator: null },
      }),
    ),
  );
  const el = await render("NZ", { fxHistory: {} });
  expect(buttons(el)).toHaveLength(0);
});

test("unmounting before the response arrives causes no state update", async () => {
  let release!: (v: unknown) => void;
  mockFetch(() => new Promise((r) => (release = r)));
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  await render("NZ", { fxHistory: {} });
  act(() => root!.unmount());
  container!.remove();
  root = null;
  await act(async () => {
    release({ ok: true, status: 200, json: async () => payload() });
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(err).not.toHaveBeenCalled();
});

test("the session's EUR choice survives the rate arriving", async () => {
  sessionStorage.setItem("lavega-travel-ccy", "eur");
  mockFetch(() => okJson(payload()));
  const el = await render("NZ", { fxHistory: {} });
  expect(buttons(el)[1].getAttribute("aria-pressed")).toBe("true");
  expect(text(el, ".travel-winner-headline")).not.toContain("NZ$");
  expect(text(el, ".travel-winner")).not.toContain("omgerekend");
});
