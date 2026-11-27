// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Facturen from "./Facturen.js";
import { setAiExtractionEnabled } from "../settings.js";

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

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
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

function baseProps(overrides: Partial<Parameters<typeof Facturen>[0]> = {}) {
  return {
    entities: ["Prive"],
    ownIbans: [],
    invoices: [],
    txs: [],
    asOf: "2026-04-01",
    busy: false,
    defaultEntity: "Prive",
    onSaveInvoices: vi.fn(),
    pending: [],
    onPendingChange: vi.fn(),
    notices: [],
    onNoticesChange: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  };
}

function dispatchDrop(el: HTMLElement, file: File) {
  const evt = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: { files: [file] } });
  el.dispatchEvent(evt);
}

describe("Facturen state machine guards", () => {
  it("ignores file drop while AI PDF extraction is running", async () => {
    setAiExtractionEnabled(true);
    let resolveFetch!: (res: Response) => void;
    const fetchSpy = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    mount(<Facturen {...baseProps()} />);
    const dropzone = container!.querySelector<HTMLElement>('[data-testid="dropzone"]')!;
    const pdf1 = new File(["%PDF-1.4 one"], "first.pdf", { type: "application/pdf" });
    const pdf2 = new File(["%PDF-1.4 two"], "second.pdf", { type: "application/pdf" });

    act(() => {
      dispatchDrop(dropzone, pdf1);
    });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    act(() => {
      dispatchDrop(dropzone, pdf2);
    });
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({ error: "stop" }), { status: 500 }));
    await flush();
  });

  it("clears draftParties when adding an extracted invoice so later direction changes do not refill", async () => {
    setAiExtractionEnabled(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              fields: {
                seller: "Acme BV",
                buyer: "Beta BV",
                amount: 100,
                currency: "EUR",
                issueDate: "2026-04-01",
                dueDate: "2026-05-01",
              },
              confidence: 0.9,
            }),
            { status: 200 },
          ),
      ),
    );
    const onSaveInvoices = vi.fn();
    mount(<Facturen {...baseProps({ onSaveInvoices })} />);

    const dropzone = container!.querySelector<HTMLElement>('[data-testid="dropzone"]')!;
    const pdf = new File(["%PDF-1.4"], "inv.pdf", { type: "application/pdf" });
    act(() => {
      dispatchDrop(dropzone, pdf);
    });
    await flush();

    const dirSelect = container!.querySelector<HTMLSelectElement>('select[aria-label*="Richting"], select[aria-label*="Direction"]')!;
    expect(dirSelect.value).toBe("");

    const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    act(() => {
      selectSetter?.call(dirSelect, "out");
      dirSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const cpInput = container!.querySelector<HTMLInputElement>(
      'input[aria-label*="Relatie"], input[aria-label*="Counterparty"]',
    )!;
    expect(cpInput.value).toBe("Acme BV");

    const addBtn = Array.from(container!.querySelectorAll("button")).find((b) =>
      /toevoegen|add/i.test(b.textContent ?? ""),
    )!;
    act(() => {
      addBtn.click();
    });
    expect(onSaveInvoices).toHaveBeenCalledTimes(1);
    expect(cpInput.value).toBe("");

    act(() => {
      selectSetter?.call(dirSelect, "in");
      dirSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(cpInput.value).toBe("");
  });
});
