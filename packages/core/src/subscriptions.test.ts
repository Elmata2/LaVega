import { describe, expect, it, test } from "vitest";
import type { Tx } from "./model.js";
import { merchantTallies, detectSubscriptions, subscriptionPriceIncreases, subscriptionOverlaps, subscriptionFunction, subscriptionCoverage, minHistoryDaysFor, merchantKey, CADENCE_LABEL_NL, detectScheduleStreams, fitMerchantStreams } from "./subscriptions.js";

let n = 0;
const tx = (cp: string, date: string, amount: number): Tx =>
  ({ id: String(n++), accountKey: "A1", date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false });

// Netflix monthly, price rose 13,99 -> 15,99
const netflix = [
  tx("Netflix", "2026-01-15", -13.99), tx("Netflix", "2026-02-15", -13.99), tx("Netflix", "2026-03-15", -13.99),
  tx("Netflix", "2026-04-15", -15.99), tx("Netflix", "2026-05-15", -15.99),
];
const hbo = ["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10", "2026-05-10"].map((d) => tx("HBO Max", d, -8.99));
const spotify = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"].map((d) => tx("Spotify AB", d, -10.99));
const adobe = [tx("Adobe Systems", "2025-03-01", -120), tx("Adobe Systems", "2026-03-01", -120)]; // yearly
const oneoff = [tx("Random Store", "2026-01-01", -50), tx("Andere Winkel", "2026-02-02", -20)];

test("detectSubscriptions finds monthly + yearly, normalizes to monthly, tags function", () => {
  const subs = detectSubscriptions([...netflix, ...hbo, ...spotify, ...adobe, ...oneoff]);
  const byName = Object.fromEntries(subs.map((s) => [s.name, s]));
  expect(byName["Netflix"]).toMatchObject({ cadenceDays: 30, monthlyCents: 1599, function: "Videostreaming" });
  expect(byName["Netflix"].changePct).toBeCloseTo(0.143, 2);
  expect(byName["HBO Max"]).toMatchObject({ function: "Videostreaming", monthlyCents: 899 });
  expect(byName["Spotify AB"].function).toBe("Muziekstreaming");
  expect(byName["Adobe Systems"]).toMatchObject({ cadenceDays: 365, function: "Software", monthlyCents: 986 });
  expect(subs.find((s) => s.name === "Random Store")).toBeUndefined(); // not recurring
});

test("subscriptionPriceIncreases flags Netflix's rise, not the flat ones", () => {
  const inc = subscriptionPriceIncreases(detectSubscriptions([...netflix, ...hbo]));
  expect(inc).toHaveLength(1);
  expect(inc[0]).toMatchObject({ fromCents: 1399, toCents: 1599 });
});

test("subscriptionOverlaps flags two videostreaming services, not a lone music one", () => {
  const ov = subscriptionOverlaps(detectSubscriptions([...netflix, ...hbo, ...spotify]));
  expect(ov).toHaveLength(1);
  expect(ov[0].function).toBe("Videostreaming");
  expect(ov[0].subs.map((s) => s.name).sort()).toEqual(["HBO Max", "Netflix"]);
  expect(ov[0].monthlyCents).toBe(1599 + 899);
});

test("subscriptionFunction maps known merchants; unknown -> Overig", () => {
  expect(subscriptionFunction("NETFLIX.COM")).toBe("Videostreaming");
  expect(subscriptionFunction("Vodafone Libertel")).toBe("Mobiel abonnement");
  expect(subscriptionFunction("Onbekende Dienst")).toBe("Overig");
});

test("excludes peer transfers and unstable 2-occurrence streams", () => {
  const transfer = ["2026-01-15", "2026-02-15", "2026-03-15"].map((d) => tx("Overschrijving naar Jan Jansen", d, -100));
  const ibanCp = ["2026-01-15", "2026-02-15", "2026-03-15"].map((d) => tx("NL17INGB0539576085", d, -50));
  const unstable = [tx("Iets Vaags", "2025-03-01", -100), tx("Iets Vaags", "2026-03-01", -40)]; // -60% over a year
  const subs = detectSubscriptions([...transfer, ...ibanCp, ...unstable]);
  expect(subs).toHaveLength(0);
});

/* ── Cadence coverage (UI review round 2, 2026-08-17) ─────────────────────
 *
 * Before this round the bands were monthly (26–36d, 3 occ), quarterly (84–98d,
 * 2 occ) and yearly (350–380d, 2 occ). Quarterly was therefore already visible
 * — the suspected "one-month window" does not exist anywhere in this file — but
 * 37–83 days and 99–349 days matched NO band, so a two-monthly or half-yearly
 * charge could never be seen at all. These tests pin the widened table. */

test("a quarterly subscription is detected from two occurrences", () => {
  const simeo = ["2026-04-05", "2026-07-05"].map((d) => tx("Simeo", d, -74.85));
  const [sub] = detectSubscriptions(simeo);
  expect(sub).toMatchObject({ cadenceDays: 91, occurrences: 2, lastAmountCents: 7485 });
  expect(sub.monthlyCents).toBe(Math.round((7485 * 30) / 91));
});

test("quarterly billing that drifts a few days off 91 still lands in the band", () => {
  // Direct debits shifted to business days: 87 and 95 days apart.
  const drifting = ["2026-01-05", "2026-04-02", "2026-07-06"].map((d) => tx("Simeo", d, -74.85));
  expect(detectSubscriptions(drifting)[0]).toMatchObject({ cadenceDays: 91, occurrences: 3 });
});

test("half-yearly and two-monthly charges are now visible at all", () => {
  const halfYearly = ["2026-01-05", "2026-07-06"].map((d) => tx("Verzekeraar Halfjaar", d, -149.7));
  const twoMonthly = ["2026-03-05", "2026-05-05", "2026-07-05"].map((d) => tx("Tweemaandelijks BV", d, -49.9));
  const subs = detectSubscriptions([...halfYearly, ...twoMonthly]);
  const byName = Object.fromEntries(subs.map((s) => [s.name, s]));
  expect(byName["Verzekeraar Halfjaar"]).toMatchObject({ cadenceDays: 182, occurrences: 2 });
  expect(byName["Verzekeraar Halfjaar"].monthlyCents).toBe(Math.round((14970 * 30) / 182));
  expect(byName["Tweemaandelijks BV"]).toMatchObject({ cadenceDays: 61, occurrences: 3 });
});

test("two-monthly needs three occurrences — two purchases 60 days apart are not a subscription", () => {
  const twice = ["2026-05-05", "2026-07-05"].map((d) => tx("Dezelfde Winkel", d, -49.9));
  expect(detectSubscriptions(twice)).toHaveLength(0);
});

