// @vitest-environment jsdom
import { StrictMode, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Invoice, N8nAutoBooked, Tx } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import Facturen, { PULL_INTERVAL_MS } from "./views/Facturen";
import type { N8nNotice, PendingInvoice } from "./n8n";
import { getHandledInvoiceMessageIds } from "./settings";
import { adminCopy } from "./copy/admin.js";
import { TEST_POLL_MS, emptyGuideState } from "./forwardingGuide.js";
import { TOONMEER_CLASS } from "./components/ToonMeer";

/** An in-memory vault, enough for Facturen's n8n block: the auto-booked
 *  fallback log and the pending rows/notices (privacy/security review
 *  2026-08-28, M4/L6 — both moved out of localStorage into the vault
 *  2026-09-08). Whether n8n is configured is no longer a vault field — the
 *  server answers that via GET /api/n8n/forward-address, which the fetchImpl
 *  fixtures below simulate directly (see `localPart` on `serving` and its
 *  siblings). */
function fakeVault(): VaultStorage {
  const state = {
    autoBooked: [] as N8nAutoBooked[],
    pendingInvoices: [] as unknown[],
    pendingNotices: [] as unknown[],
  };
  return {
    getAutoBookedInvoices: async () => [...state.autoBooked],
    putAutoBookedInvoices: async (list: N8nAutoBooked[]) => {
      state.autoBooked = [...list];
    },
    getPendingInvoices: async () => [...state.pendingInvoices],
    putPendingInvoices: async (list: unknown[]) => {
      state.pendingInvoices = [...list];
    },
    getPendingNotices: async () => [...state.pendingNotices],
    putPendingNotices: async (list: unknown[]) => {
      state.pendingNotices = [...list];
    },
  } as unknown as VaultStorage;
}

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
let vault: VaultStorage;

beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=nl; Path=/";
  saved = [];
  vault = fakeVault();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
});

/** Every fetchImpl fixture below is shared between the queue fetch AND the
 *  auto-poll's forward-address probe (Facturen.tsx's `configured()`), because
 *  both now go through the same injected `fetchImpl`. Route on the request URL
 *  so the probe never advances a queue-only call counter or body sequence. */
function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

/** Serves `bodies[n]` on the n-th QUEUE call — the real webhook empties its
 *  queue, so a second fetch legitimately returns something different. Answers
 *  the forward-address probe separately, with `localPart` (a configured
 *  address by default), never counting it as a queue call. */
