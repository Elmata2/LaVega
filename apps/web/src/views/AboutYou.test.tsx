// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AdvisorProfile,
  ADVICE_LANGUAGE,
  emptyProfile,
  findAdviceLanguage,
  fingerprint,
  RISK_SCALE,
  scoreCapacity,
  type AdvisorProfileStore,
} from "@lavega/core";
import AboutYou, { type AboutYouProps } from "./AboutYou";
import IntakeWizard from "./IntakeWizard";
import { intakeCopy } from "../copy/intake";
import { formatWholeEuroIn } from "../format";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-23";
const NOW = "2026-10-23T10:00:00Z";
let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  document.cookie = "lavega_locale=en";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

const storeOf = (patch: Partial<ConstructorParameters<typeof AdvisorProfile>[0]>) =>
  ({
    current: new AdvisorProfile({ ...emptyProfile(), ...patch }),
    versions: [],
    updatedAt: "2026-10-01T09:00:00Z",
  }) as AdvisorProfileStore;

const noCapacity = scoreCapacity({
  bufferMonths: null,
  roomShare: null,
  debtShare: null,
  horizonYears: null,
});

function baseProps(o: Partial<AboutYouProps> = {}): AboutYouProps {
  return {
    store: null,
    capacity: noCapacity,
    onSave: vi.fn(async () => {}),
    onNavigate: vi.fn(),
    asOf: AS_OF,
    now: () => NOW,
    ...o,
  };
}
async function mount(props: AboutYouProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<AboutYou {...props} />));
}
const text = () => container!.textContent ?? "";
const button = (label: string) => {
  const b = container!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!b) throw new Error(`no button ${label} in: ${text().slice(0, 400)}`);
  return b;
};
const click = (el: HTMLElement) => act(async () => el.click());
async function fill(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, v: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
const lastSaved = (p: AboutYouProps) =>
  (p.onSave as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as AdvisorProfileStore;

const stream = (id: string, label: string, monthlyCents: number) => ({
  value: { id, label, monthlyCents, regular: true },
  source: "derived" as const,
  at: "2026-09-01",
  evidence: [`${id}-a`, `${id}-b`],
});

test("every populated field row shows value, source and date; absent data shows nothing invented", async () => {
  const store = storeOf({
    household: { value: { kind: "alone" }, source: "confirmed", at: "2026-09-02" },
    incomeStreams: [stream("i1", "Acme BV", 300000)],
    savings: { value: { totalCents: 500000 }, source: "stated", at: "2026-09-03" },
  });
  await mount(baseProps({ store }));
  const income = container!.querySelector('[data-testid="fact-incomeStreams:i1"]')!.textContent!;
  expect(income).toContain("Income");
  expect(income).toContain("Acme BV");
  expect(income).toContain("€3,000.00 a month");
  expect(income).toContain("Worked out from your data");
  expect(income).toContain("1 Sep 2026");
  const saving = container!.querySelector('[data-testid="fact-savings"]')!.textContent!;
  expect(saving).toContain("Stated by you");
  expect(saving).toContain("3 Sep 2026");
  expect(container!.querySelectorAll("tbody tr")).toHaveLength(3);
  for (const absent of ["Housing", "Debts", "Goals", "Worries", "Children", "Risk tolerance"]) {
    expect(text()).not.toContain(absent);
  }
});

test("Remove on a derived field stores its fingerprint so the same data is not proposed again", async () => {
  const evidence = ["t1", "t2", "t3"];
  const store = storeOf({
    incomeStreams: [
      {
        value: { id: "inc-1", label: "Acme BV", monthlyCents: 300_000, regular: true },
        source: "derived",
        at: "2026-09-01",
        evidence,
      },
    ],
  });
  const props = baseProps({ store });
  await mount(props);
  await click(button("Remove: Income, Acme BV"));

  const saved = lastSaved(props).current;
  expect(saved.removed).toEqual([fingerprint(evidence)]);
  expect(saved.incomeStreams).toBeUndefined();
  expect(text()).toContain("Nothing is recorded yet");
});

test("Remove on a stated or confirmed field deletes it and suppresses nothing", async () => {
  const store = storeOf({
    savings: { value: { totalCents: 100 }, source: "stated", at: "2026-09-03" },
    housing: {
      value: { kind: "rent", monthlyCents: 90000 },
      source: "confirmed",
      at: "2026-09-03",
      evidence: ["x", "y"],
    },
  });
  const props = baseProps({ store });
  await mount(props);
  await click(button("Remove: Savings"));
  await click(button("Remove: Housing"));
  const saved = lastSaved(props).current;
  expect(saved.savings).toBeUndefined();
  expect(saved.housing).toBeUndefined();
  expect(saved.removed).toEqual([]);
});

test("Edit turns a derived field into stated with a new date", async () => {
  const store = storeOf({ incomeStreams: [stream("i1", "Acme BV", 300000)] });
  const props = baseProps({ store });
  await mount(props);
  await click(button("Edit: Income, Acme BV"));
  const input = container!.querySelector<HTMLInputElement>('input[aria-label="Amount in euros"]')!;
  await fill(input, "3200");
  await click(
    [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Save",
    )!,
  );
  const f = lastSaved(props).current.incomeStreams![0]!;
  expect(f.value.monthlyCents).toBe(320000);
  expect(f.source).toBe("stated");
  expect(f.at).toBe(AS_OF);
  expect(f.value.label).toBe("Acme BV");
  expect(text()).toContain("Stated by you");
  expect(text()).toContain("€3,200.00 a month");
});

test("capacity row is read-only and says computed; no edit control", async () => {
  const store = storeOf({
    savings: { value: { totalCents: 100 }, source: "stated", at: "2026-09-03" },
  });
  await mount(baseProps({ store, capacity: { ...noCapacity, score: 3 } }));
  const cap = container!.querySelector('[data-testid="about-you-capacity"]')!;
  expect(cap.textContent).toContain("3 of 5");
  expect(cap.textContent).toContain("Computed");
  expect(cap.querySelector("button, input, select, textarea")).toBeNull();
});

test("empty profile shows the invite to start the intake, not an empty table", async () => {
  const props = baseProps();
  await mount(props);
  expect(container!.querySelector("table")).toBeNull();
  expect(text()).toContain("Nothing is recorded yet");
  const start = [...container!.querySelectorAll("button")].find(
    (b) => b.textContent === "Start the intake",
  )!;
  await click(start);
  expect(props.onNavigate).toHaveBeenCalledWith("intake");
});

test("worries render as text: a script tag stays literal", async () => {
  const evil = '<script>window.__x=1</script><img src=x onerror="window.__x=1">';
  const store = storeOf({ worries: { value: evil, source: "stated", at: "2026-09-03" } });
  await mount(baseProps({ store }));
  expect(text()).toContain(evil);
  expect(container!.querySelector("script")).toBeNull();
  expect(container!.querySelector("img")).toBeNull();
});

test("a failed save says so and leaves the fact in place", async () => {
  const store = storeOf({
    savings: { value: { totalCents: 100 }, source: "stated", at: "2026-09-03" },
  });
  await mount(baseProps({ store, onSave: vi.fn(async () => Promise.reject(new Error("x"))) }));
  await click(button("Remove: Savings"));
  expect(text()).toContain("This was not saved");
  expect(container!.querySelector('[data-testid="fact-savings"]')).not.toBeNull();
});

test("renders in NL and EN", async () => {
  const store = storeOf({
    savings: { value: { totalCents: 100 }, source: "stated", at: "2026-09-03" },
  });
  await mount(baseProps({ store }));
  expect(text()).toContain("What LaVega knows about you");
  act(() => root!.unmount());
  container!.remove();
  document.cookie = "lavega_locale=nl";
  await mount(baseProps({ store }));
  expect(text()).toContain("Wat LaVega over je weet");
  expect(text()).toContain("Door jou opgegeven");
  expect(text()).not.toContain("undefined");
});

test("no copy trips the shared advice-language list (NL and EN)", () => {
  expect(ADVICE_LANGUAGE.length).toBeGreaterThan(0);
  const money = (n: number) => `€${n}`;
  const strings = (node: unknown): string[] => {
    if (typeof node === "string") return [node];
    if (typeof node === "function") {
      const out: string[] = [];
      for (const args of [[], [1], [1, 2], ["A"], ["A", "B"], ["A", "B", "C"], [money]]) {
        try {
          const r = (node as (...a: unknown[]) => unknown)(...args);
          if (typeof r === "string") out.push(r);
        } catch {
          /* wrong shape */
        }
      }
      return out;
    }
    if (node && typeof node === "object") return Object.values(node).flatMap(strings);
    return [];
  };
  for (const locale of ["nl", "en"] as const) {
    const hits = strings(intakeCopy[locale].aboutYou)
      .map((s) => ({ s, f: findAdviceLanguage(s, locale) }))
      .filter((x) => x.f.length > 0)
      .map((x) => `${x.s} -> ${JSON.stringify(x.f)}`);
    expect(hits).toEqual([]);
    expect(strings(intakeCopy[locale].aboutYou).length).toBeGreaterThan(50);
  }
});

test("no Dutch string literal in AboutYou.tsx or the row builders", () => {
  const files = [
    join(__dirname, "AboutYou.tsx"),
    join(__dirname, "..", "intake", "aboutYouRows.ts"),
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

const done = (answers: Record<string, string>) =>
  storeOf({
    intake: { blocksDone: 3, step0: "none" },
    risk: { answers, scaleId: RISK_SCALE.id, at: "2026-09-04" },
    knowledge: {
      value: { correct: 1, of: 3 },
      source: "stated",
      at: "2026-09-04",
    },
  });

test("Redo on risk reopens block 3 with the answers kept and opens the intake", async () => {
  const item = RISK_SCALE.items[0]!;
  const picked = item.options[0]!.id;
  const store = done({ [item.id]: picked });
  const props = baseProps({ store });
  await mount(props);
  await click(button("Redo these questions: Risk tolerance"));
  const saved = lastSaved(props).current;
  expect(saved.intake.blocksDone).toBe(2);
  expect(saved.risk?.answers).toEqual({ [item.id]: picked });
  expect(props.onNavigate).toHaveBeenCalledWith("intake");

  act(() => root!.unmount());
  container!.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <IntakeWizard
        asOf={AS_OF}
        store={lastSaved(props)}
        onSave={async () => {}}
        onImport={async () => ({ ok: false })}
        onFinish={() => {}}
        onExit={() => {}}
        now={() => NOW}
      />,
    ),
  );
  const first = RISK_SCALE.items[0]!;
  expect(container!.querySelector(`[role=radiogroup]`)?.getAttribute("aria-label")).toBe(
    intakeCopy.en.block3.risk.items[first.id]!.prompt((n) => formatWholeEuroIn("en", n)),
  );
  const checked = container!.querySelector("[role=radio][aria-checked=true]");
  expect(checked?.textContent).toBe(intakeCopy.en.block3.risk.items[first.id]!.options[picked]);
});

test("Redo on knowledge also reopens block 3", async () => {
  const props = baseProps({ store: done({}) });
  await mount(props);
  await click(button("Redo these questions: Knowledge"));
  expect(lastSaved(props).current.intake.blocksDone).toBe(2);
  expect(props.onNavigate).toHaveBeenCalledWith("intake");
});

test("Remove on risk or knowledge lowers blocksDone to 2 so they can be answered again", async () => {
  const props = baseProps({ store: done({}) });
  await mount(props);
  await click(button("Remove: Risk tolerance"));
  expect(lastSaved(props).current.risk).toBeUndefined();
  expect(lastSaved(props).current.intake.blocksDone).toBe(2);

  const props2 = baseProps({ store: done({}) });
  act(() => root!.unmount());
  container!.remove();
  await mount(props2);
  await click(button("Remove: Knowledge"));
  expect(lastSaved(props2).current.knowledge).toBeUndefined();
  expect(lastSaved(props2).current.intake.blocksDone).toBe(2);
});

test("About you shows work and cards rows", async () => {
  const store = storeOf({
    work: { value: ["employed", "student"], source: "stated", at: "2026-09-03" },
    statedCards: { value: ["ing-creditcard", "other"], source: "stated", at: "2026-09-03" },
  });
  const props = baseProps({ store });
  await mount(props);
  const work = container!.querySelector('[data-testid="fact-work"]')!.textContent!;
  expect(work).toContain("Employed, Student");
  const cards = container!.querySelector('[data-testid="fact-statedCards"]')!.textContent!;
  expect(cards).toContain("ING creditcard, Another card");
  expect(cards).not.toContain("ing-creditcard");
  await click(button("Remove: Credit cards"));
  expect(lastSaved(props).current.statedCards).toBeUndefined();
  await click(button("Remove: Work"));
  expect(lastSaved(props).current.work).toBeUndefined();
});

const boxByText = (text: string) =>
  [...container!.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].find(
    (b) => b.textContent === text,
  )!;
const saveBtn = () =>
  [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "Save",
  )!;

test("Edit work toggles the kinds with tiles and saves a stated field", async () => {
  const store = storeOf({
    work: { value: ["employed"], source: "confirmed", at: "2026-09-03" },
  });
  const props = baseProps({ store });
  await mount(props);
  await click(button("Edit: Work"));
  expect(boxByText("Employed").getAttribute("aria-checked")).toBe("true");
  await click(boxByText("Student"));
  await click(boxByText("Employed"));
  await click(saveBtn());
  expect(lastSaved(props).current.work).toEqual({
    value: ["student"],
    source: "stated",
    at: AS_OF,
  });
});

test("Edit credit cards uses the card search and saves a stated list", async () => {
  const store = storeOf({
    statedCards: { value: ["ing-creditcard"], source: "stated", at: "2026-09-03" },
  });
  const props = baseProps({ store });
  await mount(props);
  await click(button("Edit: Credit cards"));
  const search = container!.querySelector<HTMLInputElement>('input[type="search"]')!;
  await fill(search, "amex");
  expect(boxByText("Another card")).toBeDefined();
  await click(boxByText("American Express Gold Card"));
  await click(saveBtn());
  expect(lastSaved(props).current.statedCards).toEqual({
    value: ["american-express-gold-card", "ing-creditcard"],
    source: "stated",
    at: AS_OF,
  });
});

test("About you shows, edits and removes the debit cards row", async () => {
  const store = storeOf({
    statedDebitCards: { value: ["ing-betaalpas", "other"], source: "stated", at: "2026-09-03" },
  });
  const props = baseProps({ store });
  await mount(props);
  const row = container!.querySelector('[data-testid="fact-statedDebitCards"]')!.textContent!;
  expect(row).toContain("Debit cards");
  expect(row).toContain("ING betaalpas, Another card");
  await click(button("Edit: Debit cards"));
  const search = container!.querySelector<HTMLInputElement>('input[type="search"]')!;
  await fill(search, "revolut");
  await click(boxByText("Revolut Plus betaalpas"));
  await click(saveBtn());
  expect(lastSaved(props).current.statedDebitCards).toEqual({
    value: ["ing-betaalpas", "revolut-plus-betaalpas", "other"],
    source: "stated",
    at: AS_OF,
  });
  expect(lastSaved(props).current.statedCards).toBeUndefined();
  await click(button("Remove: Debit cards"));
  expect(lastSaved(props).current.statedDebitCards).toBeUndefined();
});

test("a stated empty card list shows 'No credit card' and Edit then picking clears noCards", async () => {
  const p0 = emptyProfile();
  const store = storeOf({
    statedCards: { value: [], source: "stated", at: "2026-09-03" },
    intake: { ...p0.intake, noCards: true },
  });
  const props = baseProps({ store });
  await mount(props);
  expect(container!.querySelector('[data-testid="fact-statedCards"]')!.textContent).toContain(
    "No credit card",
  );
  await click(button("Edit: Credit cards"));
  await click(boxByText("Another card"));
  await click(saveBtn());
  const saved = lastSaved(props).current;
  expect(saved.statedCards?.value).toEqual(["other"]);
  expect(saved.intake.noCards).toBe(false);
});

test("Remove on the 'No credit card' row clears the Nee flag too", async () => {
  const p0 = emptyProfile();
  const store = storeOf({
    statedCards: { value: [], source: "stated", at: "2026-09-03" },
    intake: { ...p0.intake, noCards: true },
  });
  const props = baseProps({ store });
  await mount(props);
  await click(button("Remove: Credit cards"));
  const saved = lastSaved(props).current;
  expect(saved.statedCards).toBeUndefined();
  expect(saved.intake.noCards).toBeUndefined();
});
