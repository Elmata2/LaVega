// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Koppelingen from "./views/Koppelingen";
import { getInvoiceForwardAddress, setInvoiceForwardAddress } from "./settings";
import { adminCopy } from "./copy/admin.js";

/* Koppelingen is nu één blok: het doorstuuradres, lokaal en op de server.
 *
 * Wat hier weg is, is met opzet weg — het n8n-webhook-paar (URL + token) is
 * verwijderd samen met zijn tests; de server bewaart dat paar nu zelf. Wat
 * BLIJFT staan is de lokale-adres-mechaniek (typen, suggestie, genereren,
 * kopiëren) — ongewijzigd, alleen de render-aanroep is aangepast — en daar
 * komen de nieuwe server-tests bij: wat `/api/n8n/forward-address` teruggeeft,
 * en de expliciete, bevestigde schrijfactie. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=nl; Path=/";
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
});

async function render(fetchImpl?: typeof fetch) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Koppelingen fetchImpl={fetchImpl} />);
  });
  return container;
}

/** A fetchImpl that answers the two forward-address endpoints and nothing
 *  else. `get` is called once per GET; `post` (if given) is called once per
 *  POST with the localPart it was sent. Every call is recorded in `calls` so
 *  a test can assert a POST never happened. */
function fakeFetch(opts: {
  get?: () => { localPart: string | null };
  post?: (localPart: string) => { status: number; body: unknown };
}) {
  const calls: { method: string; localPart?: string }[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      calls.push({ method });
      const localPart = opts.get ? opts.get().localPart : null;
      return { ok: true, status: 200, json: async () => ({ localPart }) } as unknown as Response;
    }
    const parsed = init?.body ? (JSON.parse(init.body as string) as { localPart: string }) : { localPart: "" };
    calls.push({ method, localPart: parsed.localPart });
    if (!opts.post) throw new Error("unexpected POST in this test");
    const { status, body } = opts.post(parsed.localPart);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** GET-only fetchImpl: resolves the initial read to "none" and refuses any POST. */
function noneFetch() {
  return fakeFetch({ get: () => ({ localPart: null }) });
}

function byText(selector: string, text: string): HTMLElement {
  const hit = [...container!.querySelectorAll(selector)].find((n) =>
    (n.textContent ?? "").includes(text),
  );
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

/** React luistert op zijn eigen onChange, dus de waarde moet via de native setter
 *  zodat React de wijziging ook ziet — anders typt de test in een veld dat niets
 *  merkt en slaagt de assertie om de verkeerde reden. */
function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** React hangt onBlur aan focusout, niet aan blur: blur bubbelt van zichzelf niet,
 *  dus een los blur-event bereikt de delegatie nooit en de handler loopt niet. */
function blur(el: HTMLInputElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

/* ── Opschonen richting MVP (review 3, item 9) ──────────────────────────────
 *
 * "Remove the connect with n8n as well as the forward address in the profile.
 *  Which one of these do we still need for testing?"
 *
 * Het antwoord op zijn vraag staat in deze test. Wat WEG kan zijn de twee
 * blokken die hem hielpen n8n op te zetten; wat BLIJFT is het lokale adres. */

test("de opzethulp is weg, maar het doorstuuradres is te lezen en te maken", async () => {
  const c = await render(noneFetch().impl);
  // De n8n-provisioning is en blijft weg.
  expect(c.querySelector('[aria-label="n8n basis-URL"]')).toBeNull();
  expect(c.querySelector('[aria-label="n8n API-sleutel"]')).toBeNull();
  expect(
    [...c.querySelectorAll("button")].some((b) =>
      (b.textContent ?? "").includes("Verbind met n8n"),
    ),
  ).toBe(false);
  // Het adres is er nog niet, dus er staat een knop om er een te maken — en
  // het scherm maakt er nog steeds NIET zelf een aan door open te gaan.
  expect(getInvoiceForwardAddress()).toBe("");
  const maak = [...c.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Genereer een willekeurig adres"),
  );
  expect(maak).not.toBeUndefined();
  click(maak as HTMLButtonElement);
  const made = getInvoiceForwardAddress();
  expect(made).toMatch(/^lavega-[a-z0-9]{4,32}@invoices\.lavega\.dev$/);
  expect((c.querySelector('[aria-label="Doorstuuradres"]') as HTMLInputElement).value).toBe(made);
  // Nog steeds geen testknop: een test zou echte facturen opgebruiken.
  expect([...c.querySelectorAll("button")].some((b) => /test/i.test(b.textContent ?? ""))).toBe(
    false,
  );
});

/* ── De lege staat biedt twee opties, geen winnaar ──────────────────────────
 *
 * Hij vroeg om zijn eigen leesbare adres (ale@invoices.lavega.dev) als
 * één-klik-suggestie NAAST de generator, niet in plaats ervan — elk met één
 * regel over de afweging. */

test("de lege staat biedt het leesbare adres en de generator naast elkaar, elk met zijn afweging", async () => {
  const c = await render(noneFetch().impl);
  const suggested = [...c.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("ale@invoices.lavega.dev"),
  );
  const random = [...c.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Genereer een willekeurig adres"),
  );
  expect(suggested).not.toBeUndefined();
  expect(random).not.toBeUndefined();
  // Elk heeft zijn eigen afwegingsregel, en ze zeggen niet hetzelfde.
  expect(c.textContent).toContain("Makkelijk te onthouden en over te typen");
  expect(c.textContent).toContain("Niet te raden");
});

test("op het leesbare adres klikken slaat precies ale@invoices.lavega.dev op", async () => {
  const c = await render(noneFetch().impl);
  const suggested = [...c.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("ale@invoices.lavega.dev"),
  ) as HTMLButtonElement;
  click(suggested);
  expect(getInvoiceForwardAddress()).toBe("ale@invoices.lavega.dev");
  expect((c.querySelector('[aria-label="Doorstuuradres"]') as HTMLInputElement).value).toBe(
    "ale@invoices.lavega.dev",
  );
});

/* ── Kopieer-knop ────────────────────────────────────────────────────────── */

test("een gezet adres krijgt een kopieerknop, die het adres naar het klembord schrijft", async () => {
  const originalClipboard = (navigator as unknown as { clipboard?: unknown }).clipboard;
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  try {
    const c = await render(noneFetch().impl);
    // Nog geen adres: geen kopieerknop — er is niets om te kopiëren.
    expect(c.querySelector('[aria-label="Doorstuuradres kopiëren"]')).toBeNull();
    const suggested = [...c.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("ale@invoices.lavega.dev"),
    ) as HTMLButtonElement;
    click(suggested);
    const copyButton = c.querySelector(
      '[aria-label="Doorstuuradres kopiëren"]',
    ) as HTMLButtonElement;
    expect(copyButton).not.toBeNull();
    await clickAsync(copyButton);
    expect(writeText).toHaveBeenCalledWith("ale@invoices.lavega.dev");
    expect(copyButton.textContent).toBe("Gekopieerd");
  } finally {
    Object.assign(navigator, { clipboard: originalClipboard });
  }
});

test("hij kan het adres intypen dat Cloudflare werkelijk routeert", async () => {
  /* Het adres komt van buiten: zijn cofounder heeft in Cloudflare
   * ale@invoices.lavega.dev aangemaakt (23 augustus, door hem bevestigd), niet
   * het lavega-<random>@invoices.lavega.dev
   * dat LaVega verzon. Een adres dat wij bedenken en dat niets routeert is erger
   * dan geen adres — de post komt nergens aan terwijl het scherm zegt van wel. */
  const c = await render(noneFetch().impl);
  const input = c.querySelector('[aria-label="Doorstuuradres"]') as HTMLInputElement;
  setValue(input, "ale@invoices.lavega.dev");
  blur(input);
  expect(getInvoiceForwardAddress()).toBe("ale@invoices.lavega.dev");
});

test("een half overgetikt adres wordt geweigerd en overschrijft het oude niet", async () => {
  const c = await render(noneFetch().impl);
  const input = c.querySelector('[aria-label="Doorstuuradres"]') as HTMLInputElement;
  setValue(input, "ale@invoices.lavega.dev");
  blur(input);
  setValue(input, "invoices@lavega");
  blur(input);
  expect(getInvoiceForwardAddress()).toBe("ale@invoices.lavega.dev");
  expect(c.textContent).toContain("Dat is geen e-mailadres");
});

test("the lavega_locale cookie switches the screen to English", async () => {
  document.cookie = "lavega_locale=en; Path=/";
  const en = adminCopy.en.koppelingen;
  const c = await render(noneFetch().impl);
  expect(c.querySelector("h2")?.textContent).toBe(en.forwardAddress.heading);
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
});

/* ── Het server-adres ────────────────────────────────────────────────────── */

test("een adres op de server wint van wat er lokaal in localStorage staat", async () => {
  setInvoiceForwardAddress("local-draft@invoices.lavega.dev");
  const c = await render(fakeFetch({ get: () => ({ localPart: "server-side" }) }).impl);
  await act(async () => {});
  const nl = adminCopy.nl.koppelingen;
  // The server's local part does not match what this browser's draft holds,
  // so there is no domain this screen can honestly claim — it shows the bare
  // local part rather than guessing a domain nobody confirmed here.
  expect(c.textContent).toContain(nl.forwardAddress.server.active("server-side"));
  expect(c.textContent).not.toContain(
    nl.forwardAddress.server.active("local-draft@invoices.lavega.dev"),
  );
  expect(c.textContent).not.toContain("server-side@invoices.lavega.dev");
});

test("het adres dat hij zelf typte, met een eigen domein, komt terug zoals hij het typte — niet met een verzonnen domein erachter", async () => {
  /* Regression: de server bewaart alleen het lokale deel (migratie 0008). Een
   * vast "@invoices.lavega.dev" achter dat lokale deel plakken zou een domein
   * beweren dat niemand bevestigde — settings.ts' FORWARD_PATTERN staat elk
   * domein toe, precies omdat Cloudflare bepaalt wat routeert, niet deze code.
   * Typte hij een ANDER domein, dan moet dát domein terugkomen. */
  const { impl } = fakeFetch({
    get: () => ({ localPart: null }),
    post: (localPart) => ({ status: 200, body: { localPart } }),
  });
  const c = await render(impl);
  const input = c.querySelector('[aria-label="Doorstuuradres"]') as HTMLInputElement;
  setValue(input, "ale@work-example.com");
  blur(input);
  const nl = adminCopy.nl.koppelingen;
  await clickAsync(byText("button", nl.forwardAddress.server.recordButton));
  await clickAsync(byText("button", nl.forwardAddress.server.confirmButton));
  expect(c.textContent).toContain(nl.forwardAddress.server.recorded("ale@work-example.com"));
  expect(c.textContent).not.toContain("ale@invoices.lavega.dev");
});

test("een adres dat al bij een ander account hoort geeft de taken-melding", async () => {
  const { impl } = fakeFetch({
    get: () => ({ localPart: null }),
    post: () => ({ status: 409, body: { error: "taken" } }),
  });
  const c = await render(impl);
  const suggested = [...c.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("ale@invoices.lavega.dev"),
  ) as HTMLButtonElement;
  click(suggested);
  const nl = adminCopy.nl.koppelingen;
  await clickAsync(byText("button", nl.forwardAddress.server.recordButton));
  await clickAsync(byText("button", nl.forwardAddress.server.confirmButton));
  expect(c.textContent).toContain(nl.forwardAddress.server.taken);
});

test("een ongeldig adres geeft de invalid-melding", async () => {
  const { impl } = fakeFetch({
    get: () => ({ localPart: null }),
    post: () => ({ status: 400, body: { error: "invalid" } }),
  });
  const c = await render(impl);
  const suggested = [...c.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("ale@invoices.lavega.dev"),
  ) as HTMLButtonElement;
  click(suggested);
  const nl = adminCopy.nl.koppelingen;
  await clickAsync(byText("button", nl.forwardAddress.server.recordButton));
  await clickAsync(byText("button", nl.forwardAddress.server.confirmButton));
  expect(c.textContent).toContain(nl.forwardAddress.server.invalid);
});

test("zonder klik POST't dit scherm nooit, ook niet als er al een lokaal adres staat", async () => {
  setInvoiceForwardAddress("ale@invoices.lavega.dev");
  const { impl, calls } = noneFetch();
  const c = await render(impl);
  await act(async () => {});
  const nl = adminCopy.nl.koppelingen;
  expect(calls.some((call) => call.method === "POST")).toBe(false);
  expect(c.textContent).toContain(nl.forwardAddress.server.none);
});

test("de succesvolle opslag toont het nieuwe server-adres en sluit de bevestiging", async () => {
  // De server echoot het lokale deel canoniek terug (getrimd/lowercased), niet
  // een ANDER lokaal deel — vandaar dezelfde waarde hier als wat verstuurd
  // wordt. Dat is ook precies waarom het scherm hier het volledige, zelf
  // getypte/gekozen adres mag tonen: het lokale deel klopt met de draft.
  const { impl } = fakeFetch({
    get: () => ({ localPart: null }),
    post: (localPart) => ({ status: 200, body: { localPart } }),
  });
  const c = await render(impl);
  const suggested = [...c.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("ale@invoices.lavega.dev"),
  ) as HTMLButtonElement;
  click(suggested);
  const nl = adminCopy.nl.koppelingen;
  await clickAsync(byText("button", nl.forwardAddress.server.recordButton));
  await clickAsync(byText("button", nl.forwardAddress.server.confirmButton));
  expect(c.textContent).toContain(nl.forwardAddress.server.active("ale@invoices.lavega.dev"));
  expect(
    [...c.querySelectorAll("button")].some(
      (b) => (b.textContent ?? "") === nl.forwardAddress.server.confirmButton,
    ),
  ).toBe(false);
  expect(
    [...c.querySelectorAll("button")].some(
      (b) => (b.textContent ?? "") === nl.forwardAddress.server.cancelButton,
    ),
  ).toBe(false);
});
