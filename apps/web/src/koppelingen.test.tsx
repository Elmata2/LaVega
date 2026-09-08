// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import Koppelingen from "./views/Koppelingen";
import { getInvoiceForwardAddress } from "./settings";

/* Koppelingen is één blok geworden: de webhook-URL en het token.
 *
 * Wat hier weg is, is met opzet weg — review 3, item 9: "remove the connect with
 * n8n as well as the forward address in the profile". De tests die "Verbind met
 * n8n" (provisioning via de n8n-API, de CORS-uitleg, de API-sleutel) en het
 * doorstuuradres afdekten zijn met die blokken vertrokken; ze beschreven gedrag
 * dat niet meer bestaat. Wat ze bewezen is niet verdwenen: provisionN8n zelf
 * staat nog in n8n-provision.ts en houdt zijn eigen tests (n8n-provision.test.ts),
 * en het doorstuuradres houdt de zijne in settings/n8n.test.ts. Alleen de KNOPPEN
 * zijn weg.
 *
 * Wat hier BLIJFT staan is het paar waar Facturen op wacht — zie de twee
 * MVP-tests onderaan.
 *
 * URL/token verhuisden 2026-09-08 uit localStorage naar de kluis (privacy/
 * security review 2026-08-28, M4/L6) — zie `fakeVault` hieronder. */

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

/** An in-memory vault, enough for Koppelingen's n8n block. `stored` is exposed
 *  so a test can see what was actually written, not just that something was. */
function fakeVault() {
  const stored = {
    invoiceUrl: undefined as string | undefined,
    invoiceToken: undefined as string | undefined,
  };
  const storage = {
    getN8nSettings: async () => ({
      invoiceUrl: stored.invoiceUrl,
      invoiceToken: stored.invoiceToken,
    }),
    putN8nSettings: async (s: { invoiceUrl?: string; invoiceToken?: string }) => {
      stored.invoiceUrl = s.invoiceUrl;
      stored.invoiceToken = s.invoiceToken;
    },
  } as unknown as VaultStorage;
  return { storage, stored };
}

async function render(storage?: VaultStorage) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Koppelingen storage={storage} />);
  });
  return container;
}

function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
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

/* ── De webhook-URL en het token ────────────────────────────────────────── */

test("the webhook URL and token are saved to the vault, never to localStorage", async () => {
  const { storage, stored } = fakeVault();
  const c = await render(storage);
  act(() =>
    setNativeValue(
      c.querySelector('[aria-label="n8n webhook-URL"]') as HTMLInputElement,
      "https://n8n.example/webhook/lavega-facturen",
    ),
  );
  act(() =>
    setNativeValue(c.querySelector('[aria-label="n8n token"]') as HTMLInputElement, "sekret"),
  );
  await clickAsync(byText("button", "Opslaan"));

  expect(stored.invoiceUrl).toBe("https://n8n.example/webhook/lavega-facturen");
  expect(stored.invoiceToken).toBe("sekret");
  expect(localStorage.getItem("lavega.n8nInvoiceUrl")).toBeNull();
  expect(localStorage.getItem("lavega.n8nInvoiceToken")).toBeNull();
});

test("dit scherm belt met niemand — opslaan doet geen enkel verzoek", async () => {
  // De vorige versie kon dit met een geïnjecteerde fetch, omdat het scherm zelf
  // met n8n praatte. Dat doet het niet meer, dus meten we de echte: er mag geen
  // verzoek de deur uit, naar n8n niet en naar de LaVega-server niet.
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    const { storage, stored } = fakeVault();
    const c = await render(storage);
    act(() =>
      setNativeValue(
        c.querySelector('[aria-label="n8n webhook-URL"]') as HTMLInputElement,
        "https://n8n.example/webhook/x",
      ),
    );
    act(() =>
      setNativeValue(c.querySelector('[aria-label="n8n token"]') as HTMLInputElement, "sekret"),
    );
    await clickAsync(byText("button", "Opslaan"));
    expect(calls).toBe(0);
    expect(stored.invoiceUrl).toBe("https://n8n.example/webhook/x");
  } finally {
    globalThis.fetch = original;
  }
});

