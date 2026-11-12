// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CashFlowRuleRow, CashFlowSuggestionRow } from "../lib/cashFlowSuggestions.js";
import { CashFlowSuggestionsSection } from "./CashFlowSuggestionsSection.js";

/* The confirmation panel for #137 (Jev-04), driven like the owner drives it.
 *
 * The fake fetch below mirrors the server's contract, not its storage: a
 * pending suggestion becomes a rule only through /confirm, a rejection removes
 * it so it is not offered again, and a sign-flipping kind is refused with 409
 * unless the request acknowledged the before/after. That keeps the test honest
 * about what the UI observes: the create/remove decision and the refusal. */

type FakeState = {
  enabled: boolean;
  pending: CashFlowSuggestionRow[];
  rules: CashFlowRuleRow[];
  confirmBodies: Array<Record<string, unknown>>;
  rejectBodies: Array<Record<string, unknown>>;
  removeBodies: Array<Record<string, unknown>>;
  /** Force a 409 on the next confirm even if the local preview sees no flip. */
  forceServerSignChange: boolean;
  toggles: boolean[];
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let container: HTMLElement | null = null;
let fake: FakeState;

function suggestion(overrides: Partial<CashFlowSuggestionRow> = {}): CashFlowSuggestionRow {
  return {
    broker: "trading212",
    typeKey: "SHARES_IN",
    rawType: "SHARES_IN",
    kind: "withdrawal",
    confidence: 0.72,
    amount: 250,
    sign: 1,
    currency: "EUR",
    description: "Share purchase settlement",
    createdAt: "2026-11-11T05:00:00.000Z",
    signChange: true,
    ...overrides,
  };
}

function rule(overrides: Partial<CashFlowRuleRow> = {}): CashFlowRuleRow {
  return {
    broker: "trading212",
    typeKey: "SHARES_IN",
    kind: "withdrawal",
    confirmedAt: "2026-11-11T05:10:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body =
        init?.body == null ? null : (JSON.parse(String(init.body)) as Record<string, unknown>);
      if (url.endsWith("/cash-flow-suggestions/settings")) {
        if (method !== "PUT") return jsonResponse({ enabled: fake.enabled });
        fake.enabled = body?.enabled === true;
        fake.toggles.push(fake.enabled);
        return jsonResponse({ enabled: fake.enabled });
      }
      if (url.endsWith("/cash-flow-suggestions")) {
        return jsonResponse({
          enabled: fake.enabled,
          count: fake.pending.length,
          pending: fake.enabled ? fake.pending : [],
        });
      }
      if (url.endsWith("/cash-flow-rules"))
        return jsonResponse({ enabled: fake.enabled, rules: fake.rules });
      if (url.endsWith("/cash-flow-rules/remove")) {
        fake.removeBodies.push(body ?? {});
        fake.rules = fake.rules.filter(
          (row) => !(row.broker === body?.broker && row.typeKey === body?.typeKey),
        );
        return jsonResponse({ rules: fake.rules });
      }
      if (url.endsWith("/cash-flow-suggestions/confirm")) {
        fake.confirmBodies.push(body ?? {});
        const row = fake.pending.find(
          (candidate) => candidate.broker === body?.broker && candidate.typeKey === body?.typeKey,
        );
        if (row == null) return jsonResponse({ problems: ["No suggestion for that type"] }, 404);
        const kind = body?.kind as CashFlowRuleRow["kind"];
        const flips =
          fake.forceServerSignChange ||
          (row.amount != null && row.amount > 0 && (kind === "withdrawal" || kind === "fee"));
        if (flips && body?.acknowledgeSignChange !== true) {
          return jsonResponse(
            {
              reason: "sign-change-unacknowledged",
              before: row.amount,
              after: row.amount == null ? null : -row.amount,
            },
            409,
          );
        }
        const created: CashFlowRuleRow = {
          broker: row.broker,
          typeKey: row.typeKey,
          kind,
          confirmedAt: "2026-11-11T05:20:00.000Z",
        };
        fake.rules = [
          ...fake.rules.filter(
            (existing) =>
              existing.broker !== created.broker || existing.typeKey !== created.typeKey,
          ),
          created,
        ];
        fake.pending = fake.pending.filter((candidate) => candidate !== row);
        return jsonResponse({ rule: created, rules: fake.rules });
      }
      if (url.endsWith("/cash-flow-suggestions/reject")) {
        fake.rejectBodies.push(body ?? {});
        fake.pending = fake.pending.filter(
          (candidate) =>
            !(candidate.broker === body?.broker && candidate.typeKey === body?.typeKey),
        );
        return jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    }),
  );
}

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<CashFlowSuggestionsSection />);
  });
  // Let the three initial reads settle.
  for (let i = 0; i < 5; i++) await act(async () => void (await Promise.resolve()));
}

const byTestId = (id: string): HTMLElement =>
  container!.querySelector<HTMLElement>(`[data-testid="${id}"]`) as HTMLElement;

