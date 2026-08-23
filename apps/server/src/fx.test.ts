import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { __resetFxCacheForTests, getFxRate, parseAggregatorPayload } from "./fx.js";

/* De twee lagen, en de vier vragen die erover gesteld moeten worden:
 *   - wint de ECB waar allebei een koers hebben?
 *   - wordt een gat gevuld door de tweede laag?
 *   - is een weggevallen tweede laag weer "geen koers", en niet een oude waarde?
 *   - draagt elke koers zijn herkomst?
 * De modulevariabelen in fx.ts overleven tussen tests, dus elke test begint met
 * een leeg geheugen — anders meet de tweede test de eerste. */

const ECB_JSON = {
  amount: 1,
  base: "EUR",
  date: "2026-08-21",
  rates: { USD: 1.1699, GBP: 0.85 },
};

const AGG_JSON = {
  result: "success",
  provider: "https://www.exchangerate-api.com",
  terms_of_use: "https://www.exchangerate-api.com/terms",
  time_last_update_utc: "Sat, 22 Aug 2026 00:02:31 +0000",
  time_next_update_utc: "Sun, 23 Aug 2026 00:22:21 +0000",
  base_code: "EUR",
  // USD staat er OOK in, met een andere waarde: daarmee is te zien wie er wint.
  rates: { EUR: 1, USD: 1.16819, MAD: 10.789411, AED: 4.290172 },
};

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Beide bronnen op de rol, elk met zijn eigen antwoord of een storing. */
function routes(opts: { ecb?: unknown | "down"; agg?: unknown | "down" }) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    const pick = url.includes("frankfurter") ? opts.ecb : opts.agg;
    if (pick === undefined || pick === "down") throw new Error("bron onbereikbaar");
    return ok(pick);
  });
}

beforeEach(() => __resetFxCacheForTests());
afterEach(() => vi.restoreAllMocks());

test("de ECB wint waar beide lagen een koers hebben", async () => {
  vi.stubGlobal("fetch", routes({ ecb: ECB_JSON, agg: AGG_JSON }));
  const r = await getFxRate();
  // 1.1699 is de ECB, 1.16819 de aggregator. De aggregator overschrijft niet.
  expect(r.rates.USD).toBeCloseTo(1.1699, 6);
  expect(r.origins.USD).toBe("ecb");
  expect(r.layers.ecb).toEqual({ status: "live", date: "2026-08-21", count: 2 });
});

test("de tweede laag vult de gaten en niets anders", async () => {
  vi.stubGlobal("fetch", routes({ ecb: ECB_JSON, agg: AGG_JSON }));
  const r = await getFxRate();
  expect(r.rates.MAD).toBeCloseTo(10.789411, 6);
  expect(r.rates.AED).toBeCloseTo(4.290172, 6);
  expect(r.origins.MAD).toBe("aggregator");
  expect(r.origins.AED).toBe("aggregator");
  // Twee van de ECB, twee gevuld — EUR telt niet mee, dat is de eenheid.
  expect(r.layers.aggregator).toEqual({
    status: "live",
    date: "2026-08-22",
    count: 2,
    provider: "erapi",
    nextUpdate: "2026-08-23",
  });
  expect(r.rates.EUR).toBeUndefined();
  expect(r.origins.EUR).toBeUndefined();
});

test("elke koers draagt een herkomst — geen enkele valt buiten origins", async () => {
  vi.stubGlobal("fetch", routes({ ecb: ECB_JSON, agg: AGG_JSON }));
  const r = await getFxRate();
  const codes = Object.keys(r.rates).sort();
  expect(Object.keys(r.origins).sort()).toEqual(codes);
  for (const c of codes) expect(["ecb", "aggregator"]).toContain(r.origins[c]);
  const counted = r.layers.ecb!.count + r.layers.aggregator!.count;
  expect(counted).toBe(codes.length);
});

test("valt de tweede bron weg, dan is het antwoord weer 'geen koers' — geen oude waarde", async () => {
  vi.stubGlobal("fetch", routes({ ecb: ECB_JSON, agg: AGG_JSON }));
  const first = await getFxRate();
  expect(first.rates.MAD).toBeDefined();

  // Zelfde proces, dus het geheugen van de eerste ronde ligt er nog. Alleen de
  // TTL-cache wordt overgeslagen; dat is precies de situatie waarin een bewaarde
  // aggregatorkoers zich als vers zou voordoen.
  __resetFxCacheForTests();
  vi.stubGlobal("fetch", routes({ ecb: ECB_JSON, agg: "down" }));
  const second = await getFxRate();
  expect(second.rates.MAD).toBeUndefined();
  expect(second.origins.MAD).toBeUndefined();
  expect(second.layers.aggregator).toBeNull();
  expect(second.rates.USD).toBeCloseTo(1.1699, 6);
});

