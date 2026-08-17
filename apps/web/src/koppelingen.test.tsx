// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import Koppelingen from "./views/Koppelingen";
import {
  ensureInvoiceForwardAddress,
  getInvoiceForwardAddress,
  getN8nApiKey,
  getN8nBaseUrl,
  getN8nInvoiceToken,
  getN8nInvoiceUrl,
  setN8nInvoiceToken,
  setN8nInvoiceUrl,
} from "./settings";
import { GMAIL_NODE_NAME } from "./n8n-provision";

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

const BASE = "https://n8n.example";

/** A stubbed n8n that accepts everything — enough for the screen to reach its
 *  success state. The call-by-call assertions live in n8n-provision.test.ts. */
function happyN8n(): typeof fetch {
  const store = new Map<string, Record<string, unknown>>();
  return (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
    if (url.includes("/workflows?")) return ok({ data: [] });
    if (url.endsWith("/credentials")) return ok({ id: "cred-1" });
    if (url.endsWith("/api/v1/workflows") && method === "POST") {
      const wf = { id: "wf-1", ...(body ?? {}) };
      store.set("wf-1", wf);
      return ok(wf);
    }
    if (url.endsWith("/activate")) return ok({ id: "wf-1", active: true });
    return ok(store.get("wf-1") ?? {});
  }) as unknown as typeof fetch;
}

