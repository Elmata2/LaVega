// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  computeRoom,
  findAdviceLanguage,
  ownAccounts,
  type Account,
  type AdvisorProfileStore,
  type RoomResult,
  type Tx,
  emptyProfile,
} from "@lavega/core";
import RoomCard, { RoomCardWidget } from "./RoomCard";
import { intakeCopy } from "../../copy/intake";
import { setEnabledWidgets, WIDGETS } from "../moduleRegistry";
import { markDone } from "../../intake/wizard/screens";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}
const text = () => container!.textContent ?? "";

const computed = (o: Partial<Extract<RoomResult, { kind: "computed" }>> = {}): RoomResult => ({
  kind: "computed",
  months: [
    { month: "2026-09", incomingCents: 300000, outgoingCents: 280000, netCents: 20000 },
    { month: "2026-08", incomingCents: 300000, outgoingCents: 250000, netCents: 50000 },
    { month: "2026-07", incomingCents: 300000, outgoingCents: 200000, netCents: 100000 },
  ],
  middleCents: 50000,
  middleIncomeCents: 300000,
  lowCents: 20000,
  highCents: 100000,
  partial: false,
  excludedForeignCount: 0,
  blockingAccounts: [],
  ...o,
});

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
let n = 0;
const tx = (date: string, amount: number, o: Partial<Tx> = {}): Tx => ({
  id: `t${n++}`,
  accountKey: "A1",
  date,
  amount,
  currency: "EUR",
  counterparty: amount > 0 ? "Employer" : "Shop",
  description: "",
  category: "",
  manual: false,
  ...o,
});
const roomOf = (
  txs: Tx[],
  accounts: Account[],
  profiles: Parameters<typeof computeRoom>[0]["profiles"] = [],
) =>
  computeRoom({
    txs,
    accounts,
    profiles,
    rules: [],
    own: ownAccounts(accounts),
    asOf: "2026-10-23",
    mode: "convert",
    fxHistory: {},
  });

test("block 1 done -> headline, low-high range and an expandable calculation", () => {
  mount(<RoomCard result={computed()} onOpenIntake={() => {}} />);
  expect(container!.querySelector("[data-testid=room-headline]")!.textContent).toBe(
    "About €500 a month",
  );
  expect(container!.querySelector("[data-testid=room-range]")!.textContent).toBe(
    "Between €200 and €1,000",
  );
  const details = container!.querySelector("details")!;
  expect(details.querySelector("summary")!.textContent).toBe("Show the calculation");
  expect(details.textContent).toContain("received €3,000, spent €2,800, left €200");
});

test("the card links back to the intake", () => {
  const open = vi.fn();
  mount(<RoomCard result={computed()} onOpenIntake={open} />);
  const b = [...container!.querySelectorAll("button")].find(
    (x) => x.textContent === "Change your answers",
  )!;
  act(() => b.click());
  expect(open).toHaveBeenCalledTimes(1);
});

test("none -> not enough data and a link to import", () => {
  const onImport = vi.fn();
  mount(
    <RoomCard
      result={{ kind: "none", reason: "no-data" }}
      onOpenIntake={() => {}}
      onImport={onImport}
    />,
  );
  expect(text()).toContain("We do not have enough data yet to work out your room.");
  const b = [...container!.querySelectorAll("button")].find((x) =>
    x.textContent?.includes("import"),
  )!;
  act(() => b.click());
  expect(onImport).toHaveBeenCalledTimes(1);
});

test("partial -> says fewer than three months were used and names the blocking account", () => {
  mount(
    <RoomCard
      result={computed({
        partial: true,
        blockingAccounts: [{ id: "B1", reason: "short", since: "2026-09" }],
      })}
      accounts={[account("B1", { name: "Revolut Joint" })]}
      onOpenIntake={() => {}}
    />,
  );
  expect(text()).toContain("Fewer than three full months were available");
  expect(container!.querySelector("[data-testid=room-blocking]")!.textContent).toBe(
    "Revolut Joint only has data since Sep 2026; the room uses fewer months until there are three full ones.",
  );
});

