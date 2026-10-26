// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  ADVICE_LANGUAGE,
  KNOWLEDGE_QUESTIONS,
  RISK_SCALE,
  emptyProfile,
  findAdviceLanguage,
  ownAccounts,
  type Account,
  type AdvisorProfileStore,
  type Tx,
} from "@lavega/core";
import Intake, { type IntakeProps } from "./Intake";
import { intakeCopy } from "../copy/intake";
import {
  applyGoals,
  applyRiskAnswers,
  applyStatedHousing,
  applyStatedSavings,
  applyWorries,
  completeBlock,
  markStep0,
} from "../intake/state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-23";
const NOW = "2026-10-23T10:00:00Z";
let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=en";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

let n = 0;
const tx = (counterparty: string, date: string, amount: number, o: Partial<Tx> = {}): Tx => ({
  id: `t${n++}`,
  accountKey: "A1",
  date,
  amount,
  currency: "EUR",
  counterparty,
  description: "",
  category: "",
  manual: false,
  ...o,
});
const monthly = (
  who: string,
  amount: number,
  day: string,
  from = 1,
  to = 10,
  o: Partial<Tx> = {},
) =>
  Array.from({ length: to - from + 1 }, (_, i) =>
    tx(who, `2026-${String(from + i).padStart(2, "0")}-${day}`, amount, o),
  );

const account = (key: string, o: Partial<Account> = {}): Account => ({
  key,
  iban: "",
  name: key,
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
  ...o,
});

/** Ten months of a plain household: salary, rent, a loan, a subscription. */
function ledger(extra: Tx[] = []) {
  const accounts = [
    account("A1", { name: "Betaalrekening", balance: 900, balanceDate: "2026-10-22" }),
    account("S1", { name: "Spaarrekening", balance: 5000 }),
  ];
  const txs = [
    ...monthly("Acme BV", 3000, "25", 1, 9),
    ...monthly("Woonstichting huur", -1200, "01"),
    ...monthly("DUO", -150, "10"),
    ...monthly("Streamflix", -12.99, "15", 1, 9),
    ...Array.from({ length: 9 }, (_, i) =>
      tx(`Winkel ${i}`, `2026-${String(i + 1).padStart(2, "0")}-20`, -(400 + i * 37)),
    ),
    tx("Winkel 10", "2026-10-12", -80),
    ...extra,
  ];
  return { accounts, txs };
}

const profileAt = (
  build: (p: ReturnType<typeof emptyProfile>) => ReturnType<typeof emptyProfile>,
) => {
  const p = build(emptyProfile());
  return { current: p, versions: [], updatedAt: NOW } as AdvisorProfileStore;
};

function baseProps(o: Partial<IntakeProps> = {}): IntakeProps {
  return {
    accounts: [],
    txs: [],
    rules: [],
    own: ownAccounts([]),
    profiles: [],
    asOf: AS_OF,
    mode: "convert",
    fxHistory: {},
    store: null,
    onSave: vi.fn(async () => {}),
    onNavigate: vi.fn(),
    busy: false,
    entity: "Persoonlijk",
    onEntityChange: () => {},
    onImport: () => {},
    onRefreshBank: () => {},
    homeCountry: "NL",
    onHomeCountryChange: () => {},
    homeRegion: "",
    ownerName: { first: "", last: "" },
    onOwnerNameChange: () => {},
    onHomeRegionChange: () => {},
    now: () => NOW,
    ...o,
  };
}

async function mount(props: IntakeProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Intake {...props} />));
}
async function rerender(props: IntakeProps) {
  await act(async () => root!.render(<Intake {...props} />));
}
async function unmount() {
  await act(async () => root!.unmount());
  container?.remove();
  root = null;
}

const text = () => container!.textContent ?? "";
const buttons = (label: string | RegExp) =>
  [...container!.querySelectorAll("button")].filter((b) =>
    typeof label === "string" ? b.textContent === label : label.test(b.textContent ?? ""),
  );