function serving(bodies: unknown[], localPart: string | null = "ale") {
  let call = 0;
  return (async (input: RequestInfo | URL) => {
    if (urlOf(input).includes("/api/n8n/forward-address")) {
      return { ok: true, status: 200, json: async () => ({ localPart }) };
    }
    const body = bodies[Math.min(call++, bodies.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
}

/** Facturen gets its pending rows from App (they must survive the view
 *  unmounting), so the test owns that state exactly like App does. */
function Harness({
  fetchImpl,
  invoices,
  txs,
  entities,
  storage,
}: {
  fetchImpl: typeof fetch;
  invoices: Invoice[];
  txs: Tx[];
  entities: string[];
  storage?: VaultStorage;
}) {
  const [pending, setPending] = useState<PendingInvoice[]>([]);
  const [notices, setNotices] = useState<N8nNotice[]>([]);
  return (
    <Facturen
      entities={entities}
      ownIbans={[]}
      invoices={invoices}
      txs={txs}
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
      storage={storage ?? vault}
    />
  );
}

function render(
  fetchImpl: typeof fetch,
  invoices: Invoice[] = [],
  txs: Tx[] = [],
  entities: string[] = ["BV1"],
  storage?: VaultStorage,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Harness
        fetchImpl={fetchImpl}
        invoices={invoices}
        txs={txs}
        entities={entities}
        storage={storage}
      />,
    );
  });
  return container;
}

function byText(selector: string, text: string): HTMLElement {
  const hit = [...container!.querySelectorAll(selector)].find((n) =>
    (n.textContent ?? "").includes(text),
  );
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
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The guide lives in a modal: the row's button opens it. */
async function openGuide() {
  await clickAsync(byText("button", adminCopy.nl.facturen.guide.openButton));
}

/** Fresh tree, one press of "Nieuwe facturen ophalen". Each call replaces the previous
 *  render so a test that fetches twice isn't reading a stale DOM. */
async function fetchOnce(
  fetchImpl: typeof fetch,
  invoices: Invoice[] = [],
  txs: Tx[] = [],
  entities: string[] = ["BV1"],
  storage?: VaultStorage,
) {
  if (root) act(() => root!.unmount());
  container?.remove();
  const c = render(fetchImpl, invoices, txs, entities, storage);
  await clickAsync(byText("button", "Nieuwe facturen ophalen"));
  return c;
}

test("a fetched row renders as an editable proposal, and nothing is booked yet", async () => {
  const c = await fetchOnce(serving([{ invoices: [ROW], servedAt: "2026-08-16T09:00:00Z" }]));

  const rows = c.querySelectorAll(".n8n-row");
  expect(rows).toHaveLength(1);
  expect(rows[0].getAttribute("data-messageid")).toBe("msg-1");
  expect(c.textContent).toContain("Factuur juli 2026");

  const value = (label: string) =>
    (c.querySelector(`.n8n-row [aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement)
      .value;
  expect(value("Relatie (te bevestigen)")).toBe("ACME BV");
  expect(value("Bedrag (te bevestigen)")).toBe("121.00");
  expect(value("Btw (te bevestigen)")).toBe("21.00");
  expect(value("Vervaldatum (te bevestigen)")).toBe("2026-07-31");
  expect(value("Richting (te bevestigen)")).toBe("out"); // expense -> AP

  // The row is a proposal: no invoice exists until he confirms.
  expect(saved).toHaveLength(0);
  // And he is told, in the UI, that a refetch will not bring this back.
  expect(c.textContent).toContain("dit is de enige kopie");
  expect(c.textContent).toContain("nog eens ophalen levert deze 1 regel niet terug");
});

test("bevestigen is the one path to a real invoice — with the edits he made", async () => {
  const c = await fetchOnce(serving([{ invoices: [ROW] }]));

  const cp = c.querySelector('.n8n-row [aria-label="Relatie (te bevestigen)"]') as HTMLInputElement;
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

  await clickAsync(byText("button", "Nieuwe facturen ophalen"));
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);
  expect(c.textContent).toContain("Niets nieuws");
  expect(c.textContent).toContain("1 regel(s) kende LaVega al");
  expect(saved).toHaveLength(0);
});

test("a second fetch does not duplicate a row that is still awaiting a decision", async () => {
  const c = await fetchOnce(serving([{ invoices: [ROW] }, { invoices: [ROW] }]));
  await clickAsync(byText("button", "Nieuwe facturen ophalen"));
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
});

test("a row whose invoice is already stored is not booked twice", async () => {
  await fetchOnce(serving([{ invoices: [ROW] }]));
  // Confirm once to learn the exact invoice this row produces.
  click(byText(".n8n-row button", "Bevestigen"));
  const existing = saved[0];
  expect(existing).toHaveLength(1);

  // Same mail again, on a browser that has forgotten it handled this messageId
  // (so the row IS offered), but with that invoice already in the vault. The
  // vault fixture (unlike the old localStorage keys) is untouched by this clear.
  localStorage.clear();
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
  expect(
    (c.querySelector('.n8n-row [aria-label="Vervaldatum (te bevestigen)"]') as HTMLInputElement)
      .value,
  ).toBe("");
  expect(c.textContent).toContain("Geen vervaldatum gevonden");

  click(byText(".n8n-row button", "Bevestigen"));
  expect(saved).toHaveLength(0);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1); // the row is kept, not lost
  expect(c.textContent).toContain("Vul een vervaldatum in");

  const due = c.querySelector(
    '.n8n-row [aria-label="Vervaldatum (te bevestigen)"]',
  ) as HTMLInputElement;
  act(() => setNativeValue(due, "2026-08-15"));
  click(byText(".n8n-row button", "Bevestigen"));
  expect(saved[0][0].dueDate).toBe("2026-08-15");
});

test("an empty queue, a refused token and a dead connection each say their own thing", async () => {
  const c = await fetchOnce(serving([{ invoices: [] }]));
  expect(c.textContent).toContain("Er waren geen nieuwe facturen");
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);

  const denied = (async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  })) as unknown as typeof fetch;
  const c2 = await fetchOnce(denied);
  expect(c2.textContent).toContain("Je bent uitgelogd");
  expect(c2.textContent).toContain("Er is niets opgehaald");

  const dead = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const c3 = await fetchOnce(dead);
  expect(c3.textContent).toContain("Geen antwoord van de LaVega-server");

  const garbled = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ message: "Workflow started" }),
  })) as unknown as typeof fetch;
  const c4 = await fetchOnce(garbled);
  expect(c4.textContent).toContain("niet te lezen");
  expect(c4.textContent).toContain("kan een regel verloren zijn");
});

test("the token-refused and network notices lead with a short line and fold the diagnosis behind ToonMeer", async () => {
  const denied = (async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  })) as unknown as typeof fetch;
  const c = await fetchOnce(denied);
  const unauthorizedDetails = [
    ...c.querySelectorAll<HTMLDetailsElement>(`.${TOONMEER_CLASS.root}`),
  ];
  expect(unauthorizedDetails).toHaveLength(1);
  // Closed by default — dicht betekent niet weg, zie ToonMeer.tsx.
  expect(unauthorizedDetails[0].open).toBe(false);
  expect(unauthorizedDetails[0].textContent).toContain("Er is niets van je mailbox gehaald");
  // The short line is a sibling <p>, not itself inside the closed <details>.
  const shortLine = byText("p.cell-sub", "Je bent uitgelogd");
  expect(shortLine.closest("details")).toBeNull();
  expect(shortLine.textContent).toContain("Er is niets opgehaald");
  // Opens on a click of its own summary, like every other ToonMeer.
  click(unauthorizedDetails[0].querySelector(`.${TOONMEER_CLASS.summary}`)!);
  expect(unauthorizedDetails[0].open).toBe(true);

  const dead = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const c2 = await fetchOnce(dead);
  const networkDetails = [...c2.querySelectorAll<HTMLDetailsElement>(`.${TOONMEER_CLASS.root}`)];
  expect(networkDetails).toHaveLength(1);
  expect(networkDetails[0].open).toBe(false);
  expect(networkDetails[0].textContent).toContain("verbindingsprobleem met LaVega zelf");
  const networkShort = byText("p.cell-sub", "Geen antwoord van de LaVega-server");
  expect(networkShort.closest("details")).toBeNull();
  expect(networkShort.textContent).toContain("hier is niets binnengekomen");
});

test("without the server configured nothing is fetched successfully, and it says so", async () => {
  // The manual button now always calls LaVega's own server — the vault no
  // longer gates it (docs/adr/0006-invoice-queue-server-proxy.md). Whether
  // the queue is configured is the SERVER's answer (503), not a client-side
  // read of now-vestigial vault fields.
  // `called` must count only the QUEUE request this test is about — the
  // auto-poll's forward-address probe also fires on mount (same injected
  // fetchImpl) and is routed away here so it can't inflate this count.
  let called = 0;
  const notConfigured = (async (input: RequestInfo | URL) => {
    if (urlOf(input).includes("/api/n8n/forward-address")) {
      return { ok: true, status: 200, json: async () => ({ localPart: null }) };
    }
    called++;
    return { ok: false, status: 503, json: async () => ({ error: "not configured" }) };
  }) as unknown as typeof fetch;
  const c = await fetchOnce(notConfigured, [], [], ["BV1"], fakeVault());
  expect(called).toBe(1);
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
 *  can arrive while the first is still in flight. `calls` counts QUEUE calls
 *  only — the forward-address probe is answered immediately and separately,
 *  from `localPart`, so it can't itself hang on `deliver`. */
function deferredFetch(localPart: string | null = "ale") {
  let deliver: (body: unknown) => void = () => {};
  const pending = new Promise<unknown>((resolve) => {
    deliver = resolve;
  });
  let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (urlOf(input).includes("/api/n8n/forward-address")) {
      return { ok: true, status: 200, json: async () => ({ localPart }) };
    }
    calls++;
    const body = await pending;
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls, deliver: (body: unknown) => deliver(body) };
}

/** Serves the first body at once and then hands over to a deferred second call —
 *  the shape needed to decide on a row WHILE a later pull is in flight. Same
 *  forward-address routing as `deferredFetch`: the probe never counts as call 1. */
function servingThenDeferred(first: unknown, localPart: string | null = "ale") {
  let deliver: (body: unknown) => void = () => {};
  const later = new Promise<unknown>((resolve) => {
    deliver = resolve;
  });
  let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (urlOf(input).includes("/api/n8n/forward-address")) {
      return { ok: true, status: 200, json: async () => ({ localPart }) };
    }
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
        <Harness fetchImpl={fetchImpl} invoices={invoices} txs={[]} entities={["BV1"]} />
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
  await flush(); // the auto-pull now reads the vault before deciding to fetch
  // React 18 monteert een StrictMode-boom twee keer. Twee GET's zouden hier één
  // wachtrij over twee antwoorden verdelen.
  expect(calls()).toBe(1);

  // En een druk op de knop terwijl er al één loopt, start er geen tweede: hij
  // krijgt hetzelfde verzoek terug.
  click(byText("button", "Nieuwe facturen ophalen"));
  expect(calls()).toBe(1);

  deliver({ invoices: [ROW] });
  await flush();
  expect(calls()).toBe(1);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
});

test("zonder een adres bij n8n wordt er bij het openen niets opgehaald", async () => {
  const { fetchImpl, calls } = deferredFetch(null);
  render(fetchImpl, [], [], ["BV1"], fakeVault());
  await flush();
  // Geen wachtrij-verzoek, en dus ook geen rode melding op een scherm waar hij
  // hem niet kan oplossen — de knop "Koppelingen instellen" staat er wel.
  expect(calls()).toBe(0);
});

test("de timer haalt opnieuw op zolang het scherm open staat, en stopt als het sluit", async () => {
  vi.useFakeTimers();
  try {
    const c = render(serving([{ invoices: [] }, { invoices: [ROW] }]));
    await act(async () => {});
    expect(c.textContent).toContain("Er waren geen nieuwe facturen");

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

  await clickAsync(byText("button", "Nieuwe facturen ophalen")); // start #2, blijft hangen
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

  await clickAsync(byText("button", "Nieuwe facturen ophalen")); // start #2, blijft hangen
  click(byText(".n8n-row button", "Bevestigen"));
  expect(saved).toHaveLength(1);

  // n8n's uurlijkse run over dezelfde week mail biedt hem opnieuw aan.
  deliver({ invoices: [ROW] });
  await flush();
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);
  expect(saved).toHaveLength(1); // en er is niets dubbel geboekt
});

/* ── Wat zichzelf mag boeken ───────────────────────────────────────────────
 *
 * "I don't want the user to click on any of them or link it themselves." Dat
 * zijn twee dingen. KOPPELEN aan een transactie ging al zonder klik. BOEKEN
 * niet — en dat blijft een voorstel, behalve als er niets meer te beslissen
 * valt: de afzender is aantoonbaar echt, er is één onderneming, en de factuur
 * is compleet. Alles wat die grens niet haalt wacht en zegt waarom.
 */

/** Een mail die via het doorstuuradres binnenkwam en de SPF/DKIM-controle
 *  doorstond — het pad dat op Cloudflare gebouwd is. */
const FORWARDED = {
  ...ROW,
  messageId: "fwd-1",
  from: "facturen@acme.nl",
  deliveredTo: "facturen@lavega.dev",
  queueKey: "facturen",
  senderCheck: "passed",
  senderChecks: { spf: "pass", dkim: "pass", dmarc: "none" },
};

const bankTx = (o: Partial<Tx> = {}): Tx => ({
  id: "t1",
  accountKey: "A",
  date: "2026-07-30",
  amount: -121,
  currency: "EUR",
  counterparty: "ACME BV",
  description: "",
  category: "",
  manual: false,
  ...o,
});

test("een geverifieerde, complete factuur boekt zichzelf — hij hoeft niets in te drukken", async () => {
  const c = await fetchOnce(serving([{ invoices: [FORWARDED] }]));

  expect(saved).toHaveLength(1);
  const inv = saved[0][0];
  expect(inv.counterparty).toBe("ACME BV");
  expect(inv.amount).toBe(121);
  expect(inv.status).toBe("expected");
  // Geen wachtende regel: er was niets meer te beslissen.
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);
  // En het staat er met zoveel woorden, want stil zijn boeken veranderen mag niet.
  expect(c.textContent).toContain("zonder jouw klik geboekt");
  // Afgehandeld, dus n8n's volgende ronde biedt hem niet opnieuw aan.
  expect(getHandledInvoiceMessageIds()).toContain("fwd-1");
});

test("wat zichzelf boekt, koppelt zichzelf ook aan een transactie die er al staat", async () => {
  await fetchOnce(serving([{ invoices: [FORWARDED] }]), [], [bankTx()]);
  const inv = saved[0][0];
  expect(inv.status).toBe("paid");
  expect(inv.matchedTxId).toBe("t1");
});

test("bevestigen koppelt óók meteen — niet pas bij de volgende import", async () => {
  // Dezelfde regel, maar zonder afzendercontrole: die blijft een voorstel.
  const c = await fetchOnce(serving([{ invoices: [ROW] }]), [], [bankTx()]);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
  click(byText(".n8n-row button", "Bevestigen"));
  expect(saved[0][0].status).toBe("paid");
  expect(saved[0][0].matchedTxId).toBe("t1");
});

test("een afzender die de controle niet haalde blijft een voorstel, met de echte reden erbij", async () => {
  const c = await fetchOnce(
    serving([
      {
        invoices: [
          {
            ...FORWARDED,
            senderCheck: "failed",
            senderChecks: { spf: "fail", dkim: "fail", dmarc: "fail" },
          },
        ],
      },
    ]),
  );
  expect(saved).toHaveLength(0);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
  // De regel zelf noemt de echte uitslag, en noemt hem nergens geverifieerd:
  // 'failed' is een markering, geen goedkeuring en geen weggegooide regel.
  const row = c.querySelector(".n8n-row")!.textContent ?? "";
  expect(row).toContain("SPF");
  expect(row).toContain("nagemaakte afzender");
  expect(row).not.toContain("geverifieerd");
});

test("zonder afzendercontrole wacht hij, en de melding zegt dat LaVega de afzender niet kan nagaan", async () => {
  const c = await fetchOnce(serving([{ invoices: [ROW] }]));
  expect(saved).toHaveLength(0);
  expect(c.textContent).toContain("niet nagaan wie de afzender is");
});

test("bij meer dan één onderneming boekt niets zichzelf — de BV is een echte keuze", async () => {
  const c = await fetchOnce(serving([{ invoices: [FORWARDED] }]), [], [], ["BV1", "BV2"]);
  expect(saved).toHaveLength(0);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
  expect(c.textContent).toContain("meer dan één onderneming");
});

test("zonder ondernemingen boekt hij wél — nul keuzes is geen openstaande vraag", async () => {
  // De zzp'er met één rekening. De poort eiste "precies één entiteit" en hield
  // hem hier tegen op een keuze die niet bestaat. Er valt niets te gokken, dus
  // boekt de factuur op de standaard van de app — en het scherm legt de
  // automatische boeking uit zonder het woord "onderneming" te gebruiken.
  const c = await fetchOnce(serving([{ invoices: [FORWARDED] }]), [], [], []);
  expect(saved).toHaveLength(1);
  expect(saved[0][0].entity).toBe("BV1");
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);
  expect(c.textContent).toContain("zonder jouw klik geboekt");
  expect(c.textContent).not.toContain("onderneming");
});

test("een geverifieerde maar incomplete factuur wacht, en noemt wat er mist", async () => {
  const c = await fetchOnce(serving([{ invoices: [{ ...FORWARDED, dueDate: null }] }]));
  expect(saved).toHaveLength(0);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(1);
  expect(c.textContent).toContain("vervaldatum");
});

test("een automatisch geboekte factuur is als zodanig te zien en met één klik terug te draaien", async () => {
  const c = await fetchOnce(serving([{ invoices: [FORWARDED] }]));
  const booked = saved[0];
  expect(booked).toHaveLength(1);

  // Opnieuw gemonteerd met de factuur in de kluis: de markering komt uit
  // localStorage, dus hij overleeft een herlaad.
  const c2 = await fetchOnce(serving([{ invoices: [] }]), booked);
  const row = byText("tr", "ACME BV");
  expect(row.textContent).toContain("automatisch");

  saved = [];
  click(byText("tr button", "Terugdraaien"));
  expect(saved).toHaveLength(1);
  expect(saved[0][0].status).toBe("cancelled");
  expect(c2).toBe(container);
  expect(c).toBeTruthy();
});

test("the lavega_locale cookie switches the n8n surface to English", async () => {
  document.cookie = "lavega_locale=en; Path=/";
  const en = adminCopy.en.facturen;

  const c = render(serving([{ invoices: [] }]));
  await flush();
  expect(c.textContent).toContain(en.n8nNotices.emptyQueue);

  if (root) act(() => root!.unmount());
  container?.remove();
  const c2 = render(serving([{ invoices: [ROW] }]));
  await flush();
  expect(c2.textContent).toContain(en.queue.heading);
  expect(c2.textContent).toContain(en.queue.eyebrow(1));
});

test("twee keer dezelfde factuur boekt één keer, ook automatisch", async () => {
  await fetchOnce(serving([{ invoices: [FORWARDED] }]));
  const booked = saved[0];
  saved = [];
  // Zelfde mail, browser die het messageId vergeten is, factuur al in de kluis.
  // De kluis-fixture (anders dan de oude localStorage-sleutels) overleeft dit.
  localStorage.clear();
  const c = await fetchOnce(serving([{ invoices: [FORWARDED] }]), booked);
  expect(saved).toHaveLength(0);
  expect(c.querySelectorAll(".n8n-row")).toHaveLength(0);
  expect(c.textContent).toContain("stond al in LaVega");
});

/* ── De doorstuurgids: setup-mails, polling, groen na het venster ─────────── */

const GUIDE_ADDRESS = "lavega-abcdefghij@invoices.lavega.dev";
const GUIDE_KEY = "lavega.forwardingGuide.v1";

function storedGuide() {
  return JSON.parse(localStorage.getItem(GUIDE_KEY)!);
}

test("setup signals update the guide and are NOT listed under Zelf ophalen", async () => {
  localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
  const c = await fetchOnce(
    serving([
      {
        invoices: [],
        notices: [{ messageId: "g1", kind: "forwarding-confirmation", code: "424242" }],
      },
    ]),
  );
  expect(c.textContent).not.toContain(adminCopy.nl.facturen.notices.heading);
  expect(storedGuide().confirmation.code).toBe("424242");
  expect((await vault.getPendingNotices()).length).toBe(0);
  expect(c.querySelectorAll("[data-noticeid]")).toHaveLength(0);
});

test("the code shows once it arrived, even though the wait began before the fetch", async () => {
  localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
  const c = render(
    serving([
      {
        invoices: [],
        notices: [{ messageId: "g1", kind: "forwarding-confirmation", code: "424242" }],
      },
    ]),
  );
  await openGuide(); // opening on the Gmail tab starts the wait
  await clickAsync(byText("button", "Nieuwe facturen ophalen"));
  expect(c.textContent).toContain(adminCopy.nl.facturen.guide.gmail.step2Code("424242"));
});

test("a setup notice next to a real notice only lists the real one", async () => {
  localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
  const c = await fetchOnce(
    serving([
      {
        invoices: [],
        notices: [{ messageId: "g1", kind: "setup-test", code: "k3x9" }, NOTICE],
      },
    ]),
  );
  expect(c.textContent).toContain(adminCopy.nl.facturen.notices.heading);
  expect(c.querySelectorAll("[data-noticeid]")).toHaveLength(1);
  expect(c.querySelector('[data-noticeid="msg-kpn"]')).not.toBeNull();
  expect((await vault.getPendingNotices()).length).toBe(1);
});

test("an unreadable setup mail shows the notice and it can be dismissed", async () => {
  localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
  const g = adminCopy.nl.facturen.guide;
  const c = await fetchOnce(
    serving([{ invoices: [], notices: [{ messageId: "g1", kind: "setup-test", code: "!!" }] }]),
  );
  await openGuide();
  expect(c.textContent).toContain(g.setupUnreadable.message);
  await clickAsync(byText("button", g.setupUnreadable.dismiss));
  expect(c.textContent).not.toContain(g.setupUnreadable.message);
});

function pollingFixture() {
  let queueCalls = 0;
  const impl = (async (input: RequestInfo | URL) => {
    if (urlOf(input).includes("/api/n8n/forward-address"))
      return { ok: true, status: 200, json: async () => ({ localPart: "lavega-abcdefghij" }) };
    queueCalls++;
    return { ok: true, status: 200, json: async () => ({ invoices: [], notices: [] }) };
  }) as unknown as typeof fetch;
  return { impl, calls: () => queueCalls };
}

test("while a test is pending Facturen fetches every 20 seconds and stops after 10 minutes", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
    // Outlook tab: no code wait, so only the test drives polling.
    localStorage.setItem(
      GUIDE_KEY,
      JSON.stringify({ ...emptyGuideState(), tab: "outlook", setupUnreadable: 0 }),
    );
    const fx = pollingFixture();
    const c = render(fx.impl);
    await act(async () => {});
    const idle = fx.calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fx.calls()).toBe(idle); // nothing to wait for, no 20 s polling
    await openGuide(); // Outlook tab: opening starts no wait
    click(byText("button", adminCopy.nl.facturen.guide.test.startButton));
    const before = fx.calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fx.calls() - before).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11 * 60_000);
    });
    const after = fx.calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fx.calls()).toBe(after);
    expect(c.textContent).toContain(adminCopy.nl.facturen.guide.test.timedOut);
  } finally {
    vi.useRealTimers();
  }
});

test("the Gmail tab waits for the code with the same 20 second poll, and unmount stops it", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
    const fx = pollingFixture();
    render(fx.impl);
    await act(async () => {});
    await openGuide();
    const before = fx.calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fx.calls() - before).toBe(3);
    act(() => root!.unmount());
    root = null;
    const after = fx.calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fx.calls()).toBe(after);
  } finally {
    vi.useRealTimers();
  }
});

test("a result that lands after the window still turns the guide green", async () => {
  localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
  const twentyMinutesAgo = Date.now() - 20 * 60 * 1000;
  localStorage.setItem(
    GUIDE_KEY,
    JSON.stringify({
      ...emptyGuideState(),
      test: { code: "k3x9", startedAtMs: twentyMinutesAgo, receivedAtMs: null, receivedCode: null },
    }),
  );
  const c = await fetchOnce(
    serving([{ invoices: [], notices: [{ messageId: "t1", kind: "setup-test", code: "k3x9" }] }]),
  );
  const g = adminCopy.nl.facturen.guide;
  expect(c.textContent).not.toContain(g.test.timedOut);
  expect(c.textContent).toContain(g.rowPassed("").trim());
});

/* ── Fix round 1: no lost code, quiet background polls ────────────────────── */

test("a code fetched while the Gmail tab appears survives the wait start", async () => {
  localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
  // The open-the-screen pull races the card's mount effect (which starts the wait).
  const c = render(
    serving([
      {
        invoices: [],
        notices: [{ messageId: "g1", kind: "forwarding-confirmation", code: "424242" }],
      },
    ]),
  );
  await openGuide(); // the wait starts while the open-the-screen pull is in flight
  await flush();
  expect(c.textContent).toContain(adminCopy.nl.facturen.guide.gmail.step2Code("424242"));
  expect(storedGuide().confirmation.code).toBe("424242");
});

test("a background poll leaves the status line and the fetch button alone, and a hidden tab skips it", async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get");
  try {
    localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
    const fx = pollingFixture();
    const c = render(fx.impl);
    await act(async () => {});
    await openGuide();
    const note = adminCopy.nl.facturen.n8nNotices;
    expect(c.textContent).toContain(note.emptyQueue); // the open-pull's own result
    const button = byText("button", "Nieuwe facturen ophalen") as HTMLButtonElement;
    // Hold the next queue response open: while a background poll is in flight,
    // nothing may flip to "fetching" or disable the button.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let queueCalls = 0;
    const slow = (async (input: RequestInfo | URL) => {
      if (urlOf(input).includes("/api/n8n/forward-address"))
        return { ok: true, status: 200, json: async () => ({ localPart: "x" }) };
      if (queueCalls++ > 0) await gate; // the open-pull answers; the poll hangs
      return { ok: true, status: 200, json: async () => ({ invoices: [], notices: [] }) };
    }) as unknown as typeof fetch;
    act(() => root!.unmount());
    root = null;
    const c2 = render(slow);
    await act(async () => {});
    await openGuide();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEST_POLL_MS);
    });
    expect(c2.textContent).not.toContain(note.fetching);
    expect((byText("button", "Nieuwe facturen ophalen") as HTMLButtonElement).disabled).toBe(false);
    release();
    await act(async () => {});
    void button;

    // A hidden tab does not poll.
    act(() => root!.unmount());
    root = null;
    const fx2 = pollingFixture();
    render(fx2.impl);
    await act(async () => {});
    await openGuide();
    hidden.mockReturnValue(true);
    const before = fx2.calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fx2.calls()).toBe(before);
    hidden.mockReturnValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEST_POLL_MS);
    });
    expect(fx2.calls()).toBe(before + 1);
  } finally {
    hidden.mockRestore();
    vi.useRealTimers();
  }
});

test("the guide poll is one 20 s interval, created once and cleared on unmount", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    render(pollingFixture().impl);
    await act(async () => {});
    await openGuide();
    const polls = () => setSpy.mock.calls.filter((a) => a[1] === TEST_POLL_MS);
    expect(polls()).toHaveLength(1);
    const pollId =
      setSpy.mock.results[setSpy.mock.calls.findIndex((a) => a[1] === TEST_POLL_MS)].value;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * TEST_POLL_MS);
    });
    expect(polls()).toHaveLength(1); // clock updates did not recreate it
    act(() => root!.unmount());
    root = null;
    expect(clearSpy.mock.calls.some((a) => a[0] === pollId)).toBe(true);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  } finally {
    vi.useRealTimers();
  }
});

test("a click that joins a held-open background poll upgrades it: note shown, button re-enabled", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let queueCalls = 0;
    const slow = (async (input: RequestInfo | URL) => {
      if (urlOf(input).includes("/api/n8n/forward-address"))
        return { ok: true, status: 200, json: async () => ({ localPart: "x" }) };
      if (queueCalls++ > 0) await gate;
      return { ok: true, status: 200, json: async () => ({ invoices: [], notices: [] }) };
    }) as unknown as typeof fetch;
    const c = render(slow);
    await act(async () => {});
    await openGuide();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEST_POLL_MS);
    });
    const note = adminCopy.nl.facturen.n8nNotices;
    expect(c.textContent).not.toContain(note.fetching);
    const button = () => byText("button", "Nieuwe facturen ophalen") as HTMLButtonElement;
    await clickAsync(button());
    expect(c.textContent).toContain(note.fetching);
    expect(button().disabled).toBe(true);
    release();
    await act(async () => {});
    expect(button().disabled).toBe(false);
    expect(c.textContent).not.toContain(note.fetching);
    expect(c.textContent).toContain(note.emptyQueue);
  } finally {
    vi.useRealTimers();
  }
});

/* ── The guide is a modal: closing it must not stop or lose anything ──────── */

function guideDialog(): HTMLDialogElement {
  return container!.querySelector("dialog")!;
}

function codeAfterFirstPull() {
  let queueCalls = 0;
  return (async (input: RequestInfo | URL) => {
    if (urlOf(input).includes("/api/n8n/forward-address"))
      return { ok: true, status: 200, json: async () => ({ localPart: "lavega-abcdefghij" }) };
    const notices =
      queueCalls++ === 0
        ? []
        : [{ messageId: "g1", kind: "forwarding-confirmation", code: "424242" }];
    return { ok: true, status: 200, json: async () => ({ invoices: [], notices }) };
  }) as unknown as typeof fetch;
}

test("a code fetched while the modal is closed survives, shows in the row and in the reopened modal", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
    const g = adminCopy.nl.facturen.guide;
    const c = render(codeAfterFirstPull());
    await act(async () => {});
    await openGuide(); // Gmail tab: the wait starts
    await clickAsync(c.querySelector(`button[aria-label="${g.closeButton}"]`)!);
    expect(guideDialog().open).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEST_POLL_MS); // the poll keeps running while closed
    });
    expect(storedGuide().confirmation.code).toBe("424242");
    expect(c.querySelector('section[aria-label] [role="status"]')?.textContent).toBe(
      g.rowStatus["code-shown"],
    );
    expect(c.textContent).not.toContain(g.gmail.step2Code("424242")); // not rendered while closed
    await openGuide();
    expect(guideDialog().open).toBe(true);
    expect(c.textContent).toContain(g.gmail.step2Code("424242"));
  } finally {
    vi.useRealTimers();
  }
});

test("closing the modal does not stop a pending test from polling", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
    localStorage.setItem(
      GUIDE_KEY,
      JSON.stringify({ ...emptyGuideState(), tab: "outlook", setupUnreadable: 0 }),
    );
    const g = adminCopy.nl.facturen.guide;
    const fx = pollingFixture();
    const c = render(fx.impl);
    await act(async () => {});
    await openGuide();
    click(byText("button", g.test.startButton));
    await clickAsync(c.querySelector(`button[aria-label="${g.closeButton}"]`)!);
    expect(guideDialog().open).toBe(false);
    const before = fx.calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fx.calls() - before).toBe(3);
    expect(c.querySelector('section[aria-label] [role="status"]')?.textContent).toBe(
      g.rowStatus["test-pending"],
    );
  } finally {
    vi.useRealTimers();
  }
});

test("arriving on #forwarding-guide opens the modal on the Gmail tab and starts the code wait", async () => {
  localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
  window.history.replaceState(null, "", `${window.location.pathname}#forwarding-guide`);
  const c = render(serving([{ invoices: [] }]));
  await flush();
  expect(guideDialog().open).toBe(true);
  expect(window.location.hash).toBe("");
  expect(c.textContent).toContain(adminCopy.nl.facturen.guide.gmail.step2Waiting);
  expect(storedGuide().codeWaitStartedAtMs).not.toBeNull();
});

test("a code pulled before the modal opens is current once it opens", async () => {
  localStorage.setItem("lavega.invoiceForwardAddress", GUIDE_ADDRESS);
  const g = adminCopy.nl.facturen.guide;
  const c = render(
    serving([
      {
        invoices: [],
        notices: [{ messageId: "g1", kind: "forwarding-confirmation", code: "424242" }],
      },
    ]),
  );
  await flush();
  expect(c.querySelector('section [role="status"]')?.textContent).toBe(g.rowStatus["code-shown"]);
  await openGuide();
  expect(c.textContent).toContain(g.gmail.step2Code("424242"));
});