test("none from stale accounts names each one", () => {
  mount(
    <RoomCard
      result={{
        kind: "none",
        reason: "no-full-month",
        blockingAccounts: [
          { id: "A", reason: "stale" },
          { id: "B", reason: "stale" },
        ],
      }}
      accounts={[account("A", { name: "Main" }), account("B", { name: "Joint" })]}
      onOpenIntake={() => {}}
    />,
  );
  expect(text()).toContain("full month of data");
  expect(text()).toContain(
    "Main has no recent transactions, so these months can't be counted. Sync or import it to fix this.",
  );
  expect(text()).toContain("Joint has no recent transactions");
});

test("foreign-currency transactions left out are counted in the calculation", () => {
  mount(<RoomCard result={computed({ excludedForeignCount: 3 })} onOpenIntake={() => {}} />);
  expect(container!.querySelector("details")!.textContent).toContain(
    "3 transaction(s) in a foreign currency were not counted.",
  );
});

test("a negative room is a negative amount with the same neutral wording", () => {
  mount(
    <RoomCard
      result={computed({ middleCents: -12000, lowCents: -30000, highCents: 5000 })}
      onOpenIntake={() => {}}
    />,
  );
  expect(container!.querySelector("[data-testid=room-headline]")!.textContent).toBe(
    "About -€120 a month",
  );
  expect(container!.querySelector("[data-testid=room-range]")!.textContent).toBe(
    "Between -€300 and €50",
  );
  expect(findAdviceLanguage(text(), "en")).toEqual([]);
});

test("20 days of data -> none, not a number", () => {
  const txs = Array.from({ length: 10 }, (_, i) =>
    tx(`2026-10-${String(i + 2).padStart(2, "0")}`, -10 * (i + 1)),
  );
  const r = roomOf(txs, [account("A1")]);
  expect(r.kind).toBe("none");
  mount(<RoomCard result={r} accounts={[account("A1")]} onOpenIntake={() => {}} />);
  expect(container!.querySelector("[data-testid=room-headline]")).toBeNull();
  expect(text()).toContain("full month of data");
  // Ten recent transactions: the account is short, never "no recent transactions".
  expect(container!.querySelector("[data-reason=stale]")).toBeNull();
  expect(text()).not.toContain("no recent transactions");
  expect(container!.querySelector("[data-reason=short]")!.textContent).toContain(
    "A1 only has data since Oct 2026",
  );
});

test("all accounts belong to a business -> none/no personal accounts, never the business number", () => {
  const bv = account("B1", { entity: "Acme BV" });
  const txs = ["2026-07", "2026-08", "2026-09"].flatMap((m) => [
    tx(`${m}-01`, 9000, { accountKey: "B1" }),
    tx(`${m}-28`, -1000, { accountKey: "B1" }),
  ]);
  const r = roomOf(txs, [bv], [{ entity: "Acme BV", scope: "business" }]);
  expect(r).toEqual({ kind: "none", reason: "no-data" });
  mount(<RoomCard result={r} accounts={[bv]} onOpenIntake={() => {}} />);
  expect(text()).toContain("We do not have enough data yet");
  expect(text()).not.toMatch(/€\s?[1-9]/);
});

test("a dormant second account is named in the none result it causes", () => {
  const a = account("A1", { name: "Everyday" });
  const b = account("B1", { name: "Old savings" });
  const txs = [
    ...(["2026-07-31", "2026-08-31", "2026-09-30"] as const).flatMap((d) => [
      tx(`${d.slice(0, 7)}-01`, 3000),
      tx(d, -100),
    ]),
    tx("2026-03-01", 10, { accountKey: "B1" }),
  ];
  const r = roomOf(txs, [a, b]);
  mount(<RoomCard result={r} accounts={[a, b]} onOpenIntake={() => {}} />);
  expect(container!.querySelector("[data-testid=room-blocking]")!.textContent).toContain(
    "Old savings has no recent transactions",
  );
  expect(container!.querySelector("[data-reason=stale]")).not.toBeNull();
});

test("a newly linked account is short, with the month its data starts", () => {
  const a = account("A1", { name: "Everyday" });
  const b = account("B1", { name: "New card" });
  const txs = [
    ...(["2026-07-31", "2026-08-31", "2026-09-30"] as const).flatMap((d) => [
      tx(`${d.slice(0, 7)}-01`, 3000),
      tx(d, -100),
    ]),
    tx("2026-08-02", -5, { accountKey: "B1" }),
    tx("2026-09-30", -5, { accountKey: "B1" }),
  ];
  const r = roomOf(txs, [a, b]);
  expect(r).toMatchObject({
    kind: "computed",
    partial: true,
    blockingAccounts: [{ id: "B1", reason: "short", since: "2026-08" }],
  });
  mount(<RoomCard result={r} accounts={[a, b]} onOpenIntake={() => {}} />);
  expect(container!.querySelector("[data-reason=short]")!.textContent).toBe(
    "New card only has data since Aug 2026; the room uses fewer months until there are three full ones.",
  );
  expect(container!.querySelector("[data-reason=stale]")).toBeNull();
});

