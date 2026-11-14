// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import Overzicht from "./Overzicht";
import { setEnabledWidgets } from "../components/moduleRegistry";
import { accounts, ASOF, own, rules, scheduledFlows, txs } from "../components/blocks/fixtures";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
});

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <Overzicht
        accounts={accounts}
        txs={txs}
        rules={rules}
        own={own}
        asOf={ASOF}
        bufferCents={500_000}
        scheduledFlows={scheduledFlows}
        entities={[]}
        vatSettings={[]}
        invoices={[]}
        country="NL"
        fxHistory={{}}
        mode="separate"
        onBufferChange={() => {}}
        onNavigate={() => {}}
        onAddWidget={() => {}}
        onSelectCategory={() => {}}
        travel={{
          accounts,
          txs,
          rates: [],
          facts: [],
          asOf: ASOF,
          homeCountry: "NL",
          homeCountryChosen: true,
          onNavigate: () => {},
          busy: false,
          aiAvailable: false,
          onRefreshTerms: () => {},
          onRecheckAi: () => {},
          onCorrectFact: () => {},
        }}
      />,
    ),
  );
}

const titles = () =>
  Array.from(container!.querySelectorAll("section[aria-label]")).map((s) =>
    s.getAttribute("aria-label"),
  );

test("a fresh Home is the chart slot, Statistieken, Je kaarten and Travel, and nothing else", () => {
  mount();
  const shown = titles();
  expect(shown).toHaveLength(4);
  expect(shown[0]).toMatch(/^Totale positie/);
  expect(shown[1]).toBe("Statistieken");
  for (const gone of [
    "Aandacht",
    "Recente transacties",
    "Betaalagenda",
    "Top uitgaven",
    "Cashflow",
    "Je ruimte per maand",
  ]) {
    expect(shown).not.toContain(gone);
  }
  // The only chart radio group is the slot's, and the page carries no
  // assistant, invite or connect card.
  expect(container!.querySelectorAll('[role="radiogroup"]')).toHaveLength(1);
});

test("widgets that are on come in the page order, and share rows of three", () => {
  setEnabledWidgets(["aandacht", "recente-transacties", "betaalagenda", "top-uitgaven"]);
  mount();
  const shown = titles();
  // Aandacht only draws when there is something to flag; the rest follow the
  // spec order whatever the fixture raises.
  const names = [
    "Totale positie",
    "Statistieken",
    "Recente transacties",
    "Betaalagenda",
    "Top uitgaven",
  ];
  const at = names.map((t) => shown.findIndex((x) => x?.startsWith(t)));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);

  const span = (t: string) =>
    container!.querySelector(`section[aria-label^="${t}"]`)!.getAttribute("data-span");
  expect(span("Recente transacties")).toBe("2");
  expect(span("Betaalagenda")).toBe("1");
  expect(span("Top uitgaven")).toBe("3");
});
