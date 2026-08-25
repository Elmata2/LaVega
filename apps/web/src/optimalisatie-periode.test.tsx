// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { Account, Subscription, Tx } from "@lavega/core";
import { ownAccounts } from "@lavega/core";
import Optimalisatie, {
  amountInPeriod,
  subAmountIn,
  subsTotalIn,
  SUB_PERIODS,
} from "./views/Optimalisatie";

/* DE PERIODESCHAKELAAR OP ABONNEMENTEN.
 *
 * Wat dit bestand bewaakt is niet de schakelaar maar wat eronder zit: dat er
 * NERGENS STIL WORDT OMGEREKEND. De twee fouten die hier zaten waren allebei
 * onzichtbaar zolang je alleen naar maandabonnementen keek:
 *
 *   - de kolom "Per jaar" was `monthlyCents × 12`, en `monthlyCents` is bij een
 *     kwartaal- of jaarabonnement zelf al `bedrag × 30 / ritme`. Een
 *     kwartaalabonnement van € 45,00 kwam daardoor uit op € 178,08 per jaar,
 *     terwijl er vier keer € 45,00 = € 180,00 van zijn rekening gaat;
 *   - de prijsstijgingszin rekende elk verschil × 12, ook als het verschil op
 *     een jaarafschrijving zat.
 *
 * Vandaar dat de zware tests hier op een KWARTAALabonnement staan: op een
 * maandabonnement geeft de foute som toevallig het goede antwoord. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNTS: Account[] = [
  { key: "ABN1", iban: "NL01ABNA", name: "Betaalrekening", bank: "ABN AMRO", entity: "Prive", currency: "EUR", balance: 2_500 },
];

const tx = (id: string, date: string, amount: number, counterparty: string): Tx => ({
  id, accountKey: "ABN1", date, amount, currency: "EUR", counterparty, description: "", category: "", manual: false,
});

/** Eén kwartaalabonnement (€ 45,00 per kwartaal) naast één maandabonnement
 *  (€ 17,99 per maand, verhoogd van € 15,99). */
const TXS: Tx[] = [
  tx("q1", "2026-02-05", -45, "Simeo"),
  tx("q2", "2026-05-07", -45, "Simeo"),
  tx("q3", "2026-08-06", -45, "Simeo"),
  tx("n1", "2026-05-08", -15.99, "Netflix"),
  tx("n2", "2026-06-08", -15.99, "Netflix"),
  tx("n3", "2026-07-08", -17.99, "Netflix"),
  tx("n4", "2026-08-08", -17.99, "Netflix"),
];

/** `formatEuro` zet een HARDE spatie tussen het teken en het bedrag, en die
 *  staat ook in de DOM. Eén keer hier, zodat een assertie faalt op wat er staat
 *  en niet op een spatie die je niet ziet. */
const eu = (bedrag: string) => `\u20ac\u00a0${bedrag}`;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(txs: Tx[] = TXS): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const el = host;
  act(() => {
    root = createRoot(el);
    root.render(
      <Optimalisatie
        txs={txs}
        accounts={ACCOUNTS}
        rules={[]}
        own={ownAccounts(ACCOUNTS)}
        asOf="2026-08-16"
        busy={false}
        facts={[]}
        onRateCommit={() => {}}
      />,
    );
  });
  return el;
}

/** De rij van één dienst in de abonnemententabel. */
function row(el: HTMLElement, name: string): HTMLTableRowElement {
  const found = [...el.querySelectorAll<HTMLTableRowElement>("tr")].find(
    (r) => r.querySelector("td")?.textContent === name,
  );
  if (!found) throw new Error(`geen rij voor "${name}"`);
  return found;
}

