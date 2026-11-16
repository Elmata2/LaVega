// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { CardFileContext, type OpenCardFile } from "./components/import/CardFileContext";
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

function mount(
  extra: { statedCredit?: string[]; statedDebit?: string[] },
  open: OpenCardFile | null = null,
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <CardFileContext.Provider value={open}>
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
          asOf="2026-01-01"
          onOpeningCommit={() => {}}
          onValuationCommit={() => {}}
          onValuationRemove={() => {}}
          onRefreshBank={() => {}}
          {...extra}
        />
      </CardFileContext.Provider>,
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
  mount({ statedCredit: ["ing-creditcard"] });
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

test("a card no bank link reaches gets Bestand uploaden and no Koppelen; the click names the card", () => {
  const open = vi.fn();
  mount({ statedCredit: ["american-express-gold-card"], statedDebit: ["212-card"] }, open);
  const labels = [...section()!.querySelectorAll("button")].map((b) => b.textContent);
  expect(labels).toEqual(["Bestand uploaden", "Bestand uploaden"]);
  act(() => {
    section()!.querySelector("button")!.click();
  });
  expect(open).toHaveBeenCalledWith({
    id: "american-express-gold-card",
    name: "American Express Gold Card",
    brand: "amex",
    kind: "credit",
  });
});

test("a linkable card keeps Koppelen and gets Bestand uploaden next to it", () => {
  mount({ statedCredit: ["ing-creditcard"] }, vi.fn());
  const labels = [...section()!.querySelectorAll("button")].map((b) => b.textContent);
  expect(labels).toEqual(["Koppelen", "Bestand uploaden"]);
});

test("a file-fed account shows via bestand", () => {
  const h = document.createElement("div");
  document.body.appendChild(h);
  host = h;
  root = createRoot(h);
  act(() =>
    root!.render(
      <Rekeningen
        accounts={[{ ...ING, bank: "American Express", name: "Amex Card", source: "file" }]}
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
        asOf="2026-01-01"
        onOpeningCommit={() => {}}
        onValuationCommit={() => {}}
        onValuationRemove={() => {}}
        onRefreshBank={() => {}}
      />,
    ),
  );
  act(() => {
    [...h.querySelectorAll("button")].find((b) => b.textContent === "Alle rekeningen")!.click();
  });
  expect(h.querySelector('[data-testid="via-file"]')!.textContent).toContain("via bestand");
});
