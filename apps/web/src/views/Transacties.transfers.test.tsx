// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Account, TransferCandidate, TransferPair, Tx } from "@lavega/core";
import Transacties from "./Transacties";

/* Issue #282 — internal moves become first-class transfer pairs.
 *
 * What these pin down is the SCREEN: a stored pair shows as a decided row badge
 * ("Transfer") plus the category the projection gave it, a derived suggestion
 * shows as a quieter "Mogelijk" badge AND a panel, and the panel is the only
 * place a suggestion can become a decision. The matcher itself is core's
 * contract and is tested there — nothing here re-tests it.
 *
 * The panel must stay honest: it says LaVega does not confirm these by itself,
 * and names the kind and the evidence instead of asking for trust. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNTS: Account[] = [
  {
    key: "NL01INGB",
    iban: "NL01INGB",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 100,
  },
  {
    key: "NL02INGB",
    iban: "NL02INGB",
    name: "Spaarrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 5000,
  },
];

const tx = (p: Partial<Tx> & { id: string }): Tx => ({
  accountKey: "NL01INGB",
  date: "2026-01-05",
  amount: -100,
  currency: "EUR",
  counterparty: "Naar spaarrekening",
  description: "Overboeking",
  category: "",
  manual: false,
  ...p,
});

const OUT = tx({ id: "t-out", amount: -100 });
const IN = tx({ id: "t-in", accountKey: "NL02INGB", amount: 100, date: "2026-01-06" });

/* A pair shaped exactly like core's `TransferPair`; the view only reads ids,
 * kind, amount, currency and the evidence's day gap. */
const pair = (p: Partial<TransferPair> = {}): TransferPair => ({
  id: "pair-1",
  outflowTxId: "t-out",
  inflowTxId: "t-in",
  status: "confirmed",
  kind: "cc_payment",
  amountCents: 10000,
  currency: "EUR",
  createdAt: "2026-01-06",
  decidedAt: "2026-01-06",
  evidence: { rank: "exact", dateDiffDays: 1, amountDeltaCents: 0, crossRate: null },
  ...p,
});

const suggestion = (p: Partial<TransferPair> = {}, ambiguous = false): TransferCandidate => ({
  pair: pair({ status: "suggested", id: "suggested-1", kind: "funds_movement", ...p }),
  ambiguous,
});

type Props = ComponentProps<typeof Transacties>;

const props = (txs: Tx[], over: Partial<Props> = {}): Props =>
  ({
    accounts: ACCOUNTS,
    scopedTxs: txs,
    rules: [],
    own: { all: [], byKey: new Map<string, string[]>() },
    fxHistory: {},
    mode: "convert",
    entityOptions: ["Prive"],
    entityScope: "",
    fEntity: "",
    onFEntityChange: () => {},
    fAccount: "",
    onFAccountChange: () => {},
    fSearch: "",
    onFSearchChange: () => {},
    fFrom: "",
    onFFromChange: () => {},
    fTo: "",
    onFToChange: () => {},
    fCategory: "",
    onFCategoryChange: () => {},
    configured: false,
    onApplyCategories: async () => {},
    transfers: [],
    suggestions: [],
    onConfirmTransfer: () => {},
    onRejectTransfer: () => {},
    ...over,
  }) as unknown as Props;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
});

test("a confirmed pair: projected category, Transfer badge, kind in the title, no panel", () => {
  const html = renderToStaticMarkup(
    <Transacties
      {...props(
        [
          { ...OUT, category: "Eigen overboeking" },
          { ...IN, category: "Eigen overboeking" },
        ],
        { transfers: [pair()] },
      )}
    />,
  );
  expect(html).toContain("Eigen overboeking");
  expect(html).toContain('data-testid="transfer-badge"');
  expect(html).toContain(">Transfer<");
  // The kind is what makes the badge explainable instead of decorative.
  expect(html).toContain('title="creditcardafbetaling"');
  expect(html).not.toContain("Mogelijke overboekingen");
});

test("a derived suggestion: quieter Mogelijk badge plus the possible-transfers panel", () => {
  const html = renderToStaticMarkup(
    <Transacties {...props([OUT, IN], { suggestions: [suggestion()] })} />,
  );
  expect(html).toContain('data-testid="possible-transfer-badge"');
  expect(html).toContain("Mogelijk");
  expect(html).not.toContain('data-testid="transfer-badge"');

  expect(html).toContain('data-testid="possible-transfers"');
  expect(html).toContain("Mogelijke overboekingen");
  // Both account names and the formatted magnitude, so the pair is readable.
  expect(html).toContain("Betaalrekening");
  expect(html).toContain("Spaarrekening");
  expect(html).toContain("100,00");
  expect(html).toContain("5 jan 2026");
  expect(html).toContain("1 dag ertussen");
  expect(html).toContain("eigen overboeking"); // the kind badge
  expect(html).toContain("Bevestig");
  expect(html).toContain("Afwijzen");
  // Honest: the panel never claims to have decided anything.
  expect(html).toContain("bevestigt dit niet vanzelf");
  expect(html).not.toContain("Meerdere kandidaten");
});

test("an ambiguous suggestion warns that another candidate competes for a leg", () => {
  const html = renderToStaticMarkup(
    <Transacties {...props([OUT, IN], { suggestions: [suggestion({}, true)] })} />,
  );
  expect(html).toContain("Meerdere kandidaten");
});

test("clicking Confirm hands that exact suggested pair to App", () => {
  const received: string[] = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <Transacties
        {...props([OUT, IN], {
          suggestions: [suggestion()],
          onConfirmTransfer: (p) => received.push(p.id),
        })}
      />,
    );
  });
  const confirm = host.querySelector<HTMLButtonElement>('[data-testid="transfer-confirm"]');
  expect(confirm).not.toBeNull();
  act(() => {
    confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(received).toEqual(["suggested-1"]);
});