function schakel(el: HTMLElement, waarde: string) {
  const select = el.querySelector<HTMLSelectElement>('select[aria-label="Eenheid van de abonnementsbedragen"]');
  if (!select) throw new Error("geen periodeschakelaar");
  act(() => {
    select.value = waarde;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/* ── het rekenwerk, zonder render ─────────────────────────────────────────── */

test("naar jaar wordt vermenigvuldigd en naar maand gedeeld — nooit andersom", () => {
  // Een kwartaalbedrag: × 4 naar jaar is exact, ÷ 3 naar maand is onze deling.
  const perJaar = amountInPeriod(4_500, 91, "jaar");
  expect(perJaar).toEqual({ kind: "bedrag", cents: 18_000, derived: true, sum: `4 \u00d7 ${eu("45,00")}` });
  const perMaand = amountInPeriod(4_500, 91, "maand");
  expect(perMaand).toEqual({ kind: "bedrag", cents: 1_500, derived: true, sum: `${eu("45,00")} \u00f7 3` });

  // Dit is wat de oude kolom deed: round(4500 × 30 / 91) × 12 = € 178,08, dus
  // € 1,92 minder dan er werkelijk van zijn rekening gaat.
  expect(Math.round((4_500 * 30) / 91) * 12).toBe(17_808);

  // Een maandabonnement in zijn eigen eenheid is niets omgerekend, en dan hoort
  // er ook geen som onder te staan.
  expect(amountInPeriod(1_799, 30, "maand")).toEqual({ kind: "bedrag", cents: 1_799, derived: false, sum: null });
  expect(amountInPeriod(1_799, 30, "jaar")).toEqual({ kind: "bedrag", cents: 21_588, derived: true, sum: `12 \u00d7 ${eu("17,99")}` });

  // Een jaarabonnement in jaren idem — en het jaarbedrag is exact het bedrag dat
  // is afgeschreven, niet € 118,32.
  expect(amountInPeriod(12_000, 365, "jaar")).toEqual({ kind: "bedrag", cents: 12_000, derived: false, sum: null });
  expect(amountInPeriod(12_000, 365, "maand")).toEqual({ kind: "bedrag", cents: 1_000, derived: true, sum: `${eu("120,00")} \u00f7 12` });

  // "Zoals afgeschreven" rekent per definitie niets om, in geen enkel ritme.
  for (const days of [30, 61, 91, 182, 365]) {
    expect(amountInPeriod(4_500, days, "eigen")).toEqual({ kind: "bedrag", cents: 4_500, derived: false, sum: null });
  }
});

test("een ritme dat we niet kennen wordt niet geraden en telt niet als nul mee", () => {
  const raar = { key: "x", cadenceDays: 45, lastAmountCents: 1_000 } as Subscription;
  expect(amountInPeriod(1_000, 45, "jaar")).toEqual({ kind: "onbekend-ritme", cadenceDays: 45 });
  expect(subAmountIn(raar, "maand")).toEqual({ kind: "onbekend-ritme", cadenceDays: 45 });
  // In zijn eigen eenheid is het bedrag wél bekend — er valt niets om te rekenen.
  expect(subAmountIn(raar, "eigen")).toEqual({ kind: "bedrag", cents: 1_000, derived: false, sum: null });

  // En het totaal zegt dat het een gat heeft in plaats van er stil € 0,00 in te
  // laten zitten.
  const goed = { key: "y", cadenceDays: 30, lastAmountCents: 1_799 } as Subscription;
  expect(subsTotalIn([goed, raar], "maand")).toEqual({ cents: 1_799, unit: "maand", onbekend: 1 });
});

test('een totaal heeft een noemer nodig, dus "zoals afgeschreven" telt per jaar op', () => {
  const kwartaal = { key: "q", cadenceDays: 91, lastAmountCents: 4_500 } as Subscription;
  const maand = { key: "m", cadenceDays: 30, lastAmountCents: 1_799 } as Subscription;
  // € 45,00 en € 17,99 optellen zou € 62,99 "van iets" zijn; per jaar zijn het
  // 4 × € 45,00 + 12 × € 17,99 = € 395,88.
  expect(subsTotalIn([kwartaal, maand], "eigen")).toEqual({ cents: 39_588, unit: "jaar", onbekend: 0 });
  expect(subsTotalIn([kwartaal, maand], "jaar")).toEqual({ cents: 39_588, unit: "jaar", onbekend: 0 });
  expect(subsTotalIn([kwartaal, maand], "maand")).toEqual({ cents: 1_500 + 1_799, unit: "maand", onbekend: 0 });
  expect(SUB_PERIODS.map((p) => p.label)).toEqual(["Zoals afgeschreven", "Per maand", "Per jaar"]);
});

/* ── en op het scherm ─────────────────────────────────────────────────────── */

test("de schakelaar verandert de eenheid, niet wat er is afgeschreven", () => {
  const el = mount();

  // Opent op "per maand", de stand waarin dit scherm altijd stond.
  expect(row(el, "Simeo").textContent).toContain(eu("15,00"));
  expect(row(el, "Simeo").textContent).toContain(`${eu("45,00")} \u00f7 3`);
  expect(row(el, "Netflix").textContent).toContain(eu("17,99"));

  schakel(el, "jaar");
  // Vier × € 45,00, en niet de € 178,08 van de oude kolom.
  expect(row(el, "Simeo").textContent).toContain(eu("180,00"));
  expect(row(el, "Simeo").textContent).toContain(`4 \u00d7 ${eu("45,00")}`);
  expect(row(el, "Simeo").textContent).not.toContain("178,08");
  expect(row(el, "Netflix").textContent).toContain(eu("215,88"));

  schakel(el, "eigen");
  expect(row(el, "Simeo").textContent).toContain(eu("45,00"));
  expect(row(el, "Simeo").textContent).not.toContain("÷");
  expect(row(el, "Netflix").textContent).toContain(eu("17,99"));

  // IN ELKE STAND staat er wat er werkelijk is afgeschreven, met het ritme erbij.
  for (const stand of ["maand", "jaar", "eigen"]) {
    schakel(el, stand);
    const cel = row(el, "Simeo").querySelectorAll("td")[3];
    expect(cel.textContent, `stand ${stand}`).toContain(eu("45,00"));
    expect(cel.textContent, `stand ${stand}`).toContain("per kwartaal");
  }
});

test("wat er is omgerekend staat geteld in het label, en de som per rij erin", () => {
  const el = mount();
  const regel = () =>
    [...el.querySelectorAll<HTMLDetailsElement>("details.toonmeer")].find((d) =>
      d.querySelector("summary")?.textContent?.includes("omgerekend uit een ander ritme"),
    ) ?? null;

  // Per maand is alleen het kwartaalabonnement gedeeld; het maandbedrag niet.
  const perMaand = regel();
  expect(perMaand?.querySelector("summary")?.textContent).toBe(
    "1 van de 2 bedragen is omgerekend uit een ander ritme",
  );
  // Opgevouwen, niet weg: de som staat in het paneel en de regel is dicht.
  expect(perMaand?.open).toBe(false);
  expect(perMaand?.textContent).toContain(`${eu("45,00")} per kwartaal \u2192 ${eu("45,00")} \u00f7 3 = ${eu("15,00")} per maand`);

  // Per jaar zijn ze allebei vermenigvuldigd.
  schakel(el, "jaar");
  expect(regel()?.querySelector("summary")?.textContent).toBe(
    "2 van de 2 bedragen zijn omgerekend uit een ander ritme",
  );

  // En "zoals afgeschreven" rekent niets om, dus er is geen regel die iets
  // belooft wat het paneel niet levert.
  schakel(el, "eigen");
  expect(regel()).toBeNull();
});

test("een prijsstijging wordt niet meer blind × 12 gerekend", () => {
  const el = mount();
  const zin = () =>
    [...el.querySelectorAll("p.reason")].find((p) => p.textContent?.includes("Netflix"))?.textContent ?? "";

  // € 15,99 → € 17,99 op een MAANDafschrijving: € 2,00 per maand.
  expect(zin()).toContain(eu("2,00"));
  expect(zin()).toContain("per maand extra");

  schakel(el, "jaar");
  expect(zin()).toContain(eu("24,00"));
  expect(zin()).toContain("per jaar extra");
  expect(zin()).toContain(`12 \u00d7 ${eu("2,00")}`);
});

test("een stijging op een KWARTAALafschrijving is vier keer per jaar, niet twaalf", () => {
  // Dit is de rij waar de oude zin twaalf keer te veel meldde.
  // Vier kwartaalafschrijvingen: € 45,00 twee keer, dan € 55,00 twee keer. Allebei
  // de bedragen moeten HERHALEN, anders leest de detector de laatste rij als een
  // eenmalige en is er geen prijsstijging (zie `repeats` in subscriptions.ts).
  const el = mount([
    tx("q1", "2025-11-05", -45, "Simeo"),
    tx("q2", "2026-02-05", -45, "Simeo"),
    tx("q3", "2026-05-07", -55, "Simeo"),
    tx("q4", "2026-08-06", -55, "Simeo"),
  ]);
  const zin = () =>
    [...el.querySelectorAll("p.reason")].find((p) => p.textContent?.includes("Simeo"))?.textContent ?? "";
  schakel(el, "jaar");
  // € 10,00 meer per kwartaal is € 40,00 per jaar. De oude som zei € 120,00.
  expect(zin()).toContain(eu("40,00"));
  expect(zin()).not.toContain(eu("120,00"));
});