test("minHistoryDaysFor states what each cadence needs before it can be seen", () => {
  expect(minHistoryDaysFor(30)).toBe(60); // three monthly charges = two gaps
  expect(minHistoryDaysFor(61)).toBe(122);
  expect(minHistoryDaysFor(91)).toBe(91); // one quarterly gap
  expect(minHistoryDaysFor(182)).toBe(182);
  expect(minHistoryDaysFor(365)).toBe(365);
  expect(minHistoryDaysFor(7)).toBe(0); // not a cadence we detect
});

test("subscriptionCoverage says which cadences the history can and cannot show", () => {
  // One month of statements: nothing can be recognised yet, and the empty list
  // is explained rather than left as a shrug.
  const oneMonth = ["2026-07-02", "2026-07-20", "2026-07-31"].map((d) => tx("Winkel", d, -20));
  const short = subscriptionCoverage(oneMonth);
  expect(short).toMatchObject({ firstDate: "2026-07-02", lastDate: "2026-07-31", historyDays: 30 });
  expect(short.visibleCadences).toEqual([]);
  expect(short.hiddenCadences).toEqual([
    { cadenceDays: 30, needsDays: 60 },
    { cadenceDays: 61, needsDays: 122 },
    { cadenceDays: 91, needsDays: 91 },
    { cadenceDays: 182, needsDays: 182 },
    { cadenceDays: 365, needsDays: 365 },
  ]);

  // Six months: monthly and quarterly become possible, half-yearly and yearly
  // still cannot be claimed.
  const sixMonths = ["2026-02-01", "2026-07-31"].map((d) => tx("Winkel", d, -20));
  const half = subscriptionCoverage(sixMonths);
  expect(half.historyDays).toBe(181);
  expect(half.visibleCadences).toEqual([30, 61, 91]);
  expect(half.hiddenCadences.map((h) => h.cadenceDays)).toEqual([182, 365]);
});

test("subscriptionCoverage ignores inflows and reports zero history when there are no outflows", () => {
  const inflowsOnly = [tx("Salaris", "2026-01-01", 3000), tx("Salaris", "2026-07-01", 3000)];
  expect(subscriptionCoverage(inflowsOnly)).toMatchObject({ firstDate: "", lastDate: "", historyDays: 0, visibleCadences: [] });
});

test("CADENCE_LABEL_NL names every cadence the detector can return", () => {
  for (const days of [30, 61, 91, 182, 365]) expect(CADENCE_LABEL_NL[days]).toBeTruthy();
});

/* ── Precision round (app review, 2026-08-20) ─────────────────────────────
 *
 * His words: "I have this Simyo transaction that is every month € 11,89, so
 * something goes wrong there. Only the subscription I have should be there."
 * One real monthly subscription mishandled, plus a phantom entry that is not a
 * subscription at all. The tests below pin both halves.
 *
 * The miss and the double are the SAME bug: the detector grouped on the exact
 * normalized counterparty string, and a Dutch bank export does not repeat that
 * string exactly — the incasso reference and the legal form move around. */

test("Simyo: one monthly € 11,89 subscription, though the bank spells it four ways", () => {
  // Realistic ING "Naam / Beschrijving" values for one incasso stream.
  const simyo = [
    tx("SIMYO B.V. 4839201", "2026-05-04", -11.89),
    tx("Simyo B.V.", "2026-06-02", -11.89),
    tx("SIMYO", "2026-07-02", -11.89),
    tx("Simyo B.V. 4931552", "2026-08-03", -11.89),
  ];
  const subs = detectSubscriptions(simyo);
  expect(subs).toHaveLength(1);
  expect(subs[0]).toMatchObject({
    cadenceDays: 30,
    monthlyCents: 1189,
    lastAmountCents: 1189,
    occurrences: 4,
    function: "Mobiel abonnement",
  });
  expect(subs[0].changePct).toBe(0);
});

test("alternating spellings must not become two two-monthly halves of one subscription", () => {
  // The shape that made his monthly € 11,89 look wrong: variant A in the odd
  // months, variant B in the even ones. Grouped on the literal string that is
  // two "tweemaandelijks" streams of € 5,85/mnd — wrong cadence, wrong price,
  // and counted twice in the total.
  const alternating = [
    tx("SIMYO B.V. 8811", "2026-03-02", -11.89),
    tx("Simyo B.V.", "2026-04-02", -11.89),
    tx("SIMYO B.V. 8813", "2026-05-02", -11.89),
    tx("Simyo B.V.", "2026-06-02", -11.89),
    tx("SIMYO B.V. 8815", "2026-07-02", -11.89),
    tx("Simyo B.V.", "2026-08-03", -11.89),
  ];
  const subs = detectSubscriptions(alternating);
  expect(subs).toHaveLength(1);
  expect(subs[0]).toMatchObject({ cadenceDays: 30, monthlyCents: 1189, occurrences: 6 });
});

test("a blank counterparty is never a subscription — and unrelated blanks never merge into one", () => {
  // MT940 rows and ABN fallbacks can leave counterparty empty. All of them used
  // to share the key ""|out, so three unrelated payments became one phantom
  // subscription with an empty name.
  const blanks = [
    tx("", "2026-01-05", -20), tx("", "2026-02-06", -25), tx("", "2026-03-05", -22),
  ];
  expect(detectSubscriptions(blanks)).toHaveLength(0);
});

test("a subscription that stopped months ago is not a current subscription", () => {
  // Cancelled in March; the statements run to August. Nothing is being paid, so
  // nothing belongs in a list of what he pays. `asOf` defaults to the last date
  // in the data (core stays pure — no clock).
  const cancelled = ["2026-01-08", "2026-02-09", "2026-03-09"].map((d) => tx("Vodafone Libertel", d, -17.5));
  const live = ["2026-06-05", "2026-07-05", "2026-08-05"].map((d) => tx("Netflix", d, -15.99));
  const subs = detectSubscriptions([...cancelled, ...live]);
  expect(subs.map((s) => s.function)).toEqual(["Videostreaming"]);
  // Same data, read as if it were March: then Vodafone is the live one.
  const inMarch = detectSubscriptions(cancelled, { asOf: "2026-03-20" });
  expect(inMarch).toHaveLength(1);
  expect(inMarch[0].function).toBe("Mobiel abonnement");
});

test("three ordinary purchases at one shop, a month apart, are not a subscription", () => {
  // Same counterparty, monthly-ish spacing, wildly different amounts. The old
  // amount guard (CV <= 0.6) let this through at € 71,00/mnd.
  const dinners = [
    tx("Restaurant De Kroon", "2026-01-08", -42.5),
    tx("Restaurant De Kroon", "2026-02-05", -18.9),
    tx("Restaurant De Kroon", "2026-03-07", -71),
  ];
  expect(detectSubscriptions(dinners)).toHaveLength(0);
});

