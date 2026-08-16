// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import Koppelingen from "./views/Koppelingen";
import { getN8nInvoiceToken, getN8nInvoiceUrl, setN8nInvoiceToken, setN8nInvoiceUrl } from "./settings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Koppelingen />));
  return container;
}

function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function byText(selector: string, text: string): HTMLElement {
  const hit = [...container!.querySelectorAll(selector)].find((n) => (n.textContent ?? "").includes(text));
  if (!hit) throw new Error(`no ${selector} containing "${text}"`);
  return hit as HTMLElement;
}

test("the webhook URL and token are saved as LOCAL preferences", () => {
  const c = render();
  act(() => setNativeValue(c.querySelector('[aria-label="n8n webhook-URL"]') as HTMLInputElement, "https://n8n.example/webhook/lavega-facturen"));
  act(() => setNativeValue(c.querySelector('[aria-label="n8n token"]') as HTMLInputElement, "sekret"));
  act(() => byText("button", "Opslaan").dispatchEvent(new MouseEvent("click", { bubbles: true })));

  expect(getN8nInvoiceUrl()).toBe("https://n8n.example/webhook/lavega-facturen");
  expect(getN8nInvoiceToken()).toBe("sekret");
  // localStorage, i.e. this browser — not the vault, so a back-up file can
  // never carry a live token, and never the server.
  expect(localStorage.getItem("lavega.n8nInvoiceToken")).toBe("sekret");
});

test("the token is masked by default and only shown on request", () => {
  const c = render();
  const token = c.querySelector('[aria-label="n8n token"]') as HTMLInputElement;
  expect(token.type).toBe("password");
  act(() => {
    // A real click: jsdom flips `checked` and fires input/change itself, which
    // is what React's synthetic onChange listens for.
    const box = c.querySelector('[aria-label="Token tonen"]') as HTMLInputElement;
    box.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect((c.querySelector('[aria-label="n8n token"]') as HTMLInputElement).type).toBe("text");
});

test("wissen clears both, so nothing can be fetched by accident", () => {
  setN8nInvoiceUrl("https://n8n.example/webhook/x");
  setN8nInvoiceToken("sekret");
  render();
  act(() => byText("button", "Wissen").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(getN8nInvoiceUrl()).toBe("");
  expect(getN8nInvoiceToken()).toBe("");
});

test("there is no connection-test button — a test call would eat real invoices", () => {
  const c = render();
  const labels = [...c.querySelectorAll("button")].map((b) => b.textContent ?? "");
  expect(labels).toEqual(["Opslaan", "Wissen"]);
  expect(c.textContent).toContain("geen testknop");
});
