// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAssistantState } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import { AssistantPanel, assistantTurnReducer } from "./AssistantPanel.js";
import { setAiAssistantEnabled } from "../settings.js";

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

function stubStorage(): VaultStorage {
  return {
    getAssistant: vi.fn(async () => emptyAssistantState()),
    putAssistant: vi.fn(async () => {}),
    getAccounts: vi.fn(async () => []),
    getTxs: vi.fn(async () => []),
    getRules: vi.fn(async () => []),
  } as unknown as VaultStorage;
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

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AssistantPanel turn state machine", () => {
  it("clears awaiting-approval when starting a new turn", () => {
    const withApproval = assistantTurnReducer(
      { status: "idle" },
      {
        type: "await-approval",
        approval: {
          id: "a1",
          tool: "remember_preference",
          payload: { subject: "lengte", valueId: "kort" },
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    );
    expect(withApproval.status).toBe("awaiting-approval");
    const running = assistantTurnReducer(withApproval, { type: "start-running" });
    expect(running).toEqual({ status: "running", stepLabel: null, approval: undefined });
  });

  it("clears open approval on scope change and turnChatOff", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ configured: true }), { status: 200 })),
    );
    setAiAssistantEnabled("acc-1", true);
    const storage = stubStorage();
    const baseChat = {
      plan: null,
      accountId: "acc-1",
      accounts: [],
      txs: [],
      flows: [],
      bills: [],
      occurrences: [],
      scope: "persoonlijk",
    };

    mount(<AssistantPanel storage={storage} asOf="2026-04-01" chat={baseChat} />);
    await flush();

    const input = container!.querySelector<HTMLInputElement>("#assistant-input")!;
    const form = input.closest("form")!;

    await act(async () => {
      setInputValue(input, "onthoud dat ik korte antwoorden wil");
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(container!.querySelector('[data-testid="assistant-approval"]')).not.toBeNull();

    act(() => {
      root!.render(
        <AssistantPanel
          storage={storage}
          asOf="2026-04-01"
          chat={{ ...baseChat, scope: "zakelijk" }}
        />,
      );
    });
    await flush();
    expect(container!.querySelector('[data-testid="assistant-approval"]')).toBeNull();

    await act(async () => {
      setInputValue(input, "onthoud dat ik korte antwoorden wil");
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(container!.querySelector('[data-testid="assistant-approval"]')).not.toBeNull();

    const turnOffBtn = Array.from(container!.querySelectorAll("button")).find((b) =>
      /uitzetten|turn off/i.test(b.textContent ?? ""),
    )!;
    act(() => {
      turnOffBtn.click();
    });
    await flush();
    expect(container!.querySelector('[data-testid="assistant-approval"]')).toBeNull();
  });
});