test("the roof is not an abonnement: VvE, rent and mortgage belong to Woonlasten", () => {
  const vve = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-03"].map((d) => tx("VvE Lusterhof", d, -142.5));
  const rent = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"].map((d) => tx("Woningstichting Rochdale huur", d, -1450));
  const mortgage = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"].map((d) => tx("ING Hypotheken", d, -980));
  expect(detectSubscriptions([...vve, ...rent, ...mortgage])).toHaveLength(0);
});

test("a fixed monthly payment to a person is a transfer, not a subscription", () => {
  const person = ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-03"].map((d) => tx("J.C. de Vries", d, -250));
  expect(detectSubscriptions(person)).toHaveLength(0);
});

test("merchantKey collapses reference numbers and legal forms, keeps distinct merchants apart", () => {
  expect(merchantKey("SIMYO B.V. 4839201")).toBe(merchantKey("Simyo"));
  expect(merchantKey("NETFLIX.COM 1234")).toBe(merchantKey("Netflix International B.V."));
  expect(merchantKey("Bakkerij Jansen 20260115")).toBe(merchantKey("Bakkerij Jansen"));
  expect(merchantKey("Simyo")).not.toBe(merchantKey("Odido"));
  expect(merchantKey("")).toBe("");
});

test("a subscription on an older statement is still current, judged per account", () => {
  // Two imports of different freshness: the Amex CSV runs to August, the ING one
  // stops at 1 June. Measured against the newest date in the vault, every ING
  // subscription would look cancelled — so each stream is judged against the end
  // of its own statement.
  const ingTx = (d: string, cp: string, a: number): Tx => ({ ...tx(cp, d, a), accountKey: "ING" });
  const amexTx = (d: string, cp: string, a: number): Tx => ({ ...tx(cp, d, a), accountKey: "AMEX" });
  const onIng = ["2026-03-02", "2026-04-02", "2026-05-04"].map((d) => ingTx(d, "SIMYO B.V.", -11.89));
  const ingEnd = [ingTx("2026-06-01", "Albert Heijn", -32.15)];
  const onAmex = ["2026-06-08", "2026-07-08", "2026-08-08"].map((d) => amexTx(d, "Netflix", -15.99));
  const subs = detectSubscriptions([...onIng, ...ingEnd, ...onAmex]);
  expect(subs.map((s) => s.function).sort()).toEqual(["Mobiel abonnement", "Videostreaming"]);
});

test("a known subscription merchant is never re-read as a person or a housing cost", () => {
  // "T.Mobile" has the shape of initials + surname; the dictionary knows better.
  const tmobile = ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-03"].map((d) => tx("T-Mobile", d, -24.5));
  expect(detectSubscriptions(tmobile)).toHaveLength(1);
});

test("a one-off charge from the same merchant is not the monthly price, and not a price change", () => {
  // One incasso stream at € 11,89 plus a single € 10 extra data bundle, which
  // lands last. Grouping per merchant puts them together; the price is the
  // figure that repeats, not whichever row happens to be newest.
  const simyo = [
    tx("SIMYO B.V. 8801", "2026-05-02", -11.89),
    tx("Simyo B.V.", "2026-06-02", -11.89),
    tx("SIMYO B.V. 8803", "2026-07-02", -11.89),
    tx("Simyo B.V.", "2026-08-03", -11.89),
    tx("Simyo extra bundel", "2026-08-14", -10),
  ];
  const [sub] = detectSubscriptions(simyo);
  expect(sub).toMatchObject({ monthlyCents: 1189, lastAmountCents: 1189, firstAmountCents: 1189 });
  expect(subscriptionPriceIncreases([sub])).toEqual([]);
});

test("a company written with initials is not a person — an insurance premium survives", () => {
  const asr = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"].map((d) => tx("A.S.R. Verzekeringen", d, -62.4));
  expect(detectSubscriptions(asr)).toHaveLength(1);
  const person = ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-03"].map((d) => tx("M. van der Meer", d, -300));
  expect(detectSubscriptions(person)).toHaveLength(0);
});

test("a monthly payment to the Belastingdienst is not an abonnement", () => {
  const tax = ["2026-05-27", "2026-06-27", "2026-07-27", "2026-08-27"].map((d) => tx("Belastingdienst Apeldoorn", d, -350));
  expect(detectSubscriptions(tax)).toHaveLength(0);
});

/* ------------------------------------------------------------------------- *
 * detectScheduleStreams — what the Betaalagenda is allowed to expect next.
 * App review 2, item 5: Simyo, gemeentebelasting and DUO were all missing.
 * Measured cause: the agenda ran on the forecast's detectRecurringStreams,
 * which groups on the VERBATIM counterparty and rejects any stream with a
 * skipped cycle. Three real streams shattered into groups of one.
 * ------------------------------------------------------------------------- */

let m = 0;
const flow = (cp: string, date: string, amount: number, description = ""): Tx =>
  ({ id: `f${m++}`, accountKey: "A1", date, amount, currency: "EUR", counterparty: cp, description, category: "", manual: false });

test("de betaalagenda ziet Simyo, ook als de tenaamstelling schuift en juni mist", () => {
  const simyo = [
    flow("SIMYO B.V.", "2026-03-04", -11.89, "SEPA Incasso algemeen doorlopend Machtiging: M0012938"),
    flow("Simyo B.V. 4839201", "2026-04-04", -11.89, "SEPA Incasso algemeen doorlopend"),
    flow("SIMYO", "2026-05-04", -11.89, "Incasso 100238471"),
    // juni: incasso mislukt — één cyclus overgeslagen, geen ander abonnement.
    flow("SIMYO B.V.", "2026-07-04", -11.89, "SEPA Incasso algemeen doorlopend"),
    flow("Simyo B.V.", "2026-08-04", -11.89, "SEPA Incasso algemeen doorlopend"),
  ];
  const streams = detectScheduleStreams(simyo, { asOf: "2026-08-16" });
  expect(streams).toHaveLength(1);
  expect(streams[0]).toMatchObject({
    sign: -1, cadenceDays: 30, amountCents: 1189, occurrences: 5, lastDate: "2026-08-04", skippedCycles: 1,
  });
});

test("gemeentebelasting: de omschrijving maakt de gemeente-afschrijving één stroom", () => {
  const gemeente = [
    flow("Gemeente Amsterdam", "2026-04-28", -47.25, "Gemeentebelastingen aanslag 2026 termijn 3"),
    flow("GEMEENTE AMSTERDAM BELASTINGEN", "2026-05-28", -47.25, "Gemeentebelastingen termijn 4"),
    flow("Gem. Amsterdam Belastingen", "2026-06-29", -47.25, "Gemeentebelastingen termijn 5"),
    flow("Gemeente Amsterdam", "2026-07-28", -47.25, "Gemeentebelastingen termijn 6"),
  ];
  const streams = detectScheduleStreams(gemeente, { asOf: "2026-08-16" });
  expect(streams).toHaveLength(1);
  expect(streams[0]).toMatchObject({ label: "Gemeentebelasting", cadenceDays: 30, amountCents: 4725, sign: -1 });
});