function click(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  act(() => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  fake = {
    enabled: true,
    pending: [],
    rules: [],
    confirmBodies: [],
    rejectBodies: [],
    removeBodies: [],
    forceServerSignChange: false,
    toggles: [],
  };
  installFetch();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
  vi.unstubAllGlobals();
});

test("disabled shows the off state and hides every pending suggestion", async () => {
  fake.enabled = false;
  fake.pending = [suggestion()];
  await render();

  expect(byTestId("cash-flow-disabled").textContent).toContain("Suggestions are off");
  expect(container!.querySelector('[data-testid^="cash-flow-row-"]')).toBeNull();
  expect(container!.querySelector('[data-testid="cash-flow-pending-count"]')).toBeNull();
  const toggle = container!.querySelector('[role="switch"]');
  expect(toggle?.getAttribute("aria-checked")).toBe("false");
});

test("enabling the switch persists it and reveals what is waiting", async () => {
  fake.enabled = false;
  fake.pending = [suggestion()];
  await render();
  expect(container!.querySelector('[data-testid^="cash-flow-row-"]')).toBeNull();

  click(container!.querySelector('[role="switch"]'));
  await act(async () => void (await Promise.resolve()));

  expect(fake.toggles).toEqual([true]);
  expect(container!.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(byTestId("cash-flow-pending-count").textContent).toContain("1 waiting");
  expect(byTestId("cash-flow-row-trading212|SHARES_IN")).not.toBeNull();
});

test("each pending suggestion shows the broker's raw type, kind, confidence, amount and sign", async () => {
  fake.pending = [
    suggestion(),
    suggestion({
      broker: "ibkr",
      typeKey: "INTEREST_PAYMENT",
      rawType: "INTEREST_PAYMENT",
      kind: "interest",
      confidence: 0.91,
      amount: -12.5,
      sign: -1,
      signChange: false,
      description: "Monthly interest",
    }),
  ];
  await render();

  expect(byTestId("cash-flow-pending-count").textContent).toContain("2 waiting");
  const row = byTestId("cash-flow-row-trading212|SHARES_IN");
  expect(row.textContent).toContain("SHARES_IN");
  expect(row.textContent).toContain("trading212");
  expect(row.textContent).toContain("Withdrawal");
  expect(row.textContent).toContain("Confidence 72%");
  expect(byTestId("cash-flow-amount-trading212|SHARES_IN").textContent).toContain("€250.00");
  expect(byTestId("cash-flow-amount-trading212|SHARES_IN").textContent).toContain("+");
  expect(row.textContent).toContain("cash in");
  const second = byTestId("cash-flow-row-ibkr|INTEREST_PAYMENT");
  expect(second.textContent).toContain("Interest");
  expect(second.textContent).toContain("Confidence 91%");
  expect(byTestId("cash-flow-amount-ibkr|INTEREST_PAYMENT").textContent).toContain("-€12.50");
});

test("confirming a suggestion creates the rule and clears it from the list", async () => {
  fake.pending = [
    suggestion({
      broker: "ibkr",
      typeKey: "INTEREST_PAYMENT",
      rawType: "INTEREST_PAYMENT",
      kind: "interest",
      amount: -12.5,
      sign: -1,
      signChange: false,
    }),
  ];
  await render();

  click(byTestId("cash-flow-confirm-ibkr|INTEREST_PAYMENT"));
  await act(async () => void (await Promise.resolve()));

  expect(fake.confirmBodies).toEqual([
    { broker: "ibkr", typeKey: "INTEREST_PAYMENT", kind: "interest", acknowledgeSignChange: false },
  ]);
  expect(container!.querySelector('[data-testid^="cash-flow-row-"]')).toBeNull();
  const rules = byTestId("cash-flow-rule-ibkr|INTEREST_PAYMENT");
  expect(rules.textContent).toContain("Interest");
  expect(byTestId("cash-flow-pending-count").textContent).toContain("0 waiting");
});

test("a rejection removes the suggestion and a reload does not offer it again", async () => {
  fake.pending = [
    suggestion({
      broker: "ibkr",
      typeKey: "INTEREST_PAYMENT",
      rawType: "INTEREST_PAYMENT",
      kind: "interest",
      amount: -12.5,
      sign: -1,
      signChange: false,
    }),
  ];
  await render();
  click(byTestId("cash-flow-reject-ibkr|INTEREST_PAYMENT"));
  await act(async () => void (await Promise.resolve()));
  expect(fake.rejectBodies).toEqual([{ broker: "ibkr", typeKey: "INTEREST_PAYMENT" }]);
  expect(container!.querySelector('[data-testid^="cash-flow-row-"]')).toBeNull();

  act(() => root?.unmount());
  container?.remove();
  await render();
  expect(container!.querySelector('[data-testid^="cash-flow-row-"]')).toBeNull();
});

test("a sign-changing confirmation is loud and needs the explicit acknowledgement", async () => {
  fake.pending = [suggestion()];
  await render();

  const warning = byTestId("cash-flow-sign-change-trading212|SHARES_IN");
  expect(warning.textContent).toContain("changes the sign");
  expect(warning.textContent).toContain("€250.00");
  expect(warning.textContent).toContain("-€250.00");

  const confirm = byTestId("cash-flow-confirm-trading212|SHARES_IN") as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(confirm.textContent).toContain("Confirm sign change");
  click(confirm);
  expect(fake.confirmBodies).toEqual([]); // nothing was sent

  const ack = byTestId("cash-flow-ack-trading212|SHARES_IN") as HTMLInputElement;
  act(() => {
    ack.click();
  });
  await act(async () => void (await Promise.resolve()));
  expect((byTestId("cash-flow-confirm-trading212|SHARES_IN") as HTMLButtonElement).disabled).toBe(
    false,
  );

  click(byTestId("cash-flow-confirm-trading212|SHARES_IN"));
  await act(async () => void (await Promise.resolve()));
  expect(fake.confirmBodies).toEqual([
    { broker: "trading212", typeKey: "SHARES_IN", kind: "withdrawal", acknowledgeSignChange: true },
  ]);
  expect(container!.querySelector('[data-testid^="cash-flow-row-"]')).toBeNull();
});

test("a server-side 409 shows its own before/after and demands the acknowledgement", async () => {
  fake.pending = [
    suggestion({
      broker: "ibkr",
      typeKey: "ODD_POSITIVE",
      rawType: "ODD_POSITIVE",
      kind: "deposit",
      amount: 40,
      sign: 1,
      signChange: false, // local preview sees no flip; the server is the authority
    }),
  ];
  fake.forceServerSignChange = true;
  await render();

  // The first confirmation is sent with the suggested kind and the server is
  // the authority: it answers 409 even though the local preview saw no flip.
  click(byTestId("cash-flow-confirm-ibkr|ODD_POSITIVE"));
  await act(async () => void (await Promise.resolve()));
  expect(fake.confirmBodies.at(-1)).toEqual({
    broker: "ibkr",
    typeKey: "ODD_POSITIVE",
    kind: "deposit",
    acknowledgeSignChange: false,
  });
  const warning = byTestId("cash-flow-sign-change-ibkr|ODD_POSITIVE");
  expect(warning.textContent).toContain("€40.00");

  // Correcting the kind to a sign-flipping one re-arms the local guard: the
  // button stays disabled until the owner acknowledges, and nothing is sent.
  const select = byTestId("cash-flow-kind-ibkr|ODD_POSITIVE") as HTMLSelectElement;
  act(() => {
    select.value = "withdrawal";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const afterCorrection = fake.confirmBodies.length;
  expect((byTestId("cash-flow-confirm-ibkr|ODD_POSITIVE") as HTMLButtonElement).disabled).toBe(
    true,
  );
  click(byTestId("cash-flow-confirm-ibkr|ODD_POSITIVE"));
  expect(fake.confirmBodies).toHaveLength(afterCorrection);

  click(container!.querySelector('[data-testid="cash-flow-ack-ibkr|ODD_POSITIVE"]'));
  await act(async () => void (await Promise.resolve()));
  click(byTestId("cash-flow-confirm-ibkr|ODD_POSITIVE"));
  await act(async () => void (await Promise.resolve()));
  expect(fake.confirmBodies.at(-1)).toEqual({
    broker: "ibkr",
    typeKey: "ODD_POSITIVE",
    kind: "withdrawal",
    acknowledgeSignChange: true,
  });
  expect(container!.querySelector('[data-testid^="cash-flow-row-"]')).toBeNull();
});

test("a confirmed rule is listed with its kind and can be removed", async () => {
  fake.rules = [rule()];
  await render();

  const listed = byTestId("cash-flow-rule-trading212|SHARES_IN");
  expect(listed.textContent).toContain("SHARES_IN");
  expect(listed.textContent).toContain("Withdrawal");
  click(byTestId("cash-flow-remove-trading212|SHARES_IN"));
  await act(async () => void (await Promise.resolve()));
  expect(fake.removeBodies).toEqual([{ broker: "trading212", typeKey: "SHARES_IN" }]);
  expect(container!.querySelector('[data-testid^="cash-flow-rule-"]')).toBeNull();
});

test("Dutch copy follows the shared lavega_locale cookie, English is the default", async () => {
  fake.pending = [suggestion()];
  document.cookie = "lavega_locale=nl; Path=/";
  await render();
  expect(container!.textContent).toContain("Cashflow-suggesties");
  expect(container!.textContent).toContain("wacht op bevestiging");
  expect(byTestId("cash-flow-confirm-trading212|SHARES_IN").textContent).toContain(
    "Bevestig tekenwijziging",
  );
  expect(container!.textContent).toContain("Opname (geld uit)");
});