async function click(label: string | RegExp, index = 0) {
  const b = buttons(label)[index];
  if (!b) throw new Error(`no button ${String(label)} in: ${text().slice(0, 400)}`);
  await act(async () => b.click());
}
async function fill(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
const byLabel = (label: string) => {
  const l = [...container!.querySelectorAll("label")].find((x) => x.textContent === label);
  if (!l) throw new Error(`no label ${label}`);
  return container!.querySelector<HTMLInputElement>(`#${CSS.escape(l.htmlFor)}`)!;
};
const saves = (p: IntakeProps) =>
  (p.onSave as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as AdvisorProfileStore);
const lastSaved = (p: IntakeProps) => saves(p).at(-1)!;

const step0Upload = (extra: Parameters<typeof profileAt>[0] = (p) => p) =>
  profileAt((p) => extra(markStep0(p, "upload")));

test("step 0 offers connect, upload, continue-without; continue-without shows range questions in block 1", async () => {
  const props = baseProps();
  await mount(props);
  expect(text()).toContain("Start with your data");
  expect(buttons("Link bank (Enable Banking)")).toHaveLength(1);
  expect(container!.querySelector('input[type="file"]')).not.toBeNull();
  expect(buttons("Continue without data")).toHaveLength(1);
  expect(text()).toContain("Language and country");

  await click("Continue without data");
  expect(lastSaved(props).current.intake.step0).toBe("none");
  expect(text()).toContain("Your income");
  expect(text()).toContain("Your spending");
  expect(text()).toContain("You have not linked any data");
  expect(container!.querySelector("[data-testid=proposal-card]")).toBeNull();

  await fill(byLabel("From"), "2500");
  await fill(byLabel("to"), "3000");
  await click("Save");
  expect(lastSaved(props).current.statedRanges?.source).toBe("stated");
  expect(lastSaved(props).current.statedRanges?.value.income).toEqual({
    lowCents: 250000,
    highCents: 300000,
  });
});

test("with linked data block 1 shows 'We think ...' cards, each with Confirm / Correct / Not mine and expandable evidence", async () => {
  const { accounts, txs } = ledger();
  await mount(baseProps({ accounts, txs, store: step0Upload() }));
  const cards = [...container!.querySelectorAll("[data-testid=proposal-card]")];
  expect(cards.length).toBeGreaterThanOrEqual(4);
  for (const card of cards) {
    expect(card.textContent).toContain("We think:");
    const labels = [...card.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Confirm", "Correct", "Not mine"]));
  }
  expect(text()).toContain("You receive about");
  expect(text()).toContain("DUO");
  expect(text()).toContain("Your savings accounts add up to");
  const details = cards[0]!.querySelector("details")!;
  expect(details.querySelector("summary")!.textContent).toMatch(/Based on \d+ transactions/);
  expect(details.querySelectorAll("li").length).toBeGreaterThan(0);
});

test("each answer saves immediately (onSave per answer); reopening resumes at the first unfinished block", async () => {
  const { accounts, txs } = ledger();
  const props = baseProps({ accounts, txs, store: step0Upload() });
  await mount(props);
  await click("Confirm", 0);
  expect(saves(props)).toHaveLength(1);
  expect(lastSaved(props).current.incomeStreams?.[0]?.source).toBe("confirmed");
  await click("Not mine", 0);
  expect(saves(props)).toHaveLength(2);
  expect(lastSaved(props).current.removed.length).toBe(1);
  await click("Correct", 0);
  const amount = container!.querySelector<HTMLInputElement>(
    "[data-testid=proposal-card] form input",
  )!;
  await fill(amount, "1111");
  await act(async () =>
    amount.form!.querySelector<HTMLButtonElement>("button[type=submit]")!.click(),
  );
  expect(saves(props)).toHaveLength(3);
  expect(JSON.stringify(lastSaved(props).current)).toContain("111100");

  // Close and reopen on the last saved store: still in block 1.
  await unmount();
  const reopened = baseProps({ accounts, txs, store: lastSaved(props) });
  await mount(reopened);
  expect(text()).toContain("What we found in your data");

  // Finish block 1 through the payoff, close, reopen: block 2.
  await click("Show my room");
  await click("Continue");
  expect(lastSaved(reopened).current.intake.blocksDone).toBe(1);
  expect(text()).toContain("What data cannot show");
  await unmount();
  const again = baseProps({ accounts, txs, store: lastSaved(reopened) });
  await mount(again);
  expect(text()).toContain("What data cannot show");
  expect(text()).not.toContain("What we found in your data");
});

test("a profile saved before block 2 survives a reload (the vault's last put is read back)", async () => {
  const { accounts, txs } = ledger();
  const vault: { put?: AdvisorProfileStore } = {};
  const onSave = vi.fn(async (s: AdvisorProfileStore) => {
    vault.put = s;
  });
  await mount(baseProps({ accounts, txs, store: step0Upload(), onSave }));
  await click("Confirm", 0);
  await click("Show my room");
  await click("Continue");
  await unmount();
  await mount(baseProps({ accounts, txs, store: vault.put ?? null, onSave }));
  expect(text()).toContain("What data cannot show");
  expect(vault.put!.current.incomeStreams?.length).toBe(1);
});

test("fewer than 60 days of data: the card shows the thin-data sentence and the question instead of a proposal", async () => {
  const accounts = [account("A1", { balance: 100, balanceDate: "2026-10-22" })];
  const txs = [tx("Acme BV", "2026-10-01", 3000), tx("Winkel", "2026-10-12", -80)];
  await mount(baseProps({ accounts, txs, store: step0Upload() }));
  expect(text()).toContain("We need about two months of history");
  expect(text()).toContain("there are 11 days so far");
  expect(container!.querySelector("[data-testid=proposal-card]")).toBeNull();
  expect(text()).toContain("Your income");
  expect(text()).toContain("Your home");
});

test("child signal card asks 'Do you have children?' and records only the answer; no signal -> block 2 still asks", async () => {
  const { accounts, txs } = ledger(monthly("SVB Kinderbijslag", 250, "28", 1, 9));
  const props = baseProps({ accounts, txs, store: step0Upload() });
  await mount(props);
  const card = container!.querySelector("[data-testid=child-card]")!;
  expect(card.textContent).toContain("child benefit");
  expect(card.textContent).toContain("Do you have children?");
  const before = saves(props).length;
  await click("Yes");
  expect(saves(props)).toHaveLength(before); // Yes stores nothing: no count, no years
  expect(text()).toContain("You give the number and birth years next.");
  await click("No");
  expect(lastSaved(props).current.children?.value).toEqual([]);
  expect(lastSaved(props).current.children?.source).toBe("stated");
  await unmount();

  // No signal: no child card in block 1, block 2 still asks.
  const plain = ledger();
  const props2 = baseProps({
    accounts: plain.accounts,
    txs: plain.txs,
    store: step0Upload((p) => completeBlock(p, 1)),
  });
  await mount(props2);
  expect(container!.querySelector("[data-testid=child-card]")).toBeNull();
  expect(text()).toContain("Children");
  expect(text()).toContain("No children noted yet.");
  await fill(byLabel("Birth year"), "2019");
  await click("Add child");
  expect(lastSaved(props2).current.children?.value).toEqual([{ id: "child-1", birthYear: 2019 }]);
});

test("end of block 1 shows the room payoff: headline, low-high range, expandable calculation", async () => {
  const { accounts, txs } = ledger();
  await mount(baseProps({ accounts, txs, store: step0Upload() }));
  await click("Show my room");
  const payoff = container!.querySelector("[data-testid=room-payoff]")!;
  expect(payoff.textContent).toContain("Your room each month");
  expect(payoff.querySelector("[data-testid=room-headline]")!.textContent).toMatch(
    /About .*a month/,
  );
  expect(payoff.querySelector("[data-testid=room-range]")!.textContent).toMatch(/Between .* and /);
  const calc = payoff.querySelector("details")!;
  expect(calc.querySelector("summary")!.textContent).toBe("Show the calculation");
  expect(calc.querySelectorAll("li")).toHaveLength(3);
  expect(calc.textContent).toContain("between your own accounts");
});

test("the 'none' room result shows the not-enough-data text; stated ranges give a stated room", async () => {
  await mount(baseProps({ store: profileAt((p) => markStep0(p, "none")) }));
  await click("Show my room");
  expect(container!.querySelector("[data-testid=room-none]")!.textContent).toContain(
    "not have enough data",
  );
  await unmount();

  const store = profileAt((p) => markStep0(p, "none"));
  const props = baseProps({ store });
  await mount(props);
  await fill(byLabel("From"), "2500");
  await fill(byLabel("to"), "3000");
  await click("Save", 0);
  // The spending card is the second range form.
  const forms = [...container!.querySelectorAll("form")];
  await fill(forms[1]!.querySelectorAll("input")[0] as HTMLInputElement, "1800");
  await fill(forms[1]!.querySelectorAll("input")[1] as HTMLInputElement, "2200");
  await act(async () => forms[1]!.querySelector<HTMLButtonElement>("button[type=submit]")!.click());
  await click("Show my room");
  expect(container!.querySelector("[data-testid=room-range]")!.textContent).toMatch(
    /Between .*300.* and .*1,200/,
  );
  expect(container!.querySelector("[data-testid=room-payoff]")!.textContent).toContain(
    "ranges you gave",
  );
});

test("block 2: household, goals and debts save on each add", async () => {
  const props = baseProps({ store: profileAt((p) => completeBlock(markStep0(p, "none"), 1)) });
  await mount(props);
  await click("I live with a partner");
  expect(lastSaved(props).current.household?.value.kind).toBe("together");

  await fill(byLabel("What it is for"), "Car");
  await fill(byLabel("Target amount in euros"), "12000");
  await fill(byLabel("Target date"), "2029-01-01");
  await click("Add goal");
  const goal = lastSaved(props).current.goals?.[0];
  expect(goal?.source).toBe("stated");
  expect(goal?.value).toMatchObject({
    purpose: "Car",
    targetCents: 1_200_000,
    kind: "general",
    priority: "important",
  });

  await fill(byLabel("Owed to"), "Aunt Joke");
  await fill(byLabel("Repayment per month in euros"), "50");
  await click("Add debt");
  expect(lastSaved(props).current.debts?.[0]).toMatchObject({
    lender: "Aunt Joke",
    monthlyCents: 5000,
    source: "stated",
  });

  await fill(container!.querySelector<HTMLSelectElement>("#in-buffer")!, "3");
  expect(lastSaved(props).current.buffer?.value.months).toBe(3);

  await click("Continue");
  expect(lastSaved(props).current.intake.blocksDone).toBe(2);
  expect(text()).toContain("Risk and knowledge");
});

test("block 3: risk items, knowledge items, optional worries; capacity/tolerance disagreement is shown, not resolved", async () => {
  const { accounts, txs } = ledger(
    Array.from({ length: 3 }, (_, i) => tx(`Reis ${i}`, `2026-0${7 + i}-14`, -2500)),
  );
  const store = profileAt((p) =>
    applyGoals(
      applyStatedSavings(
        applyStatedHousing(completeBlock(markStep0(p, "upload"), 2), "rent", 120_000, AS_OF),
        0,
        AS_OF,
      ),
      [
        {
          id: "goal-1",
          purpose: "Trip",
          kind: "general",
          targetCents: 100_000,
          targetDate: "2027-06-01",
          priority: "flexible",
          accountRefs: [],
        },
      ],
      AS_OF,
    ),
  );
  const props = baseProps({ accounts, txs, store });
  await mount(props);
  for (const item of RISK_SCALE.items)
    expect(container!.querySelector(`[data-testid="q-risk-${item.id}"]`)).not.toBeNull();
  for (const q of KNOWLEDGE_QUESTIONS)
    expect(container!.querySelector(`[data-testid="q-know-${q.id}"]`)).not.toBeNull();
  expect(container!.querySelector("textarea")).not.toBeNull();
  expect(text()).toContain("Answer at least four risk questions");

  const pick = async (name: string, value: string) =>
    act(async () =>
      container!
        .querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!
        .click(),
    );
  await pick("risk-loss-20", "buy-more");
  await pick("risk-gain-vs-loss", "big-loss-huge-gain");
  await pick("risk-sleep", "never-worry");
  expect(lastSaved(props).current.risk?.score).toBeUndefined(); // three answers: saved, no score yet
  expect(Object.keys(lastSaved(props).current.risk!.answers)).toHaveLength(3);
  await pick("risk-friend-crash", "invest-more");
  expect(lastSaved(props).current.risk?.score).toBe(5);
  expect(lastSaved(props).current.risk?.answers["sleep"]).toBe("never-worry");
  expect(container!.querySelector("[data-testid=risk-flag]")!.textContent).toContain(
    "two points or more apart",
  );

  expect(buttons("Finish")[0]!.disabled).toBe(true);
  await pick("know-interest", "more-than-102");
  await pick("know-inflation", "buy-less");
  await pick("know-diversification", "lower-risk");
  await act(async () =>
    container!.querySelectorAll<HTMLInputElement>('input[name="invested"]')[1]!.click(),
  );
  await fill(container!.querySelector("textarea")!, "Rising costs");
  await act(async () => {
    container!.querySelector("textarea")!.focus();
    container!.querySelector("textarea")!.blur();
  });
  expect(lastSaved(props).current.worries?.value).toBe("Rising costs");
  await click("Finish");
  const done = lastSaved(props).current;
  expect(done.intake.blocksDone).toBe(3);
  expect(done.knowledge?.value).toMatchObject({ correct: 3, of: 3, investedBefore: false });
  expect(done.experience?.value).toBe("some");
  expect(done.worries?.value).toBe("Rising costs");
  expect(text()).toContain("Your profile is in place");
  await click("To the overview");
  expect(props.onNavigate).toHaveBeenCalledWith("overview");
});

test("block 3 answers survive a reload: risk, knowledge, invested-before, worries", async () => {
  const props = baseProps({ store: profileAt((p) => completeBlock(markStep0(p, "none"), 2)) });
  await mount(props);
  const pick = async (name: string, value: string) =>
    act(async () =>
      container!
        .querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!
        .click(),
    );
  await pick("risk-loss-20", "sell-half");
  await pick("risk-sleep", "rarely-worry");
  await pick("know-interest", "more-than-102");
  await act(async () =>
    container!.querySelectorAll<HTMLInputElement>('input[name="invested"]')[0]!.click(),
  );
  await fill(container!.querySelector("textarea")!, "Rent");
  await act(async () => {
    container!.querySelector("textarea")!.focus();
    container!.querySelector("textarea")!.blur();
  });
  await unmount();

  await mount(baseProps({ store: lastSaved(props) }));
  expect(text()).toContain("Risk and knowledge");
  const checked = (name: string) =>
    container!.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
  expect(checked("risk-loss-20")).toBe("sell-half");
  expect(checked("risk-sleep")).toBe("rarely-worry");
  expect(checked("risk-gain-vs-loss")).toBeUndefined();
  expect(checked("know-interest")).toBe("more-than-102");
  expect(container!.querySelectorAll<HTMLInputElement>('input[name="invested"]')[0]!.checked).toBe(
    true,
  );
  expect(container!.querySelector("textarea")!.value).toBe("Rent");
});

test("block 2 edits never rewrite or drop a corrected block 1 debt", async () => {
  const { accounts, txs } = ledger();
  const props = baseProps({ accounts, txs, store: step0Upload() });
  await mount(props);
  const duoCard = [...container!.querySelectorAll("[data-testid=proposal-card]")].find((c) =>
    c.textContent!.includes("DUO"),
  )!;
  await act(async () =>
    [...duoCard.querySelectorAll("button")].find((b) => b.textContent === "Correct")!.click(),
  );
  const input = duoCard.querySelector<HTMLInputElement>("form input")!;
  await fill(input, "175");
  await act(async () =>
    input.form!.querySelector<HTMLButtonElement>("button[type=submit]")!.click(),
  );
  const corrected = lastSaved(props).current.debts![0]!;
  expect(corrected.evidence?.length).toBeGreaterThan(0);

  await click("Show my room");
  await click("Continue");
  await fill(byLabel("Owed to"), "Aunt Joke");
  await fill(byLabel("Repayment per month in euros"), "50");
  await click("Add debt");
  const debts = lastSaved(props).current.debts!;
  expect(debts).toHaveLength(2);
  expect(debts.find((d) => d.id === corrected.id)).toEqual(corrected);
  // Only the typed debt is listed (and removable) in block 2.
  expect(text()).toContain("Aunt Joke: €50 a month");
  expect(text()).not.toContain("DUO: ");
  await click("Remove", 0);
  expect(lastSaved(props).current.debts).toEqual([corrected]);
});

test("a failed save shows the notice and does not advance; the retry saves", async () => {
  const onSave = vi.fn(async (_s: AdvisorProfileStore): Promise<void> => {
    throw new Error("disk full");
  });
  const props = baseProps({ onSave });
  await mount(props);
  await click("Continue without data");
  expect(text()).toContain("Saving did not work");
  expect(text()).toContain("Start with your data"); // still step 0
  onSave.mockImplementation(async () => {});
  await click("Continue without data");
  expect(text()).not.toContain("Saving did not work");
  expect(text()).toContain("Your income");
});

test("overlapping saves are serialised: a failing first save does not discard the second edit", async () => {
  const persisted: AdvisorProfileStore[] = [];
  let calls = 0;
  const onSave = vi.fn(async (st: AdvisorProfileStore): Promise<void> => {
    calls += 1;
    if (calls === 1) {
      await new Promise((r) => setTimeout(r, 20));
      throw new Error("flaky");
    }
    persisted.push(st);
  });
  const props = baseProps({
    onSave,
    store: profileAt((p) => completeBlock(markStep0(p, "none"), 2)),
  });
  await mount(props);
  await act(async () => {
    container!
      .querySelector<HTMLInputElement>('input[name="risk-sleep"][value="rarely-worry"]')!
      .click();
    container!
      .querySelector<HTMLInputElement>('input[name="risk-loss-20"][value="sell-half"]')!
      .click();
    await new Promise((r) => setTimeout(r, 60));
  });
  const last = persisted.at(-1)!;
  expect(last.current.risk?.answers["loss-20"]).toBe("sell-half");
  // In memory too: a later edit builds on it and still holds the second pick.
  await act(async () =>
    container!
      .querySelector<HTMLInputElement>('input[name="know-interest"][value="more-than-102"]')!
      .click(),
  );
  const after = persisted.at(-1)!;
  expect(after.current.risk?.answers["loss-20"]).toBe("sell-half");
  expect(after.current.knowledge?.value.answers?.["interest"]).toBe("more-than-102");
});

test("clearing the worries text is saved as empty", async () => {
  const store = profileAt((p) =>
    applyWorries(completeBlock(markStep0(p, "none"), 2), "Rent", AS_OF),
  );
  const props = baseProps({ store });
  await mount(props);
  const ta = container!.querySelector("textarea")!;
  await fill(ta, "");
  await act(async () => {
    ta.focus();
    ta.blur();
  });
  expect(lastSaved(props).current.worries?.value).toBe("");
});

test("a bank connect saves step0 = bank BEFORE leaving; coming back lands on block 1", async () => {
  const assign = vi.fn();
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).includes("/api/eb/aspsps"))
      return new Response(JSON.stringify({ aspsps: [{ name: "Testbank", country: "NL" }] }), {
        status: 200,
      });
    return new Response(JSON.stringify({ url: "https://bank.example/auth" }), { status: 200 });
  });
  // jsdom cannot navigate; it reports "not implemented" on the console and carries on.
  vi.spyOn(console, "error").mockImplementation(assign);
  const props = baseProps();
  await mount(props);
  await click("Link bank (Enable Banking)");
  await act(async () => {
    await Promise.resolve();
  });
  await click("Authorise");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(lastSaved(props).current.intake.step0).toBe("bank");
  expect(text()).toContain("Start with your data"); // still on step 0 until the bank sends him back
  await unmount();

  const back = baseProps({ store: lastSaved(props) });
  await mount(back);
  expect(text()).toContain("What we found in your data");
});