test("DUO is een INKOMENDE maandstroom en hoort net zo goed in het betaalschema", () => {
  const duo = [
    flow("DUO Groningen", "2026-04-24", 487.35, "Studiefinanciering april 2026"),
    flow("DUO", "2026-05-25", 487.35, "Studiefinanciering mei 2026"),
    flow("Dienst Uitvoering Onderwijs", "2026-06-24", 512.1, "Studiefinanciering juni 2026"),
    flow("DUO", "2026-07-24", 512.1, "Studiefinanciering juli 2026"),
    flow("DUO Groningen", "2026-08-24", 512.1, "Studiefinanciering augustus 2026"),
  ];
  const streams = detectScheduleStreams(duo, { asOf: "2026-08-26" });
  expect(streams).toHaveLength(1);
  // Het bedrag is de figuur die de stroom NU herhaalt, niet het oude bedrag.
  expect(streams[0]).toMatchObject({ label: "DUO", sign: 1, cadenceDays: 30, amountCents: 51210, occurrences: 5 });
});

test("een gestopte stroom staat niet meer in het schema", () => {
  const oud = ["2026-01-04", "2026-02-04", "2026-03-04"].map((d) => flow("SIMYO B.V.", d, -11.89));
  expect(detectScheduleStreams(oud, { asOf: "2026-08-16" })).toEqual([]);
});

test("losse aankopen bij dezelfde winkel zijn geen schema-regel", () => {
  const winkel = [
    flow("Albert Heijn 1234", "2026-06-02", -32.15),
    flow("Albert Heijn 1234", "2026-07-04", -18.9),
    flow("Albert Heijn 1234", "2026-08-01", -71.4),
  ];
  expect(detectScheduleStreams(winkel, { asOf: "2026-08-16" })).toEqual([]);
});

test("een regel zonder naam wordt geweigerd, niet als naamloze stroom getoond", () => {
  const naamloos = ["2026-06-04", "2026-07-04", "2026-08-04"].map((d) => flow("", d, -25));
  expect(detectScheduleStreams(naamloos, { asOf: "2026-08-16" })).toEqual([]);
});

/* ── Eén ritme-lezer voor twee detectoren (review 4, antwoord op vraag 1) ───
 *
 * Vijf reviews lang stond zijn Simyo van € 11,89 niet bij de abonnementen. De
 * oorzaak was niet dat de detector stuk was, maar dat er TWEE waren. De
 * Betaalagenda las een gat van 61 dagen als één overgeslagen maand; de
 * abonnementendetectie berekende een variatiecoëfficiënt over alle gaten en
 * kwam op 0,433 uit tegen een grens van 0,4. Dezelfde rijen, twee antwoorden.
 *
 * De gemeten getallen staan in de tests hieronder, met VOOR en NA erbij, want
 * "nu werkt het" is drie keer eerder gezegd terwijl de tests groen stonden. Wat
 * die tests maten was een schone reeks; zijn kluis is dat niet. */

/** De oude poort, letterlijk: mediaan van de gaten in een band + cv <= 0,4.
 *  Staat hier zodat het VOOR-getal in de tests gemeten is en niet onthouden. */
function oudeGate(dates: string[]): { gaps: number[]; cv: number } {
  const d = [...dates].sort();
  const dagen = (a: string, b: string) => {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
  };
  const gaps = d.slice(1).map((x, i) => dagen(d[i], x));
  const gem = gaps.reduce((s, v) => s + v, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, v) => s + (v - gem) ** 2, 0) / (gaps.length - 1));
  return { gaps, cv: sd / gem };
}

test("een gemiste incasso kostte hem het abonnement: cv 0,433 tegen een grens van 0,4", () => {
  const dates = ["2026-05-04", "2026-06-04", "2026-08-04", "2026-09-03"]; // juli mist
  const meting = oudeGate(dates);
  // Dit is het getal uit het onderzoek, hier opnieuw gemeten in plaats van geloofd.
  expect(meting.gaps).toEqual([31, 61, 30]);
  expect(meting.cv).toBeCloseTo(0.433, 3);
  expect(meting.cv).toBeGreaterThan(0.4); // de oude grens — 8% eroverheen

  const simyo = dates.map((d) => tx("SIMYO B.V.", d, -11.89));
  const [sub] = detectSubscriptions(simyo, { asOf: "2026-09-10" });
  expect(sub).toMatchObject({
    cadenceDays: 30, monthlyCents: 1189, occurrences: 4, skippedCycles: 1, function: "Mobiel abonnement",
  });
});

test("Optimalisatie en de Betaalagenda geven op dezelfde rijen hetzelfde antwoord", () => {
  // Dit is het eigenlijke defect: twee functies die naar één reeks keken. Ze
  // delen nu `fitCadence`, dus deze test kan alleen nog falen als iemand er
  // opnieuw een tweede kopie naast zet.
  const rijen = [
    tx("SIMYO B.V.", "2026-03-04", -11.89),
    tx("Simyo B.V. 4839201", "2026-04-04", -11.89),
    tx("SIMYO", "2026-05-04", -11.89),
    // juni: incasso mislukt
    tx("SIMYO B.V.", "2026-07-04", -11.89),
    tx("Simyo B.V.", "2026-08-04", -11.89),
  ];
  const [sub] = detectSubscriptions(rijen, { asOf: "2026-08-16" });
  const [stream] = detectScheduleStreams(rijen, { asOf: "2026-08-16" });
  expect(sub).toBeDefined();
  expect(stream).toBeDefined();
  expect(sub.cadenceDays).toBe(stream.cadenceDays);
  expect(sub.lastAmountCents).toBe(stream.amountCents);
  expect(sub.occurrences).toBe(stream.occurrences);
  expect(sub.skippedCycles).toBe(stream.skippedCycles);
  expect(sub.skippedCycles).toBe(1);
});

