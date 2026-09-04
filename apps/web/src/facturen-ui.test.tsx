// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import { makeInvoice, type Invoice } from "@lavega/core";
import Facturen from "./views/Facturen";
import type { N8nNotice, PendingInvoice } from "./n8n";

/* The rebuilt Facturen surface (UI review, 2026-08-16).
 *
 * Two things are checked here and they pull in opposite directions on purpose:
 * the SURFACE must be exactly three ways in and nothing else, while every
 * SAFETY rule must survive the simplification — no silent booking, no invoice
 * without an amount, and no blank currency quietly becoming EUR. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
let saved: Invoice[][] = [];

beforeEach(() => {
  localStorage.clear();
  saved = [];
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function Harness({
  invoices,
  pending: seed,
  entities = ["BV1"],
  defaultEntity = "BV1",
}: {
  invoices: Invoice[];
  pending: PendingInvoice[];
  entities?: string[];
  defaultEntity?: string;
}) {
  const [pending, setPending] = useState<PendingInvoice[]>(seed);
  const [notices, setNotices] = useState<N8nNotice[]>([]);
  return (
    <Facturen
      entities={entities}
      invoices={invoices}
      txs={[]}
      asOf="2026-08-16"
      busy={false}
      defaultEntity={defaultEntity}
      onSaveInvoices={(next) => saved.push(next)}
      pending={pending}
      onPendingChange={setPending}
      notices={notices}
      onNoticesChange={setNotices}
      onNavigate={() => {}}
      fetchImpl={
        (async () => ({
          ok: true,
          status: 200,
          json: async () => ({ invoices: [] }),
        })) as unknown as typeof fetch
      }
    />
  );
}

function render(
  invoices: Invoice[] = [],
  pending: PendingInvoice[] = [],
  entities: string[] = ["BV1"],
  defaultEntity = "BV1",
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Harness
        invoices={invoices}
        pending={pending}
        entities={entities}
        defaultEntity={defaultEntity}
      />,
    );
  });
  return container;
}

function click(el: Element) {
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function field(label: string): HTMLInputElement {
  return container!.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
}

function byText(selector: string, text: string): HTMLElement {
  const hit = [...container!.querySelectorAll(selector)].find((n) =>
    (n.textContent ?? "").includes(text),
  );
  if (!hit) throw new Error(`no ${selector} containing "${text}"`);
  return hit as HTMLElement;
}

/** A dropped file, the way React sees one. jsdom has no DataTransfer, so the
 *  event carries the same `.files` shape the handler reads. */
function drop(zone: Element, file: File) {
  const ev = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: { files: [file] } });
  act(() => {
    zone.dispatchEvent(ev);
  });
}

/** Fill a valid manual invoice, minus whatever the test wants to leave broken. */
function fillManual(
  overrides: Partial<
    Record<"Relatie" | "Factuurdatum" | "Vervaldatum" | "Bedrag" | "Valuta", string>
  > = {},
) {
  const values = {
    Relatie: "ACME BV",
    Factuurdatum: "2026-08-01",
    Vervaldatum: "2026-08-31",
    Bedrag: "121",
    Valuta: "EUR",
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    act(() => setNativeValue(field(label), value));
  }
}

test("the surface is exactly three ways in, and nothing else", () => {
  const c = render();
  const titles = [...c.querySelectorAll(".module-title")].map((n) => n.textContent);
  expect(titles).toEqual(["1 · Automatisch", "2 · Slepen", "3 · Handmatig"]);

  // Exactly one file control, inside the dropzone — the separate "CSV of
  // UBL/XML importeren" and "PDF-factuur lezen met AI" pickers are gone.
  const fileInputs = c.querySelectorAll('input[type="file"]');
  expect(fileInputs).toHaveLength(1);
  expect(fileInputs[0].getAttribute("aria-label")).toBe("Factuurbestand kiezen");
  expect(c.textContent).not.toContain("CSV of UBL/XML importeren");

  expect(c.querySelector(".dropzone")).not.toBeNull();
  expect(byText("button", "Ophalen uit n8n")).toBeTruthy();
});