test("an upload that adds transactions moves step 0 on by itself", async () => {
  const props = baseProps({ onImport: vi.fn() });
  await mount(props);
  const file = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(file, "files", { value: [new File(["x"], "a.csv")] });
  await act(async () => file.dispatchEvent(new Event("change", { bubbles: true })));
  expect(props.onImport).toHaveBeenCalled();
  expect(text()).toContain("Start with your data");
  const { accounts, txs } = ledger();
  await rerender({ ...props, accounts, txs });
  expect(lastSaved(props).current.intake.step0).toBe("upload");
  expect(text()).toContain("What we found in your data");
});

test("a corrupt stored profile shows a short notice and starts fresh", async () => {
  await mount(baseProps({ corrupt: true }));
  expect(text()).toContain("could no longer be read");
  expect(text()).toContain("Start with your data");
});

test("busy (data still arriving after a bank return) shows loading, not empty questions", async () => {
  await mount(baseProps({ busy: true, store: profileAt((p) => markStep0(p, "bank")) }));
  expect(text()).toContain("Loading your data");
});

/* ---- copy ---------------------------------------------------------------- */

type Tree = Record<string, unknown>;
const money = (e: number) => `€${e}`;
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "function") {
    const out: string[] = [];
    for (const args of [
      [],
      [1],
      ["A"],
      ["A", "B"],
      ["A", "B", "C"],
      ["A", "B", "C", "D"],
      [1, 2, "x"],
      [money],
    ]) {
      try {
        const r = (node as (...a: unknown[]) => unknown)(...args);
        if (typeof r === "string") out.push(r);
      } catch {
        /* wrong shape */
      }
    }
    return out;
  }
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object") return Object.values(node as Tree).flatMap(strings);
  return [];
}