test("twee gemiste incasso's mag nog, drie op een rij is een gestopte stroom", () => {
  // De grens is MAX_SKIPPED_CYCLES = 2, en dat is een keuze: één misser is een
  // hapering, twee is pech, drie maanden stilte is opgezegd. Gemeten cv's van
  // de oude poort staan erbij — die weigerde alle drie.
  const tweeGemist = ["2026-05-04", "2026-06-04", "2026-09-03", "2026-10-03"]; // gaten [31, 91, 30]
  expect(oudeGate(tweeGemist).cv).toBeCloseTo(0.689, 3);
  const [sub] = detectSubscriptions(tweeGemist.map((d) => tx("SIMYO B.V.", d, -11.89)), { asOf: "2026-10-10" });
  expect(sub).toMatchObject({ cadenceDays: 30, monthlyCents: 1189, skippedCycles: 2 });

  const drieGemist = ["2026-05-04", "2026-06-04", "2026-10-03", "2026-11-02"]; // gaten [31, 121, 30]
  expect(oudeGate(drieGemist).cv).toBeCloseTo(0.861, 3);
  expect(detectSubscriptions(drieGemist.map((d) => tx("SIMYO B.V.", d, -11.89)), { asOf: "2026-11-10" })).toEqual([]);
});

test("een eenmalige bundel vlak na de incasso sloopte het abonnement, en nu niet meer", () => {
  /* De bestaande test hierboven ("a one-off charge from the same merchant…")
   * zette de bundel 11 dagen na de laatste incasso en stond daarmee 0,014 van
   * de rand: op 9 dagen kwam de cv op 0,433 en verdween het abonnement. Die
   * ene dag mocht niet beslissen of hij zijn telefoonabonnement ziet. */
  const incasso = ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-03"].map((d) => tx("SIMYO B.V.", d, -11.89));
  const negenDagen = [...incasso, tx("Simyo extra bundel", "2026-08-12", -10)];
  expect(oudeGate(negenDagen.map((t) => t.date)).cv).toBeCloseTo(0.433, 3); // VOOR: geweigerd

  const [sub] = detectSubscriptions(negenDagen, { asOf: "2026-08-16" });
  // De bundel hoort niet bij de stroom: hij telt niet mee in de prijs en ook
  // niet in het aantal afschrijvingen.
  expect(sub).toMatchObject({ monthlyCents: 1189, lastAmountCents: 1189, occurrences: 4, skippedCycles: 0 });
});

test("een tweede losse bundel is één zwerver te veel — geweigerd, net als voorheen", () => {
  /* Het budget is `extras <= floor(members / 3)`: minstens drie van elke vier
   * afschrijvingen bij die winkel moeten op het ritme vallen. Bij vier
   * incasso's mag er dus precies één zwerver zijn. Dat is geen versoepeling
   * ten opzichte van vroeger — de oude poort weigerde deze reeks ook (cv
   * 0,567) — maar nu weigert hij om een reden die uit te leggen is. */
  const rijen = [
    ...["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-03"].map((d) => tx("SIMYO B.V.", d, -11.89)),
    tx("Simyo extra bundel", "2026-08-14", -10),
    tx("Simyo extra bundel", "2026-08-20", -10),
  ];
  expect(oudeGate(rijen.map((t) => t.date)).cv).toBeCloseTo(0.567, 3);
  expect(detectSubscriptions(rijen, { asOf: "2026-08-25" })).toEqual([]);
});

test("uit een drukke winkel wordt geen abonnement gesneden", () => {
  /* De prijs van het toestaan van zwervers: als de detector rijen mag
   * overslaan, kan hij in principe een maandritme uit een berg boodschappen
   * knippen. Drie bezoeken van € 42,50, precies een maand uit elkaar, tussen
   * twaalf wekelijkse boodschappenrondes — dat is precies de vorm van een
   * spookabonnement. Het budget weigert hem; dezelfde drie rijen ALLEEN zijn
   * wel een abonnement, en dat verschil is het hele punt: de omringende
   * rijen zijn het bewijs dat dit een winkel is en geen incasso. */
  const wekelijks: Tx[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2026, 4, 2 + i * 7)).toISOString().slice(0, 10);
    wekelijks.push(tx("Albert Heijn 1234", d, -(30 + (i % 5))));
  }
  const maandelijks = ["2026-05-06", "2026-06-05", "2026-07-05"].map((d) => tx("Albert Heijn 1234", d, -42.5));
  expect(detectSubscriptions([...wekelijks, ...maandelijks], { asOf: "2026-07-25" })).toEqual([]);
  expect(detectSubscriptions(maandelijks, { asOf: "2026-07-25" })).toHaveLength(1);
});

test("een toestelaankoop vlak VOOR de incasso pakt niet anders uit dan vlak erna", () => {
  /* De keten pakte de EERSTE rij die binnen de tolerantie viel, en dat hoeft de
   * rij niet te zijn die de incasso IS. Gemeten op vijf schone incasso's van
   * € 11,89 met één toestelaankoop van € 80,00 ernaast:
   *
   *   aankoop 3 dagen NA de junidatum   -> 11,89/mnd   (de incasso stond vooraan)
   *   aankoop 3 dagen VOOR de junidatum -> NIETS        (de aankoop stond vooraan)
   *
   * In het tweede geval kwam de aankoop in de stroom en viel de incasso eruit,
   * en de bedragspreiding die daaruit volgt weigert het hele abonnement. Het
   * verschil tussen die twee uitkomsten zat in de leesvolgorde en nergens
   * anders in — precies dezelfde soort fout als de gemiste incasso: het ritme
   * ligt er, de detector kijkt eroverheen. */
  const cvVan = (cents: number[]) => {
    const gem = cents.reduce((s, c) => s + c, 0) / cents.length;
    return Math.sqrt(cents.reduce((s, c) => s + (c - gem) ** 2, 0) / (cents.length - 1)) / gem;
  };
  // De muur waar hij tegenaan liep, hier gemeten en niet onthouden: de grens
  // op de bedragspreiding is 0,35.
  expect(cvVan([1189, 1189, 8000, 1189, 1189])).toBeCloseTo(1.194, 3);

  const incasso = ["2026-04-02", "2026-05-02", "2026-06-02", "2026-07-02", "2026-08-03"]
    .map((d) => tx("SIMYO B.V.", d, -11.89));
  const ervoor = detectSubscriptions([...incasso, tx("Simyo toestel", "2026-05-29", -80)], { asOf: "2026-08-16" });
  const erna = detectSubscriptions([...incasso, tx("Simyo toestel", "2026-06-05", -80)], { asOf: "2026-08-16" });

  // Beide kanten geven nu hetzelfde antwoord, en het is het juiste: de vijf
  // incasso's zijn de stroom, de aankoop is een zwerver ernaast.
  expect(ervoor).toHaveLength(1); // was: []
  expect(ervoor[0]).toMatchObject({ monthlyCents: 1189, lastAmountCents: 1189, occurrences: 5, skippedCycles: 0 });
  expect(erna[0]).toMatchObject({ monthlyCents: 1189, lastAmountCents: 1189, occurrences: 5, skippedCycles: 0 });
});


