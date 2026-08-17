// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { RewardsBalance } from "@lavega/core";
import { makeRewardsBalance } from "@lavega/core";
import Punten, { programUnit, programCategory, puntenRows, addDaysISO, dateNL } from "./views/Punten";

/* B5 — the Punten tracker.
 *
 * The line these hold: LaVega may say what the owner told it and when, and may
 * say a cashback programme's euro balance (that IS euros). It may never put a
 * euro value on a point, and never a total across programmes.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASOF = "2026-08-17";

const mr = (points: number, updatedAt: string, extra: Partial<RewardsBalance> = {}): RewardsBalance => ({
  ...makeRewardsBalance({ program: "American Express Membership Rewards", points, updatedAt }),
  ...extra,
});
const fb = (points: number, updatedAt: string): RewardsBalance =>
  makeRewardsBalance({ program: "Flying Blue (KLM/Air France)", points, updatedAt });
const bunq = (points: number, updatedAt: string): RewardsBalance =>
  makeRewardsBalance({ program: "bunq", points, updatedAt });

/* ── pure ──────────────────────────────────────────────────────────────── */

test("only a programme documented as paying out in euro's is a euro programme", () => {
  expect(programUnit("bunq")).toBe("eur");
  expect(programUnit("BUNQ")).toBe("eur");
  expect(programUnit("American Express Membership Rewards")).toBe("points");
  expect(programUnit("Marriott Bonvoy")).toBe("points");
  // Something the owner typed himself is points — never guessed into euros.
  expect(programUnit("Spaarzegels van de bakker")).toBe("points");
});

test("a category is only claimed for a programme we actually know", () => {
  expect(programCategory("Flying Blue (KLM/Air France)")).toBe("Airline");
  expect(programCategory("Spaarzegels van de bakker")).toBeNull();
});

test("rows come out in the order they need attention", () => {
  const rows = puntenRows(
    [
      fb(1000, ASOF), // fresh
      mr(200_000, "2026-01-01"), // 228 days -> overdue
      bunq(12, "2026-04-01"), // 138 days -> due (past 90, within 30 of it? no: 48 over -> overdue)
    ],
    ASOF,
  );
  expect(rows.map((r) => r.status.state)).toEqual(["overdue", "overdue", "fresh"]);
  expect(rows[0].balance.program).toContain("American Express"); // oldest first
  expect(rows[2].status.state).toBe("fresh");
});

test("a snoozed row drops behind the ones still being asked", () => {
  const rows = puntenRows(
    [mr(100, "2026-01-01", { snoozedUntil: "2026-12-01" }), fb(1, "2026-01-02")],
    ASOF,
  );
  expect(rows.map((r) => r.status.state)).toEqual(["overdue", "snoozed"]);
});

test("a per-programme interval changes when the row goes stale", () => {
  const monthly = puntenRows([fb(1, "2026-07-01")], ASOF)[0];
  expect(monthly.status.state).toBe("fresh"); // 47 days, default 90
  const strict = puntenRows([{ ...fb(1, "2026-07-01"), intervalDays: 30 }], ASOF)[0];
  expect(strict.status.state).toBe("due");
});

test("addDaysISO and dateNL", () => {
  expect(addDaysISO("2026-08-17", 30)).toBe("2026-09-16");
  expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  expect(dateNL("2026-05-12")).toBe("12 mei 2026");
});

/* ── the view ──────────────────────────────────────────────────────────── */

let root: Root | null = null;
let container: HTMLElement | null = null;
let saved: RewardsBalance[][] = [];

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  saved = [];
});

function render(balances: RewardsBalance[], busy = false) {
  saved = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(<Punten balances={balances} asOf={ASOF} busy={busy} onSave={(next) => saved.push(next)} />),
  );
  return container;
}

const byText = (sel: string, text: string): HTMLElement =>
  [...container!.querySelectorAll<HTMLElement>(sel)].find((n) => (n.textContent ?? "").includes(text))!;

const cardFor = (program: string): HTMLElement => byText(".punt-card", program);

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("a points balance shows the number, the date it came from, and no euro value", () => {
  render([mr(245_000, "2026-05-12")]);
  const card = cardFor("American Express");
  expect(card.querySelector(".punt-value")!.textContent).toBe("245.000");
  expect(card.querySelector(".punt-unit")!.textContent).toBe("punten");
  expect(card.textContent).toContain("Stand van 12 mei 2026");
  expect(card.textContent).toContain("Waarde: niet vast te stellen");
  expect(card.textContent).not.toContain("€");
});

test("cashback in euro's is the one value shown — the balance itself, no rate", () => {
  render([bunq(42, ASOF)]);
  const card = cardFor("bunq");
  expect(card.querySelector(".punt-value")!.textContent).toContain("42,00");
  expect(card.querySelector(".punt-unit")!.textContent).toBe("cashback");
  expect(card.textContent).toContain("geen omrekening");
});