test("no intake copy trips the shared advice-language list (NL and EN)", () => {
  expect(ADVICE_LANGUAGE.length).toBeGreaterThan(0);
  for (const locale of ["nl", "en"] as const) {
    const hits = strings(intakeCopy[locale])
      .map((s) => ({ s, f: findAdviceLanguage(s, locale) }))
      .filter((x) => x.f.length > 0)
      .map((x) => `${x.s} -> ${JSON.stringify(x.f)}`);
    expect(hits).toEqual([]);
  }
});

test("every risk and knowledge item and option has copy in both languages", () => {
  for (const locale of ["nl", "en"] as const) {
    const c = intakeCopy[locale].block3;
    for (const item of RISK_SCALE.items) {
      expect(c.risk.items[item.id], item.id).toBeDefined();
      for (const o of item.options) expect(c.risk.items[item.id]!.options[o.id], o.id).toBeTruthy();
      expect(c.risk.items[item.id]!.prompt(money)).toBeTruthy();
    }
    for (const q of KNOWLEDGE_QUESTIONS) {
      expect(c.knowledge.items[q.id], q.id).toBeDefined();
      for (const o of q.options) expect(c.knowledge.items[q.id]!.options[o.id], o.id).toBeTruthy();
    }
  }
});

test("Dutch renders too: no English key is missing in NL", async () => {
  document.cookie = "lavega_locale=nl";
  await mount(baseProps());
  expect(text()).toContain("Begin met je gegevens");
  await click("Verder zonder gegevens");
  expect(text()).toContain("Je inkomen");
  expect(text()).not.toContain("undefined");
});

test("no Dutch string literal in intake/*.tsx or views/Intake.tsx", () => {
  const dir = join(__dirname, "..", "intake");
  const files = [
    ...readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
      .map((f) => join(dir, f)),
    join(__dirname, "Intake.tsx"),
  ];
  const WORDS = /\b(en|de|het|niet|voor|rekening)\b/i;
  const hits: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
      if (WORDS.test(m[2]!)) hits.push(`${f}: ${m[0]}`);
    }
  }
  expect(hits).toEqual([]);
});

void applyRiskAnswers;