/* ------------------------------------------------------------------------- *
 * REEKS H — TWEE MAANDSTROMEN BIJ ÉÉN WINKEL (review 21 aug, 22 aug gebouwd)
 *
 * Zijn melding was diagnostisch: "Simyo staat wel als Abonnementen in
 * Transacties, maar niet als abonnement in Optimalisatie." De categorie matcht
 * op tekst en werkte dus; de detector keek naar het ritme van de hele winkel.
 * Abonnement € 11,89 en toestelkrediet € 25,00, allebei maandelijks, een halve
 * maand uit elkaar. De getallen hieronder zijn gemeten, niet onthouden.
 * ------------------------------------------------------------------------- */

/** Mediaan van de gaten in een reeks datums — het getal waar de OUDE poort een
 *  band mee koos. Staat hier zodat het VOOR-getal in de test gemeten is. */
function mediaanGaten(dates: string[]): { gaps: number[]; mediaan: number } {
  const d = [...dates].sort();
  const dagen = (a: string, b: string) => {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
  };
  const gaps = d.slice(1).map((x, i) => dagen(d[i], x));
  const g = [...gaps].sort((a, b) => a - b);
  const m = g.length >> 1;
  return { gaps, mediaan: g.length % 2 ? g[m] : (g[m - 1] + g[m]) / 2 };
}

/** `fitMerchantStreams` op één winkel, met de rijen op datum gesorteerd zoals
 *  de detector het zelf doet. */
function stromenVan(rijen: Tx[]) {
  const s = [...rijen].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const r = fitMerchantStreams(s.map((t) => t.date), s.map((t) => Math.round(Math.abs(t.amount) * 100)));
  return {
    ...r,
    perStroom: r.streams.map((f) => ({
      cadence: f.band.cadenceDays,
      gaps: f.gaps,
      occ: f.members.length,
      bedragCents: Math.round(Math.abs(s[f.members[0]].amount) * 100),
    })),
  };
}

const reeksH = [
  ...["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-03"].map((d) => tx("SIMYO B.V.", d, -11.89)),
  ...["2026-05-16", "2026-06-17", "2026-07-18", "2026-08-18"].map((d) => tx("Simyo B.V. toestelkrediet", d, -25)),
];

test("reeks H: op de hoop is de mediaan 15 dagen, per bedrag 31 — en dát is het verschil", () => {
  const hoop = mediaanGaten(reeksH.map((t) => t.date));
  expect(hoop.gaps).toEqual([14, 17, 15, 15, 16, 16, 15]);
  expect(hoop.mediaan).toBe(15); // VOOR: leest als tweewekelijks, en dan valt alles af

  const abo = mediaanGaten(reeksH.filter((t) => t.amount === -11.89).map((t) => t.date));
  const toestel = mediaanGaten(reeksH.filter((t) => t.amount === -25).map((t) => t.date));
  expect(abo.gaps).toEqual([31, 30, 32]);
  expect(toestel.gaps).toEqual([32, 31, 31]);
  expect(abo.mediaan).toBe(31);     // NA: twee maandritmes, allebei zuiver
  expect(toestel.mediaan).toBe(31);
});

test("reeks H gaf NIETS en geeft nu twee abonnementen — € 11,89 en € 25,00 per maand", () => {
  /* De tweede muur, na de mediaan: sinds de cyclusfitter (21 aug) vindt de
   * keten de € 11,89-stroom op de hoop wél — vier rijen, gaten 31/30/32 — en
   * gooit hem daarna alsnog weg, want de vier toestelafschrijvingen zijn vier
   * zwervers tegen een budget van floor(4 / 3) = 1. Twee verschillende oorzaken,
   * dezelfde uitkomst: niets. */
  const gesplitst = stromenVan(reeksH);
  expect(gesplitst.splitByAmount).toBe(true);
  expect(gesplitst.strays).toBe(0); // alle acht rijen zitten in een stroom
  expect(gesplitst.perStroom).toEqual([
    { cadence: 30, gaps: [31, 30, 32], occ: 4, bedragCents: 1189 },
    { cadence: 30, gaps: [32, 31, 31], occ: 4, bedragCents: 2500 },
  ]);

  const subs = detectSubscriptions(reeksH, { asOf: "2026-08-25" });
  expect(subs.map((x) => [x.monthlyCents, x.occurrences, x.cadenceDays])).toEqual([
    [2500, 4, 30],
    [1189, 4, 30],
  ]);
  // Twee rijen op het scherm zijn twee sleutels; een gedeelde sleutel is een
  // renderfout en geen detail.
  expect(new Set(subs.map((x) => x.key)).size).toBe(2);
  expect(subs.every((x) => x.merchant === "simyo")).toBe(true);
  // En geen verzonnen prijsverandering: allebei de stromen staan stil.
  expect(subs.map((x) => x.changePct)).toEqual([0, 0]);
});

test("Optimalisatie en de Betaalagenda blijven het eens, ook op reeks H", () => {
  const subs = detectSubscriptions(reeksH, { asOf: "2026-08-25" });
  const schema = detectScheduleStreams(reeksH, { asOf: "2026-08-25" });
  expect(subs).toHaveLength(2);
  expect(schema).toHaveLength(2);
  expect(schema.map((x) => x.amountCents)).toEqual(subs.map((x) => x.lastAmountCents));
  expect(schema.map((x) => x.cadenceDays)).toEqual(subs.map((x) => x.cadenceDays));
  expect(new Set(schema.map((x) => x.key)).size).toBe(2);
});

test("twee stromen bij één winkel zijn geen twee diensten — de dubbelmelding blijft weg", () => {
  /* Zonder deze grendel zou het overzicht "2 × Mobiel abonnement: Simyo +
   * Simyo — één opzeggen scheelt tot € 300 per jaar" afdrukken. Twee onwaarheden
   * in één zin: het zijn geen twee diensten, en een toestelkrediet zeg je niet op. */
  expect(subscriptionOverlaps(detectSubscriptions(reeksH, { asOf: "2026-08-25" }))).toEqual([]);

  // Met een tweede PROVIDER erbij is het wél een dubbeling — en de winkel wordt
  // vertegenwoordigd door zijn KLEINSTE stroom, want dit blok belooft een
  // besparing en niemand weet welke van de twee opzegbaar is.
  const odido = ["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"].map((d) => tx("Odido Netherlands", d, -19.5));
  const [ov] = subscriptionOverlaps(detectSubscriptions([...reeksH, ...odido], { asOf: "2026-08-25" }));
  expect(ov.subs.map((x) => x.monthlyCents).sort((a, b) => a - b)).toEqual([1189, 1950]);
  expect(ov.monthlyCents).toBe(1189 + 1950); // niet 2500 + 1950
});