test("nothing on the screen adds two programmes together", () => {
  render([mr(245_000, ASOF), fb(60_000, ASOF)]);
  expect(container!.textContent).toContain("telt programma's niet bij elkaar op");
  expect(container!.textContent).not.toContain("305.000");
});

test("an old balance is flagged, dated, and given the question to answer", () => {
  render([mr(245_000, "2026-01-01")]);
  const card = cardFor("American Express");
  expect(card.className).toContain("punt-overdue");
  expect(card.textContent).toContain("verouderd");
  expect(card.textContent).toContain("228 dagen geleden ingevoerd");
  expect(card.textContent).toContain("over de afgesproken termijn");
});

test("a fresh balance says when it will be asked about, and is not nagged at", () => {
  render([fb(60_000, "2026-08-01")]);
  const card = cardFor("Flying Blue");
  expect(card.textContent).toContain("actueel");
  expect(card.textContent).toContain("vanaf 30 oktober 2026");
  expect(card.textContent).not.toContain("Niet nu");
});

test("answering with just the number stores it and re-dates it to today", () => {
  render([mr(200_000, "2026-01-01")]);
  click(byText(".punt-card .card-link", "Saldo bijwerken"));
  type(container!.querySelector<HTMLInputElement>(".punt-ask input")!, "245k");
  click(byText(".punt-ask .btn-primary", "Opslaan"));
  expect(saved).toHaveLength(1);
  expect(saved[0][0].points).toBe(245_000);
  expect(saved[0][0].updatedAt).toBe(ASOF);
});

test("a reply that is a sentence is refused out loud — nothing is guessed into the vault", () => {
  render([mr(200_000, "2026-01-01")]);
  click(byText(".punt-card .card-link", "Saldo bijwerken"));
  type(container!.querySelector<HTMLInputElement>(".punt-ask input")!, "ergens tussen 240000 en 250000");
  click(byText(".punt-ask .btn-primary", "Opslaan"));
  expect(saved).toHaveLength(0);
  expect(container!.querySelector(".punt-error")!.textContent).toContain("stuur alleen het saldo");
});

test("'Niet nu' snoozes exactly one month and asks nothing in between", () => {
  render([mr(200_000, "2026-01-01")]);
  click(byText(".punt-card .card-link", "Niet nu"));
  expect(saved[0][0].snoozedUntil).toBe("2026-09-16");
});

test("the reminder interval is set per programme", () => {
  render([fb(60_000, "2026-08-01")]);
  type(container!.querySelector<HTMLSelectElement>('[aria-label="Herinnering Flying Blue (KLM/Air France)"]')!, "30");
  expect(saved[0][0].intervalDays).toBe(30);
});

test("a balance can be removed", () => {
  render([fb(60_000, ASOF), mr(1, ASOF)]);
  click(byText(".punt-card .card-link-danger", "Verwijder"));
  expect(saved[0]).toHaveLength(1);
});

test("the add form takes '245k' and refuses text, saying why", () => {
  render([]);
  type(container!.querySelector<HTMLInputElement>('.punt-form [aria-label="Punten"]')!, "geen idee");
  click(byText(".stack-form-actions .btn-primary", "Opslaan"));
  expect(saved).toHaveLength(0);
  expect(container!.querySelector(".punt-error")!.textContent).toContain("geen getal");

  type(container!.querySelector<HTMLInputElement>('.punt-form [aria-label="Punten"]')!, "245k");
  click(byText(".stack-form-actions .btn-primary", "Opslaan"));
  expect(saved[0][0].points).toBe(245_000);
});

test("the add form names the unit of the chosen programme", () => {
  render([]);
  expect(container!.querySelector('.punt-form [aria-label="Punten"]')).toBeTruthy();
  type(container!.querySelector<HTMLInputElement>('.punt-form [aria-label="Programma"]')!, "bunq");
  expect(container!.querySelector('.punt-form [aria-label="Cashback in hele euro\'s"]')).toBeTruthy();
});

test("with nothing tracked the screen explains what to do, and claims nothing", () => {
  render([]);
  expect(container!.querySelector(".empty-guide")!.textContent).toContain("Nog geen punten- of cashback-saldi");
  expect(container!.querySelectorAll(".punt-card")).toHaveLength(0);
  expect(container!.querySelector(".view-head .eyebrow")!.textContent).toBe("0 programma's");
});

test("busy disables every control that would write", () => {
  render([mr(1, "2026-01-01")], true);
  const live = [...container!.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select")];
  expect(live.length).toBeGreaterThan(0);
  expect(live.every((el) => el.disabled)).toBe(true);
});
