// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { RewardsBalance } from "@lavega/core";
import { makeRewardsBalance } from "@lavega/core";
import Punten, { upsertBalance } from "./views/Punten";

/* Item 4 of the 20-08 review: "I added my points but they got removed again."
 *
 * The mechanism is the add form, and every existing Punten test is blind to it
 * for two reasons: it renders the view with a CONSTANT `balances` prop (so the
 * second action never sees what the first one wrote), and it only ever adds to
 * an EMPTY list (so the destructive branch of `upsertBalance` is never reached
 * through the UI).
 *
 * The real thing: the row's id is the programme name, the form's programme field
 * is pre-filled — with REWARD_PROGRAMS[0] on every mount, and with whatever was
 * saved last after a save — and saving replaces the row with that id outright.
 * So typing a number into a form you did not re-aim overwrites a balance you
 * entered earlier, silently, and takes the reminder interval with it.
 *
 * These tests wire the loop App.tsx actually has: a stateful parent.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASOF = "2026-08-20";
const AMEX = "American Express Membership Rewards";
const FLYING_BLUE = "Flying Blue (KLM/Air France)";

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** What App.tsx is: it owns the list and hands the new one straight back down. */
function Host({ initial }: { initial: RewardsBalance[] }) {
  const [balances, setBalances] = useState<RewardsBalance[]>(initial);
  return <Punten balances={balances} asOf={ASOF} busy={false} onSave={setBalances} />;
}

function render(initial: RewardsBalance[] = []) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Host initial={initial} />));
  return container;
}

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

const programField = () => container!.querySelector<HTMLInputElement>('.punt-form [aria-label="Programma"]')!;
const pointsField = () =>
  container!.querySelector<HTMLInputElement>('.punt-form [aria-label="Punten"]')
  ?? container!.querySelector<HTMLInputElement>('.punt-form [aria-label="Cashback in hele euro\'s"]')!;
/** The form's own save button, whatever it currently calls itself. */
const saveButton = () => container!.querySelector<HTMLButtonElement>(".stack-form-actions .btn-primary")!;
const formNote = () => container!.querySelector(".punt-overwrite")?.textContent ?? "";
const cardFor = (program: string): HTMLElement =>
  [...container!.querySelectorAll<HTMLElement>(".punt-card")].find((n) => (n.textContent ?? "").includes(program))!;
const valueOf = (program: string) => cardFor(program).querySelector(".punt-value")!.textContent;
const interval = (program: string) =>
  container!.querySelector<HTMLSelectElement>(`[aria-label="Herinnering ${program}"]`)!.value;

function addBalance(program: string, points: string) {
  type(programField(), program);
  type(pointsField(), points);
  click(saveButton());
}

/* ── the loss he reported ──────────────────────────────────────────────── */

test("a number typed into a form aimed at an existing programme never silently replaces it", () => {
  // What he had: two balances he entered by hand.
  render([
    makeRewardsBalance({ program: AMEX, points: 245_000, updatedAt: "2026-05-12" }),
    makeRewardsBalance({ program: FLYING_BLUE, points: 60_000, updatedAt: "2026-05-12" }),
  ]);
  // A fresh mount of the view pre-fills the programme field with the first
  // programme in the reference list — a row he already has.
  expect(programField().value).toBe(AMEX);

  // The form must say what is already there before it offers to replace it, and
  // must not call that "Opslaan" — the word for adding something.
  expect(formNote()).toContain("staat al in de lijst");
  expect(formNote()).toContain("245.000");
  expect(formNote()).toContain("12 mei 2026");
  expect(saveButton().textContent).toBe("Overschrijven");
});

test("after a save the form no longer points at the row it just wrote", () => {
  render([]);
  addBalance(AMEX, "245000");
  expect(valueOf(AMEX)).toBe("245.000");
  // The next number typed here is a NEW balance, not an edit of the one above.
  expect(programField().value).toBe("");
  expect(container!.querySelector(".punt-overwrite")).toBeNull();

  // And with nothing named, saving says so instead of writing somewhere.
  type(pointsField(), "60000");
  click(saveButton());
  expect(valueOf(AMEX)).toBe("245.000");
  expect(container!.querySelector(".punt-form .punt-error")!.textContent).toContain("programma");
});