test("een prijsverhoging wordt niet in tweeën gehakt", () => {
  // € 11,89 wordt € 12,49. Dat is één abonnement dat duurder werd, geen tweede
  // stroom: de oude prijs is opgehouden vóór de nieuwe begon.
  const duurder = [
    ...["2026-03-02", "2026-04-02", "2026-05-02"].map((d) => tx("SIMYO B.V.", d, -11.89)),
    ...["2026-06-02", "2026-07-02", "2026-08-03"].map((d) => tx("SIMYO B.V.", d, -12.49)),
  ];
  const subs = detectSubscriptions(duurder, { asOf: "2026-08-16" });
  expect(subs).toHaveLength(1);
  expect(subs[0]).toMatchObject({ cadenceDays: 30, occurrences: 6, firstAmountCents: 1189, lastAmountCents: 1249 });
  expect(subs[0].changePct).toBeCloseTo(0.05, 3);
  expect(subscriptionPriceIncreases(subs)).toHaveLength(1);

  // Netflix 13,99 -> 15,99 loopt niet eens langs de splitsing: de hele winkel
  // leest al als één maandstroom van vijf, dus er valt niets te winnen.
  expect(stromenVan(netflix).splitByAmount).toBe(false);
});

test("een bedrag dat om en om wisselt blijft één maandstroom", () => {
  /* De gevaarlijke kant van op bedrag groeperen, in de bedrag-dimensie ditmaal:
   * € 2,50 / € 2,55 om en om zou als twee TWEEMAANDELIJKSE stromen van de halve
   * prijs kunnen uitkomen — precies de fout die de wisselende schrijfwijzen ooit
   * maakten. De hele winkel krijgt daarom het eerste woord: de splitsing wordt
   * alleen gebruikt als ze STRIKT meer afschrijvingen verklaart. */
  const wisselend = ["2026-03-02", "2026-04-02", "2026-05-02", "2026-06-02", "2026-07-02", "2026-08-03"]
    .map((d, i) => tx("Kruidvat Winkel", d, i % 2 === 0 ? -2.5 : -2.55));
  const gesplitst = stromenVan(wisselend);
  expect(gesplitst.splitByAmount).toBe(false);
  expect(gesplitst.perStroom).toEqual([{ cadence: 30, gaps: [31, 30, 31, 30, 32], occ: 6, bedragCents: 250 }]);
  expect(detectSubscriptions(wisselend, { asOf: "2026-08-16" })).toMatchObject([{ cadenceDays: 30, occurrences: 6 }]);
});

test("de drukke winkel blijft geweigerd, en dit zijn de aantallen", () => {
  /* De bestaande test hierboven ("uit een drukke winkel wordt geen abonnement
   * gesneden") staat er nog en is groen. Deze zet de rekensom eronder, want op
   * bedrag groeperen maakt het gevaar erger, niet kleiner: de wekelijkse
   * bedragen herhalen zich elke vijf bezoeken, dus de splitsing levert netjes
   * drie schone maandgroepen op — € 30, € 31 en de drie van € 42,50. Het budget
   * wordt daarom over de HELE winkel gelezen en niet per bedrag. */
  const wekelijks: Tx[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2026, 4, 2 + i * 7)).toISOString().slice(0, 10);
    wekelijks.push(tx("Albert Heijn 1234", d, -(30 + (i % 5))));
  }
  const maandelijks = ["2026-05-06", "2026-06-05", "2026-07-05"].map((d) => tx("Albert Heijn 1234", d, -42.5));
  const alles = [...wekelijks, ...maandelijks];

  const gesplitst = stromenVan(alles);
  expect(gesplitst.splitByAmount).toBe(true);
  expect(gesplitst.strays).toBe(6);          // 15 rijen, 9 geclaimd
  expect(alles.length - gesplitst.strays).toBe(9);
  expect(Math.floor(9 / 3)).toBe(3);         // budget 3, en 6 > 3
  expect(gesplitst.streams).toEqual([]);     // dus de hele winkel valt af
  expect(detectSubscriptions(alles, { asOf: "2026-07-25" })).toEqual([]);

  // Dezelfde drie rijen alleen zijn wél een abonnement — dat verschil is het punt.
  expect(detectSubscriptions(maandelijks, { asOf: "2026-07-25" })).toHaveLength(1);
});

test("twee stromen met HETZELFDE bedrag blijven onzichtbaar — een misser, geen leugen", () => {
  /* De grens van deze reparatie, uitgesproken in plaats van weggelaten. Twee
   * sportschoolpassen van allebei € 24,99 zitten in één bedrag-groep en lezen
   * dus weer als één drukke winkel. Ze uit elkaar trekken zou betekenen dat er
   * parallelle ketens uit één stapel identieke afschrijvingen gepeld worden, en
   * dan pelt twintig wekelijkse koffie van € 5,00 uiteen in vier
   * "maandabonnementen". Een misser kost een inzicht; dat zou de tab kosten. */
  const passen = [
    ...["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-03"].map((d) => tx("Basic-Fit", d, -24.99)),
    ...["2026-05-16", "2026-06-17", "2026-07-18", "2026-08-18"].map((d) => tx("Basic-Fit", d, -24.99)),
  ];
  const gesplitst = stromenVan(passen);
  expect(gesplitst.splitByAmount).toBe(false); // één bedrag = één groep = de hele hoop
  expect(gesplitst.strays).toBe(8);
  expect(detectSubscriptions(passen, { asOf: "2026-08-25" })).toEqual([]);
});

test("een prijsverhoging binnen reeks H blijft één stroom die duurder werd", () => {
  // De twee reparaties tegelijk: op bedrag splitsen én de prijsstap weer aan
  // elkaar plakken. € 11,89 x2 wordt € 12,49 x2, en het toestelkrediet loopt er
  // dwars doorheen.
  const rijen = [
    ...["2026-05-02", "2026-06-02"].map((d) => tx("SIMYO B.V.", d, -11.89)),
    ...["2026-07-02", "2026-08-03"].map((d) => tx("SIMYO B.V.", d, -12.49)),
    ...["2026-05-16", "2026-06-17", "2026-07-18", "2026-08-18"].map((d) => tx("Simyo B.V. toestelkrediet", d, -25)),
  ];
  const subs = detectSubscriptions(rijen, { asOf: "2026-08-25" });
  expect(subs).toHaveLength(2);
  const abo = subs.find((x) => x.lastAmountCents === 1249)!;
  expect(abo).toMatchObject({ firstAmountCents: 1189, lastAmountCents: 1249, occurrences: 4, cadenceDays: 30 });
  expect(abo.changePct).toBeCloseTo(0.05, 3);
  expect(subs.find((x) => x.lastAmountCents === 2500)).toMatchObject({ occurrences: 4, changePct: 0 });
});

