// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { Account } from "@lavega/core";
import Rekeningen from "./views/Rekeningen";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ING: Account = {
  key: "NL01INGB",
  iban: "NL01INGB",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: 10,
};

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(extra: { statedCredit?: string[]; statedDebit?: string[] }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Rekeningen
        accounts={[ING]}
        txs={[]}
        busy={false}
        onEntityChange={() => {}}
        onAccountCommit={() => {}}
        onAccountFieldChange={() => {}}
        onSaldoCommit={() => {}}
        onTypeCommit={() => {}}
        onSelectAccount={() => {}}
        onDeleteAccount={() => {}}
        duplicateGroups={[]}
        onMergeDuplicates={() => {}}
        onRefreshBank={() => {}}
        {...extra}
      />,
    ),
  );
  return host;
}

const section = () => host!.querySelector<HTMLElement>('[data-testid="not-connected"]');

test("the not-connected section lists stated cards with their kind", () => {
  mount({
    statedCredit: ["american-express-gold-card"],
    statedDebit: ["knab-betaalpas"],
  });
  const s = section();
  expect(s).not.toBeNull();
  expect(s!.textContent).toContain("Nog niet gekoppeld");
  expect(s!.textContent).toContain("American Express Gold Card");
  expect(s!.textContent).toContain("Creditcard");
  expect(s!.textContent).toContain("Betaalpas");
});

test("Koppelen opens the bank linking flow", () => {
  mount({ statedCredit: ["american-express-gold-card"] });
  expect(host!.textContent).not.toContain("Of koppel je bank direct");
  const btn = [...section()!.querySelectorAll("button")].find((b) => b.textContent === "Koppelen")!;
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(host!.textContent).toContain("Of koppel je bank direct");
});

test("the section is hidden when every stated card is accounted for or none is stated", () => {
  mount({ statedCredit: [], statedDebit: [] });
  expect(section()).toBeNull();
});