test("a manual invoice without an amount is refused, out loud, and nothing is booked", () => {
  const c = render();
  fillManual({ Bedrag: "" });
  click(byText("button", "Toevoegen"));

  expect(saved).toHaveLength(0);
  expect(c.textContent).toContain("Vul een geldig bedrag in");
});

test("a blank currency blocks the invoice instead of silently becoming EUR", () => {
  const c = render();
  fillManual({ Valuta: "" });
  click(byText("button", "Toevoegen"));

  expect(saved).toHaveLength(0);
  expect(c.textContent).toContain("LaVega gokt geen euro's");

  // Filled in, it books — with the currency he actually typed.
  fillManual({ Valuta: "USD" });
  click(byText("button", "Toevoegen"));
  expect(saved).toHaveLength(1);
  expect(saved[0][0].currency).toBe("USD");
  expect(saved[0][0].sourceType).toBe("manual");
  expect(saved[0][0].status).toBe("expected");
});

test("dropping a CSV imports its invoices through the same parser", async () => {
  const c = render();
  const csv =
    "Relatie,Bedrag,Factuurdatum,Vervaldatum,Richting\nACME BV,121.00,2026-08-01,2026-08-31,uitgaand\n";
  const file = new File([csv], "facturen.csv", { type: "text/csv" });

  drop(c.querySelector(".dropzone")!, file);
  // handleImportFile reads the file asynchronously.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(saved).toHaveLength(1);
  expect(saved[0]).toHaveLength(1);
  expect(saved[0][0].counterparty).toBe("ACME BV");
  expect(c.textContent).toContain("geïmporteerd");
});

test("a dropped PDF sends nothing while the AI opt-in is off", () => {
  const c = render();
  const file = new File(["%PDF-1.4"], "factuur.pdf", { type: "application/pdf" });
  drop(c.querySelector(".dropzone")!, file);

  expect(saved).toHaveLength(0);
  expect(c.textContent).toContain("Er is niets verstuurd");
  expect((field("AI-facturen lezen") as HTMLInputElement).checked).toBe(false);
});

test("the confirm-first queue still stands between an n8n row and a booking", () => {
  const row: PendingInvoice = {
    messageId: "msg-1",
    subject: "Factuur juli",
    entity: "BV1",
    direction: "out",
    counterparty: "ACME BV",
    invoiceNumber: "1",
    issueDate: "2026-07-01",
    dueDate: "2026-07-31",
    amount: "121.00",
    vat: "",
    currency: "",
  };
  const c = render([], [row]);

  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
  expect(c.textContent).toContain("dit is de enige kopie");
  // No currency was read, so the row says so and refuses to book euros.
  expect(c.textContent).toContain("Geen valuta gevonden");
  click(byText(".n8n-row button", "Bevestigen"));
  expect(saved).toHaveLength(0);
  expect(c.textContent).toContain("LaVega gokt geen euro's");
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1); // kept, not lost
});

/* ── Entiteiten: de zzp'er en de holdingbouwer op hetzelfde scherm ─────────
 *
 * Zijn regel: heeft de gebruiker ondernemingen opgegeven, dan per onderneming;
 * heeft hij ze niet, dan is het één zelfstandige op één rekening en staat het
 * gewoon in het overzicht. Voor die tweede is "entiteit" geen keuze maar
 * jargon — en een keuzelijst met één verzonnen optie erin is een vraag stellen
 * waarop maar één antwoord bestaat. */

function invoice(entity: string, counterparty: string): Invoice {
  return makeInvoice({
    entity,
    direction: "out",
    counterparty,
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    amount: 121,
    currency: "EUR",
    status: "expected",
    sourceType: "manual",
  });
}

