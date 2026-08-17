// @vitest-environment jsdom
import { StrictMode, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Invoice } from "@lavega/core";
import Facturen, { PULL_INTERVAL_MS } from "./views/Facturen";
import type { N8nNotice, PendingInvoice } from "./n8n";
import { getHandledInvoiceMessageIds, setN8nInvoiceToken, setN8nInvoiceUrl } from "./settings";

/* The confirm-first review queue in Facturen. What matters here is not the
 * markup but the promises the feature makes: a fetched row is only ever a
 * PROPOSAL, confirming is the single path to an Invoice, rejecting books
 * nothing, and a messageId that was already decided is never put in front of
 * him twice (n8n re-queues the same week of mail every hour). */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW = {
  messageId: "msg-1",
  subject: "Factuur juli 2026",
  invoiceNumber: "2026-0042",
  issueDate: "2026-07-01",
  dueDate: "2026-07-31",
  amountCents: 12_100,
  vatCents: 2_100,
  currency: "EUR",
  counterparty: "ACME BV",
  direction: "expense",
};

let root: Root | null = null;
let container: HTMLElement | null = null;
let saved: Invoice[][] = [];

beforeEach(() => {
  localStorage.clear();
  saved = [];
  setN8nInvoiceUrl("https://n8n.example/webhook/lavega-facturen");
  setN8nInvoiceToken("sekret");
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Serves `bodies[n]` on the n-th call — the real webhook empties its queue, so
 *  a second fetch legitimately returns something different. */
function serving(bodies: unknown[]) {
  let call = 0;
  return (async () => {
    const body = bodies[Math.min(call++, bodies.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
}

/** Facturen gets its pending rows from App (they must survive the view
 *  unmounting), so the test owns that state exactly like App does. */
function Harness({ fetchImpl, invoices }: { fetchImpl: typeof fetch; invoices: Invoice[] }) {
  const [pending, setPending] = useState<PendingInvoice[]>([]);
  const [notices, setNotices] = useState<N8nNotice[]>([]);
  return (
    <Facturen
      entities={["BV1"]}
      invoices={invoices}
      txs={[]}
      asOf="2026-08-16"
      busy={false}
      defaultEntity="BV1"
      onSaveInvoices={(next) => saved.push(next)}
      pending={pending}
      onPendingChange={setPending}
      notices={notices}
      onNoticesChange={setNotices}
      onNavigate={() => {}}
      fetchImpl={fetchImpl}
    />
  );
}

function render(fetchImpl: typeof fetch, invoices: Invoice[] = []) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness fetchImpl={fetchImpl} invoices={invoices} />);
  });
  return container;
}

function byText(selector: string, text: string): HTMLElement {
  const hit = [...container!.querySelectorAll(selector)].find((n) => (n.textContent ?? "").includes(text));
  if (!hit) throw new Error(`no ${selector} containing "${text}"`);
  return hit as HTMLElement;
}

async function clickAsync(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Fresh tree, one press of "Ophalen uit n8n". Each call replaces the previous
 *  render so a test that fetches twice isn't reading a stale DOM. */
async function fetchOnce(fetchImpl: typeof fetch, invoices: Invoice[] = []) {
  if (root) act(() => root!.unmount());
  container?.remove();
  const c = render(fetchImpl, invoices);
  await clickAsync(byText("button", "Ophalen uit n8n"));
  return c;
}

test("a fetched row renders as an editable proposal, and nothing is booked yet", async () => {
  const c = await fetchOnce(serving([{ invoices: [ROW], servedAt: "2026-08-16T09:00:00Z" }]));

  const rows = c.querySelectorAll(".n8n-row");
  expect(rows).toHaveLength(1);
  expect(rows[0].getAttribute("data-messageid")).toBe("msg-1");
  expect(c.textContent).toContain("Factuur juli 2026");

  const value = (label: string) =>
    (c.querySelector(`.n8n-row [aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement).value;
  expect(value("Relatie (n8n)")).toBe("ACME BV");
  expect(value("Bedrag (n8n)")).toBe("121.00");
  expect(value("Btw (n8n)")).toBe("21.00");
  expect(value("Vervaldatum (n8n)")).toBe("2026-07-31");
  expect(value("Richting (n8n)")).toBe("out"); // expense -> AP

  // The row is a proposal: no invoice exists until he confirms.
  expect(saved).toHaveLength(0);
  // And he is told, in the UI, that a refetch will not bring this back.
  expect(c.textContent).toContain("dit is de enige kopie");
  expect(c.textContent).toContain("nog eens ophalen levert deze 1 regel niet terug");
});

test("bevestigen is the one path to a real invoice — with the edits he made", async () => {
  const c = await fetchOnce(serving([{ invoices: [ROW] }]));

  const cp = c.querySelector('.n8n-row [aria-label="Relatie (n8n)"]') as HTMLInputElement;
  act(() => setNativeValue(cp, "ACME Nederland BV"));
  click(byText(".n8n-row button", "Bevestigen"));

  expect(saved).toHaveLength(1);
  expect(saved[0]).toHaveLength(1);
  const inv = saved[0][0];
  expect(inv.counterparty).toBe("ACME Nederland BV"); // the edit, not the model's text
  expect(inv.amount).toBe(121);
  expect(inv.vatAmount).toBe(21);
  expect(inv.direction).toBe("out");
  expect(inv.status).toBe("expected");
  expect(inv.sourceType).toBe("llm");
  expect(inv.entity).toBe("BV1");

  // Decided, so the row leaves the queue.
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);
});

test("verwerpen books nothing at all", async () => {
  const c = await fetchOnce(serving([{ invoices: [ROW] }]));
  click(byText(".n8n-row button", "Verwerpen"));

  expect(saved).toHaveLength(0);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);
  expect(c.textContent).toContain("Er is niets geboekt");
});

test("a messageId that was already decided is not offered a second time", async () => {
  // n8n re-queues the same week of mail every hour, so the identical row comes
  // back on the next fetch even though its queue was emptied in between.
  const c = await fetchOnce(serving([{ invoices: [ROW] }, { invoices: [ROW] }]));
  click(byText(".n8n-row button", "Verwerpen"));
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);

  await clickAsync(byText("button", "Ophalen uit n8n"));
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);
  expect(c.textContent).toContain("Niets nieuws");
  expect(c.textContent).toContain("1 regel(s) kende LaVega al");
  expect(saved).toHaveLength(0);
});

test("a second fetch does not duplicate a row that is still awaiting a decision", async () => {
  const c = await fetchOnce(serving([{ invoices: [ROW] }, { invoices: [ROW] }]));
  await clickAsync(byText("button", "Ophalen uit n8n"));
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
});

test("a row whose invoice is already stored is not booked twice", async () => {
  const c = await fetchOnce(serving([{ invoices: [ROW] }]));
  // Confirm once to learn the exact invoice this row produces.
  click(byText(".n8n-row button", "Bevestigen"));
  const existing = saved[0];
  expect(existing).toHaveLength(1);

  // Same mail again, on a browser that has forgotten it handled this messageId
  // (so the row IS offered), but with that invoice already in the vault.
  localStorage.clear();
  setN8nInvoiceUrl("https://n8n.example/webhook/lavega-facturen");
  setN8nInvoiceToken("sekret");
  saved = [];
  const c2 = await fetchOnce(serving([{ invoices: [ROW] }]), existing);
  expect(c2.querySelectorAll(".n8n-row")).toHaveLength(1);
  click(byText(".n8n-row button", "Bevestigen"));
  expect(saved).toHaveLength(0); // no save call at all -> nothing duplicated
  expect(c2.textContent).toContain("stond al in LaVega");
  expect(c2.querySelectorAll(".n8n-row")).toHaveLength(0); // decided, so it leaves the queue
});

test("a missing due date blocks confirming instead of inventing a payment term", async () => {
  const c = await fetchOnce(serving([{ invoices: [{ ...ROW, dueDate: null }] }]));
  expect((c.querySelector('.n8n-row [aria-label="Vervaldatum (n8n)"]') as HTMLInputElement).value).toBe("");
  expect(c.textContent).toContain("Geen vervaldatum gevonden");

  click(byText(".n8n-row button", "Bevestigen"));
  expect(saved).toHaveLength(0);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1); // the row is kept, not lost
  expect(c.textContent).toContain("Vul een vervaldatum in");

  const due = c.querySelector('.n8n-row [aria-label="Vervaldatum (n8n)"]') as HTMLInputElement;
  act(() => setNativeValue(due, "2026-08-15"));
  click(byText(".n8n-row button", "Bevestigen"));
  expect(saved[0][0].dueDate).toBe("2026-08-15");
});

test("an empty queue, a refused token and a dead connection each say their own thing", async () => {
  const c = await fetchOnce(serving([{ invoices: [] }]));
  expect(c.textContent).toContain("De wachtrij in n8n was leeg");
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);

  const denied = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
  const c2 = await fetchOnce(denied);
  expect(c2.textContent).toContain("weigerde het token (401)");
  expect(c2.textContent).toContain("Er is niets opgehaald");

  const dead = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const c3 = await fetchOnce(dead);
  expect(c3.textContent).toContain("Geen antwoord van n8n");

  const garbled = (async () => ({ ok: true, status: 200, json: async () => ({ message: "Workflow started" }) })) as unknown as typeof fetch;
  const c4 = await fetchOnce(garbled);
  expect(c4.textContent).toContain("niet te lezen");
  expect(c4.textContent).toContain("kan die rij verloren zijn");
});

test("without a URL and token nothing is fetched, and it says so", async () => {
  localStorage.clear();
  let called = 0;
  const counting = (async () => {
    called++;
    return { ok: true, status: 200, json: async () => ({ invoices: [] }) };
  }) as unknown as typeof fetch;
  const c = await fetchOnce(counting);
  expect(called).toBe(0);
  expect(c.textContent).toContain("Nog niet ingesteld");
});

/* ── Zelf ophalen: de mail die geen boekbare factuur was ─────────────────── */

const NOTICE = {
  messageId: "msg-kpn",
  subject: "Uw factuur van augustus staat voor u klaar",
  from: "KPN <noreply@kpn.com>",
  receivedAt: "2026-08-14T02:31:02.000Z",
  kind: "notification",
  reason: "De factuur staat in MijnKPN; log in om hem te downloaden.",
  mailUrl: "https://mail.google.com/mail/u/0/#all/msg-kpn",
};

test("a link-only mail shows up as a to-do with no amount and no way to book it", async () => {
  const c = await fetchOnce(serving([{ invoices: [], notices: [NOTICE] }]));

  expect(c.textContent).toContain("Zelf ophalen");
  expect(c.textContent).toContain("Staat klaar bij de leverancier");
  expect(c.textContent).toContain("log in om hem te downloaden");
  // Geen invoerveld, geen Bevestigen: er valt niets te boeken.
  const notice = c.querySelector('[data-noticeid="msg-kpn"]')!;
  expect(notice.querySelectorAll("input")).toHaveLength(0);
  expect(notice.textContent).not.toContain("Bevestigen");
  // De link gaat naar zijn eigen mailbox, niet naar de leverancier.
  expect((notice.querySelector("a") as HTMLAnchorElement).href).toBe(
    "https://mail.google.com/mail/u/0/#all/msg-kpn",
  );
  // En er is niets geboekt.
  expect(saved).toEqual([]);
});

test("Gedaan files the notice as handled so the hourly re-scan can't put it back", async () => {
  const c = await fetchOnce(serving([{ invoices: [], notices: [NOTICE] }]));
  click(byText("button", "Gedaan"));
  expect(c.querySelector('[data-noticeid="msg-kpn"]')).toBeNull();
  expect(getHandledInvoiceMessageIds()).toContain("msg-kpn");
  expect(saved).toEqual([]);

  // Tweede ophaal met dezelfde melding: hij komt niet terug.
  const again = await fetchOnce(serving([{ invoices: [], notices: [NOTICE] }]));
  expect(again.querySelector('[data-noticeid="msg-kpn"]')).toBeNull();
});

/* ── Automatisch ophalen ────────────────────────────────────────────────────
 *
 * De knop hoeft niet meer. Wat WEL moet blijven kloppen, en waarom het hier
 * getest wordt: de webhook leegt zijn wachtrij terwijl hij antwoordt, dus een
 * opgehaalde regel is de enige kopie die bestaat. Twee gelijktijdige verzoeken
 * zouden één wachtrij over twee antwoorden verdelen, en een ophaalactie die
 * begon vóór een beslissing zou die beslissing kunnen terugdraaien. */

/** A fetch whose response the test decides when to deliver, so a second caller
 *  can arrive while the first is still in flight. */
function deferredFetch() {
  let deliver: (body: unknown) => void = () => {};
  const pending = new Promise<unknown>((resolve) => {
    deliver = resolve;
  });
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    const body = await pending;
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls, deliver: (body: unknown) => deliver(body) };
}

/** Serves the first body at once and then hands over to a deferred second call —
 *  the shape needed to decide on a row WHILE a later pull is in flight. */
function servingThenDeferred(first: unknown) {
  let deliver: (body: unknown) => void = () => {};
  const later = new Promise<unknown>((resolve) => {
    deliver = resolve;
  });
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    const body = calls === 1 ? first : await later;
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls, deliver: (body: unknown) => deliver(body) };
}

function renderStrict(fetchImpl: typeof fetch, invoices: Invoice[] = []) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <StrictMode>
        <Harness fetchImpl={fetchImpl} invoices={invoices} />
      </StrictMode>,
    );
  });
  return container;
}

async function flush() {
  await act(async () => {});
}

test("de wachtrij wordt opgehaald zodra Facturen opent — zonder dat hij iets indrukt", async () => {
  const c = render(serving([{ invoices: [ROW] }]));
  await flush();
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
  expect(c.textContent).toContain("1 factuur opgehaald");
  expect(saved).toHaveLength(0); // nog steeds niets geboekt: het blijft een voorstel
});

test("openen haalt precies ÉÉN keer op, ook onder StrictMode en ook als hij intussen op de knop drukt", async () => {
  const { fetchImpl, calls, deliver } = deferredFetch();
  const c = renderStrict(fetchImpl);
  // React 18 monteert een StrictMode-boom twee keer. Twee GET's zouden hier één
  // wachtrij over twee antwoorden verdelen.
  expect(calls()).toBe(1);

  // En een druk op de knop terwijl er al één loopt, start er geen tweede: hij
  // krijgt hetzelfde verzoek terug.
  click(byText("button", "Ophalen uit n8n"));
  expect(calls()).toBe(1);

  deliver({ invoices: [ROW] });
  await flush();
  expect(calls()).toBe(1);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
});

test("zonder URL en token wordt er bij het openen niets opgehaald", async () => {
  localStorage.clear();
  const { fetchImpl, calls } = deferredFetch();
  render(fetchImpl);
  await flush();
  // Geen verzoek, en dus ook geen rode melding op een scherm waar hij hem niet
  // kan oplossen — de knop "Koppelingen instellen" staat er wel.
  expect(calls()).toBe(0);
});

test("de timer haalt opnieuw op zolang het scherm open staat, en stopt als het sluit", async () => {
  vi.useFakeTimers();
  try {
    const c = render(serving([{ invoices: [] }, { invoices: [ROW] }]));
    await act(async () => {});
    expect(c.textContent).toContain("De wachtrij in n8n was leeg");

    await act(async () => {
      vi.advanceTimersByTime(PULL_INTERVAL_MS);
    });
    await act(async () => {});
    expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

test("een regel die hij afhandelt terwijl er een ophaalactie loopt, komt niet terug", async () => {
  // ROW komt binnen bij het openen. Daarna start een tweede ophaalactie die pas
  // later antwoordt; ondertussen verwerpt hij ROW. Het antwoord van die tweede
  // actie mag ROW niet terugzetten — dat zou een beslissing ongedaan maken.
  const { fetchImpl, deliver } = servingThenDeferred({ invoices: [ROW] });
  const c = render(fetchImpl);
  await flush();
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);

  await clickAsync(byText("button", "Ophalen uit n8n")); // start #2, blijft hangen
  click(byText(".n8n-row button", "Verwerpen"));
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);

  const OTHER = { ...ROW, messageId: "msg-2", counterparty: "Andere BV" };
  deliver({ invoices: [OTHER] });
  await flush();

  const rows = [...c.querySelectorAll(".n8n-row")].map((r) => r.getAttribute("data-messageid"));
  expect(rows).toEqual(["msg-2"]); // de nieuwe regel wél, de verworpen niet
  expect(saved).toHaveLength(0);
});

test("een regel die hij bevestigt terwijl er een ophaalactie loopt, wordt niet opnieuw aangeboden", async () => {
  const { fetchImpl, deliver } = servingThenDeferred({ invoices: [ROW] });
  const c = render(fetchImpl);
  await flush();

  await clickAsync(byText("button", "Ophalen uit n8n")); // start #2, blijft hangen
  click(byText(".n8n-row button", "Bevestigen"));
  expect(saved).toHaveLength(1);

  // n8n's uurlijkse run over dezelfde week mail biedt hem opnieuw aan.
  deliver({ invoices: [ROW] });
  await flush();
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);
  expect(saved).toHaveLength(1); // en er is niets dubbel geboekt
});