function render(fetchImpl: typeof fetch = happyN8n(), origin = "https://lavega.dev") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Koppelingen fetchImpl={fetchImpl} origin={origin} />));
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

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function clickAsync(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/* ── 1 · LaVega richt n8n zelf in ──────────────────────────────────────── */

test("Verbind met n8n provisions his n8n and stores the webhook URL and token locally", async () => {
  const c = render();
  act(() => setNativeValue(c.querySelector('[aria-label="n8n basis-URL"]') as HTMLInputElement, BASE));
  act(() => setNativeValue(c.querySelector('[aria-label="n8n API-sleutel"]') as HTMLInputElement, "key-abc"));
  await clickAsync(byText("button", "Verbind met n8n"));

  // The two things Facturen needs, now filled in without a single paste.
  expect(getN8nInvoiceUrl()).toMatch(/^https:\/\/n8n\.example\/webhook\/.+/);
  expect(getN8nInvoiceToken()).toMatch(/^[0-9a-f]{48}$/);
  // Everything stays a LOCAL preference: this browser, never the vault, never
  // the LaVega server.
  expect(getN8nBaseUrl()).toBe(BASE);
  expect(getN8nApiKey()).toBe("key-abc");
  expect(localStorage.getItem("lavega.n8nApiKey")).toBe("key-abc");

  expect(c.textContent).toContain("aangemaakt in n8n");
});

test("after provisioning the screen names the ONE step that cannot be automated, and the node", async () => {
  const c = render();
  act(() => setNativeValue(c.querySelector('[aria-label="n8n basis-URL"]') as HTMLInputElement, BASE));
  act(() => setNativeValue(c.querySelector('[aria-label="n8n API-sleutel"]') as HTMLInputElement, "k"));
  await clickAsync(byText("button", "Verbind met n8n"));

  expect(c.textContent).toContain("Nog één stap");
  expect(c.textContent).toContain(GMAIL_NODE_NAME);
  expect(c.textContent).toContain("Gmail-credential");
  // En het zegt WAAROM het handwerk blijft, in plaats van te lijken alsof er
  // iets mislukt is.
  expect(c.textContent).toContain("credentials niet opzoeken");
});

test("a CORS failure names both environment variables instead of 'kon geen verbinding maken'", async () => {
  const blocked = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const c = render(blocked, "http://localhost:5174");
  act(() => setNativeValue(c.querySelector('[aria-label="n8n basis-URL"]') as HTMLInputElement, BASE));
  act(() => setNativeValue(c.querySelector('[aria-label="n8n API-sleutel"]') as HTMLInputElement, "k"));
  await clickAsync(byText("button", "Verbind met n8n"));

  expect(c.textContent).toContain("N8N_DEFAULT_CORS=true");
  expect(c.textContent).toContain("N8N_CORS_ALLOW_ORIGIN=https://lavega.dev,http://localhost:5174");
  expect(c.textContent).not.toContain("kon geen verbinding maken");
  // Niets geschreven, dus de handmatige weg is nog steeds leeg.
  expect(getN8nInvoiceUrl()).toBe("");
  expect(getN8nInvoiceToken()).toBe("");
  // Maar wat hij intypte is bewaard: na het zetten van die twee variabelen hoeft
  // hij niet opnieuw te plakken.
  expect(getN8nBaseUrl()).toBe(BASE);
});

test("the two CORS variables are also readable BEFORE pressing anything", () => {
  const c = render();
  click(c.querySelector('[aria-label="Uitleg bij CORS in n8n"]') as HTMLButtonElement);
  expect(c.textContent).toContain("N8N_DEFAULT_CORS=true");
  expect(c.textContent).toContain("N8N_CORS_ALLOW_ORIGIN=");
});

/* ── 2 · Het doorstuuradres ────────────────────────────────────────────── */

test("the forwarding address is generated once and then never changes", () => {
  const c = render();
  click(byText("button", "Maak mijn doorstuuradres"));
  const shown = (c.querySelector('[data-testid="forward-address"]') as HTMLElement).textContent!;
  expect(shown).toMatch(/^lavega-[a-z0-9]+@invoices\.lavega\.dev$/);
  expect(getInvoiceForwardAddress()).toBe(shown);

  // Opnieuw vragen — met ANDERE willekeur — geeft hetzelfde adres. Een adres dat
  // verandert is een adres waar post naartoe blijft gaan die niemand meer leest.
  expect(ensureInvoiceForwardAddress(() => "zzzzzzzzzz")).toBe(shown);

  // En na een herstart van het scherm staat hij er nog, zonder knop.
  act(() => root!.unmount());
  container!.remove();
  const again = render();
  expect((again.querySelector('[data-testid="forward-address"]') as HTMLElement).textContent).toBe(shown);
  expect([...again.querySelectorAll("button")].some((b) => b.textContent === "Maak mijn doorstuuradres")).toBe(false);
});

test("the address block states its limits out loud", () => {
  const c = render();
  expect(c.textContent).toContain("leest geen mailbox");
  expect(c.textContent).toContain("alleen wat er"); // "...naartoe gestuurd wordt, komt binnen"
  expect(c.textContent).toContain("oude facturen moet je met de hand doorsturen");
});

test("no address exists until he asks for one", () => {
  render();
  expect(getInvoiceForwardAddress()).toBe("");
  expect(localStorage.getItem("lavega.invoiceForwardAddress")).toBeNull();
});

/* ── 3 · De handmatige weg blijft werken ───────────────────────────────── */

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

test("the manual paste needs nothing from his n8n — no API call is made", () => {
  let calls = 0;
  const counting = (async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  }) as unknown as typeof fetch;
  const c = render(counting);
  act(() => setNativeValue(c.querySelector('[aria-label="n8n webhook-URL"]') as HTMLInputElement, "https://n8n.example/webhook/x"));
  act(() => setNativeValue(c.querySelector('[aria-label="n8n token"]') as HTMLInputElement, "sekret"));
  click(byText("button", "Opslaan"));
  expect(calls).toBe(0);
  expect(getN8nInvoiceUrl()).toBe("https://n8n.example/webhook/x");
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

test("the n8n API key is masked by default — it can create and modify workflows", () => {
  const c = render();
  expect((c.querySelector('[aria-label="n8n API-sleutel"]') as HTMLInputElement).type).toBe("password");
  act(() => {
    (c.querySelector('[aria-label="API-sleutel tonen"]') as HTMLInputElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
  expect((c.querySelector('[aria-label="n8n API-sleutel"]') as HTMLInputElement).type).toBe("text");
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
  const actions = [...c.querySelectorAll("button")].map((b) => b.textContent ?? "").filter(Boolean);
  // Verbinden richt n8n in; het HAALT geen wachtrij op. Elke knop hier is
  // benoemd, en "testen" staat er niet tussen.
  expect(actions).toEqual(["Verbind met n8n", "Maak mijn doorstuuradres", "Opslaan", "Wissen"]);
  expect([...c.querySelectorAll("button")].every((b) => !/test/i.test(b.getAttribute("aria-label") ?? ""))).toBe(true);

  // And the reason is still on the page — behind the eye, not above the fields.
  const eye = c.querySelector('[aria-label="Uitleg bij deze koppeling"]') as HTMLButtonElement;
  expect(eye).not.toBeNull();
  act(() => eye.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(c.textContent).toContain("geen testknop");
});