test("an account with no name or bank is called a generic name, never its key", () => {
  mount(
    <RoomCard
      result={{
        kind: "none",
        reason: "no-full-month",
        blockingAccounts: [{ id: "amex-2026.csv", reason: "stale" }],
      }}
      accounts={[account("amex-2026.csv", { name: "", bank: "" })]}
      onOpenIntake={() => {}}
    />,
  );
  expect(text()).toContain("An account has no recent transactions");
  expect(text()).not.toContain("amex-2026.csv");
});

test("a few cents under zero reads €0, not -€0", () => {
  mount(
    <RoomCard
      result={computed({ middleCents: -30, lowCents: -49, highCents: 49 })}
      onOpenIntake={() => {}}
    />,
  );
  expect(container!.querySelector("[data-testid=room-headline]")!.textContent).toBe(
    "About €0 a month",
  );
  expect(container!.querySelector("[data-testid=room-range]")!.textContent).toBe(
    "Between €0 and €0",
  );
});

test("copy scan: no room or home string trips findAdviceLanguage or recommends investing", () => {
  const strings = (node: unknown): string[] => {
    if (typeof node === "string") return [node];
    if (typeof node === "function") {
      const out: string[] = [];
      for (const args of [["x"], ["x", 2], [1], [1, "x", "y", "z"], ["x", "y", "z", "w"]]) {
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
    const c = intakeCopy[locale];
    const all = [...strings(c.home), ...strings(c.payoff)];
    expect(all.length).toBeGreaterThan(20);
    const hits = all
      .map((s) => ({ s, f: findAdviceLanguage(s, locale) }))
      .filter((x) => x.f.length > 0)
      .map((x) => `${x.s} -> ${JSON.stringify(x.f)}`);
    expect(hits).toEqual([]);
    for (const s of all)
      for (const phrase of ["invest", "invester", "per maand beleggen"])
        expect(s.toLowerCase(), s).not.toContain(phrase);
  }
});

test("the room card is a widget: in the registry, on by default, and it respects the switch", () => {
  expect(WIDGETS.some((w) => w.id === "room-card" && w.defaultOn === true)).toBe(true);
  const store = {
    current: markDone(emptyProfile(), "savings"),
    versions: [],
    updatedAt: "x",
  } as AdvisorProfileStore;
  const props = { store, result: computed(), onOpenIntake: () => {} };
  mount(<RoomCardWidget {...props} />);
  expect(container!.querySelector("[data-testid=room-card]")).not.toBeNull();
  act(() => root!.unmount());
  container!.remove();
  setEnabledWidgets(["aandacht"]);
  mount(<RoomCardWidget {...props} />);
  expect(container!.querySelector("[data-testid=room-card]")).toBeNull();
});

test("no room card before block 1 is done", () => {
  setEnabledWidgets(["room-card"]);
  mount(<RoomCardWidget store={null} result={computed()} onOpenIntake={() => {}} />);
  expect(container!.querySelector("[data-testid=room-card]")).toBeNull();
  act(() => root!.unmount());
  container!.remove();
  const zero = { current: emptyProfile(), versions: [], updatedAt: "x" } as AdvisorProfileStore;
  mount(<RoomCardWidget store={zero} result={computed()} onOpenIntake={() => {}} />);
  expect(container!.querySelector("[data-testid=room-card]")).toBeNull();
});

test("a stale account with three older full months (not partial) still shows the notice and the import link", () => {
  const onImport = vi.fn();
  mount(
    <RoomCard
      result={computed({ partial: false, blockingAccounts: [{ id: "B1", reason: "stale" }] })}
      accounts={[account("B1", { name: "Revolut Joint" })]}
      onOpenIntake={() => {}}
      onImport={onImport}
    />,
  );
  expect(container!.querySelector("[data-testid=room-blocking]")).not.toBeNull();
  expect(text()).toContain("Revolut Joint");
  expect(text()).toContain("import");
});