test("losse aankopen bij één winkel ketenen niet aan elkaar tot een stroom", () => {
  /* De prijs van het samenvoegen van prijsstappen, gemeten voordat hij hem kon
   * melden: vijf losse aankopen van € 1,50 / € 2,50 / € 3,50 / € 4,50 / € 5,50
   * zijn stuk voor stuk één rij, ze overlappen elkaar niet in tijd, en elke stap
   * blijft onder de 0,5. Met alleen die grens werden er vier aan elkaar geplakt
   * en sneed de fitter er een "maandstroom" van drie uit. Die stroom werd verderop
   * geweigerd (geen bedrag komt twee keer voor), maar hij had toen al 3 rijen als
   * geclaimd geteld — en het zwerversbudget rekent met dat getal. Een groep van
   * één mag daarom alleen worden aangevuld met iets binnen 0,1. */
  const echt = [
    ...["2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03"].map((d) => tx("APPLE.COM/BILL", d, -0.99)),
    ...["2026-05-11", "2026-06-11", "2026-07-11", "2026-08-11"].map((d) => tx("APPLE.COM/BILL", d, -10.99)),
    ...["2026-05-20", "2026-06-20", "2026-07-20", "2026-08-20"].map((d) => tx("APPLE.COM/BILL", d, -9.99)),
  ];
  // Drie abonnementen onder één tegenpartij — dat is de winst van op bedrag
  // groeperen buiten Simyo om; op de hoop gaven deze twaalf rijen niets.
  const alleenAbos = detectSubscriptions(echt, { asOf: "2026-08-25" });
  expect(alleenAbos.map((x) => x.monthlyCents)).toEqual([1099, 999, 99]);
  expect(stromenVan(echt).strays).toBe(0);

  const losse = ["2026-05-05", "2026-05-25", "2026-06-14", "2026-07-08", "2026-08-01"]
    .map((d, i) => tx("APPLE.COM/BILL", d, -(1.5 + i)));
  const gemengd = stromenVan([...echt, ...losse]);
  expect(gemengd.strays).toBe(5);            // 17 rijen, 12 geclaimd
  expect(Math.floor(12 / 3)).toBe(4);        // budget 4, en 5 > 4
  expect(gemengd.streams).toEqual([]);       // de winkel valt in zijn geheel af
  expect(detectSubscriptions([...echt, ...losse], { asOf: "2026-08-25" })).toEqual([]);
});

test("de uitkomst hangt niet van de volgorde van de rijen af", () => {
  // Pure functie, dus dit hoort te gelden — en het is de goedkoopste manier om
  // te zien of het groeperen per bedrag ergens op invoervolgorde leunt.
  const basis = JSON.stringify(detectSubscriptions(reeksH, { asOf: "2026-08-25" }));
  let zaad = 7;
  for (let k = 0; k < 25; k++) {
    const r = [...reeksH];
    for (let i = r.length - 1; i > 0; i--) {
      zaad = (zaad * 1103515245 + 12345) % 2147483648;
      const j = zaad % (i + 1);
      [r[i], r[j]] = [r[j], r[i]];
    }
    expect(JSON.stringify(detectSubscriptions(r, { asOf: "2026-08-25" }))).toBe(basis);
  }
});

/* DE METING DIE HET SCHERM MISTE.
 *
 * 22 augustus: 382 dagen afschrift, 813 uitgaande transacties, 286 ontvangers,
 * 85 minstens twee keer betaald, NUL abonnementen. Het scherm kon niet zeggen
 * waarom — en die 286 en 85 werden bovendien op de RUWE tegenpartijtekst geteld,
 * terwijl de detector op merchantKey groepeert na uitsluitingen. Twee
 * groeperingen, dus dat getal beschreef een andere vraag. */
describe("merchantTallies — wat de detector zag, op zijn eigen grondslag", () => {
  const tx = (cp: string, date: string, amount: number): Tx => ({
    id: `${cp}-${date}`, accountKey: "A", date, amount, currency: "EUR",
    counterparty: cp, description: "", category: "", manual: false,
  });

  it("groepeert zoals de detector, dus twee schrijfwijzen zijn één ontvanger", () => {
    const t = merchantTallies([
      tx("Simyo", "2026-01-14", -11.89),
      tx("SIMYO B.V.", "2026-02-14", -11.89),
      tx("simyo", "2026-03-14", -11.89),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0].charges).toBe(3);
    expect(t[0].medianGapDays).toBe(30);
    expect(t[0].amountCv).toBe(0);
    expect(t[0].excluded).toBeNull();
  });

  it("zegt WAAROM een ontvanger de detector niet eens haalt", () => {
    const t = merchantTallies([
      tx("A. Jansen", "2026-01-05", -50),
      tx("A. Jansen", "2026-02-05", -50),
      tx("Woningstichting Rochdale", "2026-01-01", -900),
      tx("Woningstichting Rochdale", "2026-02-01", -900),
    ]);
    const persoon = t.find((x) => x.label.includes("Jansen"))!;
    const huur = t.find((x) => x.label.includes("Rochdale"))!;
    expect(persoon.excluded).toBe("overboeking-of-persoon");
    expect(huur.excluded).toBe("woonlast");
  });

  it("een wild springend bedrag is zichtbaar in de spreiding, niet in een verdict", () => {
    const t = merchantTallies([
      tx("Restaurant De Kade", "2026-01-10", -42.5),
      tx("Restaurant De Kade", "2026-02-11", -18.9),
      tx("Restaurant De Kade", "2026-03-09", -71),
    ]);
    expect(t[0].charges).toBe(3);
    // Gaten: 32 en 26 dagen, dus mediaan 29 — zelf misgerekend, nu nageteld.
    expect(t[0].medianGapDays).toBe(29);
    // Hier zit het antwoord: het ritme klopt bijna, het bedrag niet.
    expect(t[0].amountCv).toBeGreaterThan(0.35);
  });

  it("het grootste totaal staat vooraan, want daar verstopt een abonnement zich", () => {
    const t = merchantTallies([
      tx("Klein Winkeltje", "2026-01-02", -3),
      tx("Klein Winkeltje", "2026-02-02", -3),
      tx("Achmea", "2026-01-24", -142.5),
      tx("Achmea", "2026-02-24", -142.5),
    ]);
    expect(t[0].label).toBe("Achmea");
  });

  it("naamloze rijen worden apart geteld en niet tot één spookontvanger gesmeed", () => {
    const t = merchantTallies([tx("", "2026-01-02", -10), tx("", "2026-02-02", -20)]);
    expect(t).toHaveLength(1);
    expect(t[0].excluded).toBe("geen-naam");
    expect(t[0].merchant).toBe("");
  });
});
