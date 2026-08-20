import { expect, test } from "vitest";
import type { Tx } from "./model.js";
import { detectSubscriptions, subscriptionPriceIncreases, subscriptionOverlaps, subscriptionFunction, subscriptionCoverage, minHistoryDaysFor, merchantKey, CADENCE_LABEL_NL } from "./subscriptions.js";

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
