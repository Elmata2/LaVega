// @vitest-environment jsdom
import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Invoice, N8nAutoBooked, Tx } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import Facturen from "./views/Facturen";
import type { N8nNotice, PendingInvoice } from "./n8n";

/* Does a fetched row (and a notice) survive a tab close? Facturen.tsx now
 * writes every pending row to the vault as it arrives and as it is decided —
 * this file proves the two halves of that contract: the write on fetch, and
 * the write on confirm/reject/dismiss, by hydrating a SECOND, unrelated
 * component tree from the SAME vault after the first is gone. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Same shape as facturen-n8n.test.tsx's fakeVault, extended with the
 *  pending-rows fields this file exercises. */
function fakeVault(seed: { invoiceUrl?: string; invoiceToken?: string } = {}): VaultStorage {
  const state = {
    settings: { invoiceUrl: seed.invoiceUrl, invoiceToken: seed.invoiceToken } as Record<
      string,
      string | undefined
    >,
    autoBooked: [] as N8nAutoBooked[],
    pendingInvoices: [] as unknown[],
    pendingNotices: [] as unknown[],
  };
  return {
    getN8nSettings: async () => ({ ...state.settings }),
    putN8nSettings: async (s: Record<string, string | undefined>) => {
      state.settings = { ...s };
    },
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

const ROW_A = {
  messageId: "msg-a",
  subject: "Factuur A",
  invoiceNumber: "2026-0001",
  issueDate: "2026-07-01",
  dueDate: "2026-07-31",
  amountCents: 10_000,
  vatCents: 2_100,
  currency: "EUR",
  counterparty: "Leverancier A",
  direction: "expense",
};

const ROW_B = {
  ...ROW_A,
  messageId: "msg-b",
  subject: "Factuur B",
  counterparty: "Leverancier B",
};

const NOTICE_A = {
  messageId: "msg-notice-a",
  subject: "Uw factuur staat klaar",
  from: "Leverancier A <noreply@leveranciera.nl>",
  receivedAt: "2026-08-14T02:31:02.000Z",
  kind: "notification",
  reason: "Log in om de factuur te downloaden.",
  mailUrl: "https://mail.google.com/mail/u/0/#all/msg-notice-a",
};

/** Serves `bodies[n]` on the n-th call, like the real webhook draining its
 *  queue on every response. */
function serving(bodies: unknown[]) {
  let call = 0;
  return (async () => {
    const body = bodies[Math.min(call++, bodies.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
}

/** The never-fetching harness: proves hydration alone, with no fetch button
 *  press to fall back on. */
const neverFetch = (async () => {
  throw new Error("this harness must not fetch — it only hydrates from the vault");
}) as unknown as typeof fetch;

/** Facturen's pending rows live in its parent (App, in production); this
 *  harness owns that state exactly like App does, starting empty. */
function Harness({
  fetchImpl,
  storage,
  invoices,
  txs,
}: {
  fetchImpl: typeof fetch;
  storage: VaultStorage;
  invoices: Invoice[];
  txs: Tx[];
}) {
  const [pending, setPending] = useState<PendingInvoice[]>([]);
  const [notices, setNotices] = useState<N8nNotice[]>([]);
  return (
    <Facturen
      entities={["BV1"]}
      ownIbans={[]}
      invoices={invoices}
      txs={txs}
      asOf="2026-08-16"
      busy={false}
      defaultEntity="BV1"
      onSaveInvoices={() => {}}
      pending={pending}
      onPendingChange={setPending}
      notices={notices}
      onNoticesChange={setNotices}
      onNavigate={() => {}}
      fetchImpl={fetchImpl}
      storage={storage}
    />
  );
}

/** Same as Harness, except its initial pending/notices come from the vault —
 *  the same one-shot load App.tsx's "Load persisted data once the vault is
 *  unlocked" effect performs, reproduced here so this file doesn't need to
 *  render all of App. Gated by a ref so a re-render can't re-seed and mask a
 *  write that never actually reached the vault. */
function HydratingHarness({
  fetchImpl,
  storage,
  invoices,
  txs,
}: {
  fetchImpl: typeof fetch;
  storage: VaultStorage;
  invoices: Invoice[];
  txs: Tx[];
}) {
  const [pending, setPending] = useState<PendingInvoice[]>([]);
  const [notices, setNotices] = useState<N8nNotice[]>([]);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    void (async () => {
      const [loadedPending, loadedNotices] = await Promise.all([
        storage.getPendingInvoices(),
        storage.getPendingNotices(),
      ]);
      setPending(loadedPending as PendingInvoice[]);
      setNotices(loadedNotices as N8nNotice[]);
    })();
  }, [storage]);
  return (
    <Facturen
      entities={["BV1"]}
      ownIbans={[]}
      invoices={invoices}
      txs={txs}
      asOf="2026-08-16"
      busy={false}
      defaultEntity="BV1"
      onSaveInvoices={() => {}}
      pending={pending}
      onPendingChange={setPending}
      notices={notices}
      onNoticesChange={setNotices}
      onNavigate={() => {}}
      fetchImpl={fetchImpl}
      storage={storage}
    />
  );
}

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

function mount(el: React.ReactElement): HTMLElement {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(el);
  });
  return container;
}

async function flush() {
  await act(async () => {});
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

test("a fetched row and notice survive the tab closing entirely", async () => {
  const vault = fakeVault({ invoiceUrl: "https://n8n.example/webhook", invoiceToken: "sekret" });

  mount(<Harness fetchImpl={serving([{ invoices: [ROW_A], notices: [NOTICE_A] }])} storage={vault} invoices={[]} txs={[]} />);
  await clickAsync(byText("button", "Ophalen uit n8n"));
  expect(container!.querySelectorAll(".n8n-row[data-messageid]")).toHaveLength(1);
  expect(container!.querySelector('[data-noticeid="msg-notice-a"]')).not.toBeNull();

  act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;

  const c2 = mount(<HydratingHarness fetchImpl={neverFetch} storage={vault} invoices={[]} txs={[]} />);
  await flush();

  const row = c2.querySelector('.n8n-row[data-messageid="msg-a"]');
  expect(row).not.toBeNull();
  const cp = row!.querySelector('[aria-label="Relatie (n8n)"]') as HTMLInputElement;
  expect(cp.value).toBe("Leverancier A");
  expect(c2.querySelector('[data-noticeid="msg-notice-a"]')).not.toBeNull();
});

test("a confirmed row does not come back after a fresh mount, and leaves the vault", async () => {
  const vault = fakeVault({ invoiceUrl: "https://n8n.example/webhook", invoiceToken: "sekret" });

  mount(<Harness fetchImpl={serving([{ invoices: [ROW_A, ROW_B] }])} storage={vault} invoices={[]} txs={[]} />);
  await clickAsync(byText("button", "Ophalen uit n8n"));
  expect(container!.querySelectorAll(".n8n-row[data-messageid]")).toHaveLength(2);

  const rowA = container!.querySelector('.n8n-row[data-messageid="msg-a"]')!;
  const confirmBtn = [...rowA.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Bevestigen"),
  )!;
  await clickAsync(confirmBtn);
  expect(container!.querySelector('.n8n-row[data-messageid="msg-a"]')).toBeNull();

  act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;

  const c2 = mount(<HydratingHarness fetchImpl={neverFetch} storage={vault} invoices={[]} txs={[]} />);
  await flush();

  const rows = [...c2.querySelectorAll(".n8n-row[data-messageid]")].map((r) =>
    r.getAttribute("data-messageid"),
  );
  expect(rows).toEqual(["msg-b"]);

  const stored = await vault.getPendingInvoices();
  expect((stored as { messageId: string }[]).map((r) => r.messageId)).not.toContain("msg-a");
});
