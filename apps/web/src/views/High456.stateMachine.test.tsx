// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentSettings from "./AgentSettings.js";
import Koppelingen from "./Koppelingen.js";
import Transacties from "./Transacties.js";
import { setAiCategorizeEnabled, setInvoiceForwardAddress } from "../settings.js";
import type { AgentApi } from "../api.js";
import type { PushBrowser } from "../agent/pushBrowser.js";
import type { Tx } from "@lavega/core";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
}

async function flush(ms = 10) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentSettings state machine guards", () => {
  it("keeps busy=true until after browser.unsubscribe() in turnOff", async () => {
    let resolveUnsub!: (v: string | null) => void;
    const browser: PushBrowser = {
      supported: () => true,
      permission: () => "granted",
      request: vi.fn(async () => "granted" as NotificationPermission),
      subscribe: vi.fn(async () => null),
      unsubscribe: vi.fn(
        () =>
          new Promise<string | null>((resolve) => {
            resolveUnsub = resolve;
          }),
      ),
    };
    const api: AgentApi = {
      getSettings: vi.fn(async () => ({
        kind: "ok" as const,
        settings: {
          enabled: true,
          channels: ["feed" as const, "push" as const],
          sendHour: 8,
          locale: "nl" as const,
          email: null,
          consentVersion: "v1",
          consentedAt: "2026-01-01T00:00:00Z",
        },
        bankConnected: true,
        consentVersion: "v1",
        vapidPublicKey: "pk",
      })),
      putSettings: vi.fn(async () => ({ kind: "ok" as const })),
      turnOff: vi.fn(async () => ({ kind: "ok" as const })),
      putPush: vi.fn(async () => true),
      deletePush: vi.fn(async () => true),
      getWhatsapp: vi.fn(async () => ({
        kind: "ok" as const,
        linked: false,
        phone: null,
        number: null,
      })),
      createLinkCode: vi.fn(async () => ({
        kind: "ok" as const,
        code: "123456",
        expiresAt: "2026-04-01T12:00:00Z",
        number: "+31600000000",
      })),
      unlinkWhatsapp: vi.fn(async () => true),
      listFeed: vi.fn(async () => ({ kind: "ok" as const, events: [], next: null })),
      deleteEvent: vi.fn(async () => true),
      deleteConversation: vi.fn(async () => true),
    };

    mount(<AgentSettings locale="nl" api={api} browser={browser} />);
    await flush();

    const turnOffBtn = Array.from(container!.querySelectorAll("button")).find((b) =>
      /zet uit/i.test(b.textContent ?? ""),
    )!;
    act(() => turnOffBtn.click());
    const confirmYes = Array.from(
      container!.querySelectorAll('[role="alertdialog"] button'),
    )[0] as HTMLButtonElement;
    act(() => confirmYes.click());
    await flush();

    const saveBtn = Array.from(container!.querySelectorAll("button")).find((b) =>
      /bewaar|opslaan|save/i.test(b.textContent ?? ""),
    ) as HTMLButtonElement | undefined;
    expect(saveBtn?.disabled).toBe(true);

    resolveUnsub("https://push.example/sub");
    await flush();
    expect(api.turnOff).toHaveBeenCalledTimes(1);
    expect(browser.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("Koppelingen state machine guards", () => {
  it("prevents input blur from mutating address while confirmRecord is open", async () => {
    setInvoiceForwardAddress("alpha@invoices.lavega.dev");
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ localPart: "alpha" }), { status: 200 }),
    );
    mount(<Koppelingen fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await flush();

    const recordBtn = Array.from(container!.querySelectorAll("button")).find((b) =>
      /gebruik dit adres|use this address/i.test(b.textContent ?? ""),
    )!;
    act(() => recordBtn.click());
    await flush();

    const input = container!.querySelector<HTMLInputElement>("#forward-address")!;
    expect(input.disabled).toBe(true);
    act(() => {
      input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    });
    expect(container!.textContent).toContain("alpha@invoices.lavega.dev");
  });
});

describe("Transacties state machine guards", () => {
  it("disables Cancel while saving AI review and aborts AI batch on unmount", async () => {
    setAiCategorizeEnabled(true);
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    const tx: Tx = {
      id: "tx-1",
      accountKey: "acc-1",
      date: "2026-04-01",
      amount: -12.5,
      currency: "EUR",
      counterparty: "Bakkerij",
      description: "Brood",
      category: "onbekend",
      manual: false,
    };
    mount(
      <Transacties
        scopedTxs={[tx]}
        accounts={[]}
        rules={[]}
        own={{ all: [], byKey: new Map() }}
        fxHistory={{}}
        mode="convert"
        entityOptions={[]}
        entityScope=""
        fEntity=""
        onFEntityChange={vi.fn()}
        fAccount=""
        onFAccountChange={vi.fn()}
        fSearch=""
        onFSearchChange={vi.fn()}
        fFrom=""
        onFFromChange={vi.fn()}
        fTo=""
        onFToChange={vi.fn()}
        fCategory=""
        onFCategoryChange={vi.fn()}
        transfers={[]}
        suggestions={[]}
        configured={true}
        onApplyCategories={vi.fn(async () => ({ rememberFailed: false }))}
        onChooseCategory={vi.fn(async () => ({ rulesAdded: 0, followers: 0, rememberFailed: false }))}
        onConfirmTransfer={vi.fn()}
        onRejectTransfer={vi.fn()}
      />,
    );

    const catBtn = container!.querySelector<HTMLButtonElement>(
      'button[aria-label*="AI"], button[aria-label*="categoris"], button[aria-label*="lezen"]',
    )!;
    act(() => catBtn.click());
    await flush();

    expect(capturedSignal?.aborted).toBe(false);
    act(() => root!.unmount());
    root = null;
    expect(capturedSignal?.aborted).toBe(true);
  });
});