test("the token is masked by default and only shown on request", async () => {
  const c = await render(fakeVault().storage);
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

test("wissen clears both in the vault, so nothing can be fetched by accident", async () => {
  const { storage, stored } = fakeVault();
  await storage.putN8nSettings({
    invoiceUrl: "https://n8n.example/webhook/x",
    invoiceToken: "sekret",
  });
  await render(storage);
  await clickAsync(byText("button", "Wissen"));
  expect(stored.invoiceUrl).toBe("");
  expect(stored.invoiceToken).toBe("");
});

test("zonder kluis-prop blijft het blok stil — geen localStorage-terugval", async () => {
  // De prop is optioneel zolang App.tsx hem nog niet doorgeeft (zie de docstring
  // op `storage` in Koppelingen.tsx); "geen kluis" mag nooit stilzwijgend
  // localStorage worden, want dat is precies het lek dat dit blok dichtte.
  const c = await render(undefined);
  act(() =>
    setNativeValue(
      c.querySelector('[aria-label="n8n webhook-URL"]') as HTMLInputElement,
      "https://n8n.example/webhook/x",
    ),
  );
  await clickAsync(byText("button", "Opslaan"));
  expect(localStorage.getItem("lavega.n8nInvoiceUrl")).toBeNull();
  expect(c.textContent).toContain("kluis");
});

test("een oude localStorage-URL/token wordt bij het openen naar de kluis gemigreerd", async () => {
  localStorage.setItem("lavega.n8nInvoiceUrl", "https://n8n.example/webhook/legacy");
  localStorage.setItem("lavega.n8nInvoiceToken", "legacy-tok");
  const { storage, stored } = fakeVault();
  const c = await render(storage);
  expect((c.querySelector('[aria-label="n8n webhook-URL"]') as HTMLInputElement).value).toBe(
    "https://n8n.example/webhook/legacy",
  );
  expect(stored.invoiceUrl).toBe("https://n8n.example/webhook/legacy");
  expect(localStorage.getItem("lavega.n8nInvoiceUrl")).toBeNull();
  expect(localStorage.getItem("lavega.n8nInvoiceToken")).toBeNull();
});

/* ── Opschonen richting MVP (review 3, item 9) ──────────────────────────────
 *
 * "Remove the connect with n8n as well as the forward address in the profile.
 *  Which one of these do we still need for testing?"
 *
 * Het antwoord op zijn vraag staat in deze twee tests. Wat WEG kan zijn de twee
 * blokken die hem hielpen n8n op te zetten; wat BLIJFT is het paar waar Facturen
 * op staat te wachten — Facturen.tsx leest getN8nSettings() en zegt bij een leeg
 * paar letterlijk "vul eerst de webhook-URL en het token in onder Koppelingen".
 * Dat weghalen zou de keten die hij vandaag test onmogelijk maken, en daarom
 * pinnen we het hier vast. */

test("de opzethulp is weg, maar het doorstuuradres is te lezen en te maken", async () => {
  /* DEZE VERWACHTING IS BEWUST GEWIJZIGD, niet afgezwakt.
   *
   * Hij vroeg de kaart weg en dat is gebeurd: de opzethulp, de uitleg en de
   * knoppen eromheen bestaan niet meer. Maar deze kaart was de ENIGE plek waar het
   * doorstuuradres aangemaakt én gelezen werd, en hij test vanavond juist de
   * mailketen. Zonder adres kon hij er geen maken — een opschoning die zijn eigen
   * test onmogelijk maakt is niet wat hij vroeg. Dus staat er één regel terug: het
   * adres, en een knop die er één maakt als hij er nog geen heeft.
   *
   * Wat de oorspronkelijke test bedoelde te beschermen — geen provisioning, geen
   * uitleglawaai, geen testknop die echte facturen opgebruikt — wordt hieronder
   * nog even hard beweerd. */
  const c = await render(fakeVault().storage);
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
    (b.textContent ?? "").includes("laat LaVega er een maken"),
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

test("het paar waar Facturen op staat blijft staan, en zegt nog waar je het vindt", async () => {
  const c = await render(fakeVault().storage);
  expect(c.querySelector('[aria-label="n8n webhook-URL"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="n8n token"]')).not.toBeNull();
  // De uitleg die de plek van die twee waarden in n8n noemt, blijft bereikbaar.
  click(c.querySelector('[aria-label="Uitleg bij de webhook-URL"]') as HTMLButtonElement);
  expect(c.textContent).toContain("Production URL");
});

test("het opzetblok verdwijnt, de reden waarom er geen testknop is niet", async () => {
  const c = await render(fakeVault().storage);
  expect(c.textContent).not.toContain("geen testknop");
  click(c.querySelector('[aria-label="Uitleg bij deze koppeling"]') as HTMLButtonElement);
  expect(c.textContent).toContain("geen testknop");
  // En de weg die de gegevens aflegen staat er nog bij: de LaVega-server zit er
  // niet tussen.
  expect(c.textContent).toContain("jouw browser");
});

test("hij kan het adres intypen dat Cloudflare werkelijk routeert", async () => {
  /* Het adres komt van buiten: zijn cofounder heeft in Cloudflare
   * ale@invoices.lavega.dev aangemaakt (23 augustus, door hem bevestigd), niet
   * het lavega-<random>@invoices.lavega.dev
   * dat LaVega verzon. Een adres dat wij bedenken en dat niets routeert is erger
   * dan geen adres — de post komt nergens aan terwijl het scherm zegt van wel. */
  const c = await render(fakeVault().storage);
  const input = c.querySelector('[aria-label="Doorstuuradres"]') as HTMLInputElement;
  setValue(input, "ale@invoices.lavega.dev");
  blur(input);
  expect(getInvoiceForwardAddress()).toBe("ale@invoices.lavega.dev");
});

test("een half overgetikt adres wordt geweigerd en overschrijft het oude niet", async () => {
  const c = await render(fakeVault().storage);
  const input = c.querySelector('[aria-label="Doorstuuradres"]') as HTMLInputElement;
  setValue(input, "ale@invoices.lavega.dev");
  blur(input);
  setValue(input, "invoices@lavega");
  blur(input);
  expect(getInvoiceForwardAddress()).toBe("ale@invoices.lavega.dev");
  expect(c.textContent).toContain("Dat is geen e-mailadres");
});