test("de meegebundelde momentopname verdringt een LEVENDE aggregatorkoers niet", async () => {
  vi.stubGlobal("fetch", routes({ ecb: "down", agg: AGG_JSON }));
  const r = await getFxRate();
  // De bundel is een vloer, geen bron. Hij heeft óók een USD (1,1515 van 4
  // augustus); die van vandaag hoort te winnen.
  expect(r.rates.USD).toBeCloseTo(1.16819, 6);
  expect(r.origins.USD).toBe("aggregator");
  // Wat de aggregator NIET heeft mag de bundel wel vullen — met "bundel" erbij,
  // zodat op het scherm te zien is dat die koersen ouder zijn dan de rest.
  expect(r.origins.GBP).toBe("ecb");
  expect(r.layers.ecb).toEqual({ status: "bundel", date: "2026-08-04", count: 9 });
});

test("dekt de aggregator alles, dan is er geen ECB-laag en zegt het antwoord dat ook", async () => {
  // Zo ziet het er in het echt uit: open.er-api's 166 valuta omvatten de 29 van
  // de ECB, dus als de ECB wegvalt houdt de bundel niets over om bij te dragen.
  const dekkend = {
    ...AGG_JSON,
    rates: { EUR: 1, USD: 1.16819, GBP: 0.86, CHF: 0.93, JPY: 171, SEK: 11.3, NOK: 11.7, DKK: 7.46, PLN: 4.27, CAD: 1.59, AUD: 1.75, MAD: 10.79 },
  };
  vi.stubGlobal("fetch", routes({ ecb: "down", agg: dekkend }));
  const r = await getFxRate();
  expect(r.layers.ecb).toBeNull();
  expect(r.date).toBe("2026-08-22");
  expect(new Set(Object.values(r.origins))).toEqual(new Set(["aggregator"]));
});

test("een ECB die deze ronde niet antwoordt valt terug op de vorige ophaal, niet op de bundel", async () => {
  vi.stubGlobal("fetch", routes({ ecb: ECB_JSON, agg: "down" }));
  await getFxRate();

  // Hier mag NIET gereset worden: het ECB-geheugen is juist wat we willen meten.
  // Dus laten we de klok lopen — zes uur verder is de TTL-cache verlopen en wordt
  // er opnieuw opgehaald, nu zonder dat de ECB antwoordt.
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000);
    vi.stubGlobal("fetch", routes({ ecb: "down", agg: AGG_JSON }));
    const r = await getFxRate();
    expect(r.layers.ecb).toEqual({ status: "geheugen", date: "2026-08-21", count: 2 });
    expect(r.rates.USD).toBeCloseTo(1.1699, 6);
    expect(r.origins.USD).toBe("ecb");
  } finally {
    vi.useRealTimers();
  }
});

test("vallen beide bronnen weg op een koude start, dan blijft alleen de bundel over", async () => {
  vi.stubGlobal("fetch", routes({ ecb: "down", agg: "down" }));
  const r = await getFxRate();
  expect(r.layers.ecb?.status).toBe("bundel");
  expect(r.layers.aggregator).toBeNull();
  expect(r.origins.USD).toBe("ecb");
  expect(r.rates.MAD).toBeUndefined();
});

test("een antwoord uit de bundel wordt niet zes uur vastgehouden", async () => {
  const dead = routes({ ecb: "down", agg: "down" });
  vi.stubGlobal("fetch", dead);
  await getFxRate();
  const afterFirst = dead.mock.calls.length;
  await getFxRate();
  // Tweede verzoek doet echt opnieuw een poging in plaats van de storing te cachen.
  expect(dead.mock.calls.length).toBeGreaterThan(afterFirst);
});

test("parseAggregatorPayload weigert wat hij niet kan plaatsen", async () => {
  expect(parseAggregatorPayload(null)).toBeNull();
  expect(parseAggregatorPayload({ ...AGG_JSON, result: "error" })).toBeNull();
  // Een andere base kan niet naast de ECB-laag gelegd worden.
  expect(parseAggregatorPayload({ ...AGG_JSON, base_code: "USD" })).toBeNull();
  // Zonder eigen peildatum kan de koers zijn herkomst niet dragen.
  expect(parseAggregatorPayload({ ...AGG_JSON, time_last_update_utc: "ooit" })).toBeNull();
  // Eén rotte koers kost niet de hele laag, alleen die ene.
  const partial = parseAggregatorPayload({ ...AGG_JSON, rates: { MAD: 10.7, AED: -1, ANG: "nee" } });
  expect(partial?.rates).toEqual({ MAD: 10.7 });
  // Geen opgave van de volgende ronde is null en niet een verzonnen datum.
  expect(parseAggregatorPayload({ ...AGG_JSON, time_next_update_utc: undefined })?.nextUpdate).toBeNull();
});