test("zonder ondernemingen komt het woord entiteit nergens op het scherm", () => {
  const c = render([], [], [], "Persoonlijk");
  expect(c.querySelector('[aria-label="Entiteit"]')).toBeNull();
  expect(c.textContent).not.toContain("Entiteit");
  expect(c.textContent).not.toContain("onderneming");

  // En zijn factuur boekt gewoon — op de standaard, zonder dat hij iets koos.
  fillManual();
  click(byText("button", "Toevoegen"));
  expect(saved).toHaveLength(1);
  expect(saved[0][0].entity).toBe("Persoonlijk");
});

test("zonder ondernemingen vraagt ook een n8n-regel er niet naar", () => {
  const row: PendingInvoice = {
    messageId: "msg-9",
    subject: "Factuur juli",
    entity: "Persoonlijk",
    direction: "out",
    counterparty: "ACME BV",
    invoiceNumber: "1",
    issueDate: "2026-07-01",
    dueDate: "2026-07-31",
    amount: "121.00",
    vat: "",
    currency: "EUR",
  };
  const c = render([], [row], [], "Persoonlijk");
  expect(c.querySelector('[aria-label="Entiteit (n8n)"]')).toBeNull();

  // Bevestigen boekt hem nog steeds, op diezelfde standaard.
  click(byText("button", "Bevestigen"));
  expect(saved).toHaveLength(1);
  expect(saved[0][0].entity).toBe("Persoonlijk");
});

test("met meerdere ondernemingen zegt de tabel bij welke een factuur hoort", () => {
  const c = render(
    [invoice("Holding BV", "ACME BV"), invoice("Werk BV", "Zeta BV")],
    [],
    ["Holding BV", "Werk BV"],
    "Holding BV",
  );
  const headers = [...c.querySelectorAll("table.table th")].map((n) => n.textContent);
  expect(headers).toContain("Onderneming");
  expect([...c.querySelectorAll('td[data-label="Onderneming"]')].map((n) => n.textContent)).toEqual(
    ["Holding BV", "Werk BV"],
  );
  // En daar is de keuze wél een echte vraag, dus staat de keuzelijst er.
  expect(c.querySelector('[aria-label="Entiteit"]')).not.toBeNull();
});

test("met één onderneming blijft die kolom weg: hij zou op elke regel hetzelfde zeggen", () => {
  const c = render([invoice("BV1", "ACME BV")]);
  const headers = [...c.querySelectorAll("table.table th")].map((n) => n.textContent);
  expect(headers).not.toContain("Onderneming");
});

test("de keuzelijst laat nooit iets anders zien dan waarop geboekt wordt", () => {
  // De standaard-entiteit van de app hoeft niet tussen zijn eigen BV's te zitten.
  // Stond die dan in de state maar niet in de lijst, dan boekte "Toevoegen" op
  // "Persoonlijk" terwijl het scherm "Holding BV" toonde — een factuur op de
  // verkeerde BV, en dat is precies wat scheef in de btw komt te staan.
  const c = render([], [], ["Holding BV", "Werk BV"], "Persoonlijk");
  const select = c.querySelector('[aria-label="Entiteit"]') as HTMLSelectElement;
  expect(select.value).toBe("Holding BV");
  fillManual();
  click(byText("button", "Toevoegen"));
  expect(saved[0][0].entity).toBe("Holding BV");
});

test("met meerdere ondernemingen belooft het scherm geen automatische boeking", () => {
  // De uitleg somt op waaróm iets zichzelf boekt. Met meer dan één onderneming
  // gebeurt dat nooit, dus mag daar niet "je hebt één onderneming" staan — dat
  // is een voorwaarde afvinken die juist níet klopt, en dan wacht hij op een
  // boeking die niet komt.
  const c = render([], [], ["Holding BV", "Werk BV"], "Holding BV");
  expect(c.textContent).not.toContain("je hebt één onderneming");
  expect(c.textContent).toContain("meer dan één onderneming");
});

test("met één onderneming staat die voorwaarde er wél, want dan klopt hij", () => {
  const c = render();
  expect(c.textContent).toContain("je hebt één onderneming");
});