test("adding a second programme leaves the first one alone", () => {
  render([]);
  addBalance(AMEX, "245000");
  addBalance(FLYING_BLUE, "60000");
  expect(container!.querySelectorAll(".punt-card")).toHaveLength(2);
  expect(valueOf(AMEX)).toBe("245.000");
  expect(valueOf(FLYING_BLUE)).toBe("60.000");
});

test("overwriting a balance keeps the reminder interval the owner set", () => {
  render([]);
  addBalance(AMEX, "245000");
  type(container!.querySelector<HTMLSelectElement>(`[aria-label="Herinnering ${AMEX}"]`)!, "30");
  expect(interval(AMEX)).toBe("30");

  addBalance(AMEX, "250000");
  expect(valueOf(AMEX)).toBe("250.000");
  expect(interval(AMEX)).toBe("30"); // his setting, not the 90-day default
});

/* ── the same rule, at the pure level ─────────────────────────────────── */

test("upsertBalance carries the owner's own settings over, and answers the snooze", () => {
  const kept: RewardsBalance = {
    ...makeRewardsBalance({ program: AMEX, points: 245_000, updatedAt: "2026-05-12" }),
    intervalDays: 30,
    snoozedUntil: "2026-09-16",
    note: "saldo uit de Amex-app",
  };
  const next = upsertBalance([kept], makeRewardsBalance({ program: AMEX, points: 250_000, updatedAt: ASOF }));
  expect(next).toHaveLength(1);
  expect(next[0].points).toBe(250_000);
  expect(next[0].updatedAt).toBe(ASOF);
  expect(next[0].intervalDays).toBe(30); // a user-entered fact outranks the default
  expect(next[0].note).toBe("saldo uit de Amex-app");
  expect(next[0].snoozedUntil).toBeUndefined(); // the question has just been answered
});

/* ── the other way an entered balance vanishes ────────────────────────── */

test("a removed balance can be put back — one click never destroys a hand-typed figure", () => {
  render([
    makeRewardsBalance({ program: AMEX, points: 245_000, updatedAt: "2026-05-12" }),
    makeRewardsBalance({ program: FLYING_BLUE, points: 60_000, updatedAt: "2026-05-12" }),
  ]);
  const del = [...cardFor(AMEX).querySelectorAll<HTMLElement>(".card-link-danger")].find(
    (n) => (n.textContent ?? "").includes("Verwijder"),
  )!;
  click(del);
  expect(container!.querySelectorAll(".punt-card")).toHaveLength(1);

  // It says what went, and offers the way back — no confirm dialog, a real undo.
  const undo = container!.querySelector<HTMLButtonElement>(".punt-undo button")!;
  expect(container!.querySelector(".punt-undo")!.textContent).toContain(AMEX);
  click(undo);

  expect(container!.querySelectorAll(".punt-card")).toHaveLength(2);
  expect(valueOf(AMEX)).toBe("245.000");
  expect(container!.querySelector(".punt-undo")).toBeNull();
});

test("the undo keeps the reminder the owner set on the row he removed", () => {
  render([{ ...makeRewardsBalance({ program: AMEX, points: 245_000, updatedAt: "2026-05-12" }), intervalDays: 30 }]);
  click([...cardFor(AMEX).querySelectorAll<HTMLElement>(".card-link-danger")].find((n) => (n.textContent ?? "").includes("Verwijder"))!);
  click(container!.querySelector<HTMLButtonElement>(".punt-undo button")!);
  expect(interval(AMEX)).toBe("30");
});

test("saving something else lets the undo go, so it can never overwrite a newer figure", () => {
  render([makeRewardsBalance({ program: AMEX, points: 245_000, updatedAt: "2026-05-12" })]);
  click([...cardFor(AMEX).querySelectorAll<HTMLElement>(".card-link-danger")].find((n) => (n.textContent ?? "").includes("Verwijder"))!);
  expect(container!.querySelector(".punt-undo")).not.toBeNull();

  addBalance(AMEX, "1000"); // he re-entered it himself
  expect(container!.querySelector(".punt-undo")).toBeNull();
  expect(valueOf(AMEX)).toBe("1.000");
});
