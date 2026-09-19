import { useEffect, useMemo, useRef, useState } from "react";
import type { Invoice, Tx } from "@lavega/core";
import {
  makeInvoice,
  parseInvoiceFile,
  reconcileInvoices,
  scheduledInvoiceFlows,
} from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import type { View } from "../App";
import { formatEuroIn } from "../format.js";
import { useAppLocale } from "../appLocale.js";
import { adminCopy, type AdminCopy } from "../copy/admin.js";
import { API_BASE } from "../api";
import Module from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import Badge from "../components/ui/Badge.js";
import Button, { buttonVariants } from "../components/ui/Button.js";
import Card, { CardHeader } from "../components/ui/Card.js";
import SaldoInput from "../components/ui/SaldoInput.js";
import ToonMeer from "../components/ToonMeer.js";
import { resolveInvoiceParties } from "../invoiceParty.js";
import { Table, TableWrap, Th, Td } from "../components/ui/Table.js";
import {
  addHandledInvoiceMessageIds,
  getAiExtractionEnabled,
  getHandledInvoiceMessageIds,
  getN8nSettings,
  setAiExtractionEnabled,
} from "../settings";
import {
  autoBookDecision,
  type AutoBookHold,
  bookingEntity,
  fetchQueue,
  forgetAutoBooked,
  getAutoBookedInvoices,
  pendingToInvoice,
  rememberAutoBooked,
  toPending,
  type N8nNotice,
  type PendingInvoice,
} from "../n8n";
import "../styles/views.css";

/* Facturen — reduced to EXACTLY three ways in (UI review, 2026-08-16):
 *
 *   1. the automatic feed from his own n8n,
 *   2. drag & drop of an invoice file (PDF / CSV / UBL-XML),
 *   3. manual entry.
 *
 * Only the SURFACE was simplified. Every safety rule the feature had is still
 * here and still enforced in the same place:
 *   - a row without a valid amount is refused (pendingToInvoice / handleAdd);
 *   - an unreadable currency blocks the row instead of silently becoming EUR —
 *     for the n8n queue AND for manual entry;
 *   - the AI PDF read stays opt-in, per document, and only pre-fills a draft.
 *
 * WHAT CHANGED (20 August 2026), and why the old "nothing books itself" is now
 * "almost nothing books itself":
 *
 * He asked for a forwarded invoice to end up linked without him clicking. That
 * is TWO acts, and they never deserved the same treatment:
 *
 *   BOOKING  — turning a mail into a financial record. It lands in his
 *              administration and in his BTW figures.
 *   LINKING  — hanging a booked invoice on a bank transaction. reconcileInvoices
 *              has always done this by itself, and it is reversible.
 *
 * MEASURED before changing anything: linking was already automatic, but only on
 * a bank sync or a file import (App.tsx) — so an invoice confirmed today whose
 * payment already went out last week sat at "expected" until the next import.
 * That is fixed here: every path that BOOKS an invoice now reconciles the whole
 * list against the transactions on hand, immediately. Both the auto path and
 * "Bevestigen".
 *
 * Booking is the dangerous half — a forwarded mail comes from outside, and
 * whoever knows the forwarding address can try to get something into his books.
 * So a row still has to earn it, and `autoBookDecision` (see n8n.ts) is the
 * whole rule: a verified sender, no open question about the entity, and a
 * complete invoice. Everything else stays a proposal AND carries the reason it
 * waits.
 *
 * "No open question" is two cases, not one — and that cost him an evening. The
 * gate demanded EXACTLY ONE entity, so the freelancer who never entered any
 * entities was held at a choice that does not exist. Zero entities is the
 * answer, not a missing one: everything is his, it books on the app's default,
 * and the word "entiteit" never appears on this screen. Two or more IS a real
 * question, and it is still asked exactly once.
 * What does book itself is visible as automatic (the "automatisch" badge, from
 * the auto-booked log) and reversible in one click ("Terugdraaien" → cancelled,
 * which drops it out of the forecast without deleting the record). Something
 * silent that changes his books is worse than a click.
 */

/** Shape returned by our own server proxy (POST /api/agent/extract-invoice).
 *  The browser only ever talks to our server — never api.mistral.ai. */
type ExtractResponse = {
  fields: {
    /* WHAT IS PRINTED, not who the owner is. The agent used to answer
     * `counterparty` and `direction`, both of which are defined relative to
     * him — and it is deliberately never told who he is. Measured 17 Sep on
     * mistral-small and mistral-medium: both answered "out" every time and
     * named the issuer, so every invoice he SENT booked as a cost. Direction
     * is now decided in invoiceParty.ts, against accounts and entity labels
     * that never leave the browser. */
    seller: string;
    buyer: string;
    payeeIban?: string;
    invoiceNumber?: string;
    amount: number;
    currency?: string;
    issueDate: string;
    dueDate?: string;
    vatAmount?: number;
  };
  /** The model's OWN self-reported certainty (0..1), or null when it gave none.
   *  Never a fabricated placeholder. */
  confidence: number | null;
};

/** Read a File to base64 WITHOUT the `data:...;base64,` prefix (the server
 *  expects raw base64). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("kon bestand niet lezen"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

type FacturenProps = {
  entities: string[];
  /* IBANs of his own accounts, used ONLY to decide which side of an invoice is
   * him (invoiceParty.ts). They never leave the browser — the extraction agent
   * still receives nothing but the document. */
  ownIbans: readonly string[];
  invoices: Invoice[];
  txs: Tx[];
  asOf: string;
  busy: boolean;
  defaultEntity: string;
  onSaveInvoices: (next: Invoice[]) => void;
  /** Rows fetched from his n8n and not yet decided on. Held in App, NOT here:
   *  the webhook empties its queue as it responds, so these rows are the only
   *  copy there is — they must survive this view unmounting when he navigates
   *  away and back. */
  pending: PendingInvoice[];
  onPendingChange: (next: PendingInvoice[]) => void;
  /** Mail die over een factuur ging zonder er een te zijn: hij staat klaar bij
   *  de leverancier, het is een aanmaning, of er viel niets uit te lezen. Geen
   *  bedrag, dus geen boeking — alleen een lijstje "zelf ophalen". Ook dit is de
   *  enige kopie, dus ook dit hoort in App te staan. */
  notices: N8nNotice[];
  onNoticesChange: (next: N8nNotice[]) => void;
  onNavigate: (view: View) => void;
  /** Injectable for tests; production uses the browser's own fetch. */
  fetchImpl?: typeof fetch;
  /** The unlocked vault. The n8n webhook URL/token and the auto-booked log now
   *  live there (privacy/security review 2026-08-28, M4/L6) instead of
   *  localStorage; until this is wired, n8n fetching stays off rather than
   *  falling back to the plaintext it replaced. */
  storage?: VaultStorage;
};

/** The drop zone's border/background/text colour while a file is (or isn't)
 *  being dragged over it (was `.dropzone`/`.dropzone-over` in views.css). Kept
 *  as one non-overlapping string per state rather than two classes touching
 *  the same property, so there is never a same-layer utility ordering
 *  question about which one wins. */
function dropzoneClass(dragOver: boolean): string {
  const base =
    "flex flex-col items-center justify-center gap-2 flex-1 min-h-[150px] p-6 text-center border-2 border-dashed rounded cursor-pointer";
  const state = dragOver
    ? "border-accent bg-accent-soft text-ink"
    : "border-line bg-surface-2 text-muted hover:border-accent hover:text-ink focus-visible:border-accent focus-visible:text-ink";
  return `${base} ${state}`;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** How often this screen re-checks his n8n while it is open. The workflow itself
 *  runs hourly, so anything faster only costs an empty round-trip — five minutes
 *  is short enough that a mail forwarded during a session shows up on its own. */
export const PULL_INTERVAL_MS = 5 * 60 * 1000;


/** The one place a hold kind becomes a sentence. Exhaustive by switch, so a new
 *  kind in n8n.ts fails the build here instead of rendering nothing. */
export function holdSentence(c: AdminCopy["facturen"], hold: AutoBookHold): string {
  switch (hold.kind) {
    case "sender-forwarded":
      return c.queue.holds.senderForwarded(hold.checks);
    case "sender-failed":
      return c.queue.holds.senderFailed(hold.checks);
    case "sender-unchecked":
      return c.queue.holds.senderUnchecked;
    case "entity-ambiguous":
      return c.queue.holds.entityAmbiguous;
    case "incomplete":
      return c.queue.holds.incomplete(hold.gap);
    case "over-ceiling":
      return c.queue.holds.overCeiling(hold.ceilingCents);
  }
}

export default function Facturen({
  entities,
  ownIbans,
  invoices,
  txs,
  busy,
  defaultEntity,
  onSaveInvoices,
  pending,
  onPendingChange,
  notices,
  onNoticesChange,
  onNavigate,
  fetchImpl,
  storage,
}: FacturenProps) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].facturen;
  const [entity, setEntity] = useState(defaultEntity);
  /* `""` is "we could not tell", and it is reachable only from an extraction
   * where neither party matched something of his. The manual form still opens
   * on "out", which is what a person typing an invoice by hand almost always
   * means. */
  const [direction, setDirection] = useState<Invoice["direction"] | "">("out");
  const [counterparty, setCounterparty] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [importNote, setImportNote] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // AI PDF extraction (opt-in, confirm-first). `aiEnabled` mirrors the
  // localStorage preference; `pendingSource`/`pendingConfidence` tag the NEXT
  // "Toevoegen" as an AI draft so a hallucinated field can't silently move the
  // forecast — the owner still clicks confirm.
  const [aiEnabled, setAiEnabled] = useState<boolean>(() => getAiExtractionEnabled());
  const [pendingSource, setPendingSource] = useState<Invoice["sourceType"]>("manual");
  const [pendingConfidence, setPendingConfidence] = useState<number | null>(null);
  // Extracted BTW rides along with the AI draft: the manual form has no VAT
  // input, but the Invoice keeps vatAmount for the (later) tax agent, so we
  // carry it through the confirm rather than silently dropping it.
  const [pendingVat, setPendingVat] = useState<number | null>(null);
  /* Both names off an extraction whose direction could not be resolved. Kept so
   * that picking a direction can fill the counterparty with the correct half —
   * the seller for a purchase, the buyer for a sale. Null once resolved or
   * discarded. */
  const [draftParties, setDraftParties] = useState<{ seller: string; buyer: string } | null>(
    null,
  );
  /** Het btw-veld op het formulier, als tekst — leeg is een echte staat en niet 0. */
  const [vatInput, setVatInput] = useState("");
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // --- Ophalen uit n8n. `n8nNote` is disposable UI text; the ROWS live in App
  // (see the `pending` prop) because they are the only copy that exists.
  const [n8nBusy, setN8nBusy] = useState(false);
  /** Most notices are one short line. A few (network, unauthorized) also carry
   *  a technical detail kept behind ToonMeer — see the n8nNotices docstring in
   *  copy/admin.ts. `detail`/`detailSummary` are only ever set together, from
   *  one of those two notices; every other call site passes a bare string. */
  const [n8nNote, setN8nNoteState] = useState<{
    text: string;
    detail?: string;
    detailSummary?: string;
  } | null>(null);
  function showN8nNote(
    note: string | { short: string; detail: string; detailSummary: string },
  ): void {
    setN8nNoteState(
      typeof note === "string"
        ? { text: note }
        : { text: note.short, detail: note.detail, detailSummary: note.detailSummary },
    );
  }
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // The vault's fallback auto-booked log (see `autoBookedIds` below).
  const [legacyAutoBookedIds, setLegacyAutoBookedIds] = useState<Set<string>>(new Set());
  async function refreshLegacyAutoBooked() {
    if (!storage) return;
    try {
      const list = await getAutoBookedInvoices(storage);
      setLegacyAutoBookedIds(new Set(list.map((a) => a.invoiceId)));
    } catch {
      /* a vault read that fails here just leaves the FIELD-based ids showing */
    }
  }
  useEffect(() => {
    void refreshLegacyAutoBooked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);

  // A reload would take the fetched rows with it, and n8n cannot serve them
  // again. So while rows are still undecided, make the browser ask first.
  useEffect(() => {
    if (pending.length === 0 && notices.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending.length, notices.length]);

  // ONE fetch at a time, ever. The webhook empties its queue as it answers, so
  // two overlapping GETs would split one queue across two responses — and the
  // second handler would overwrite the first's rows in App with a stale copy of
  // `pending`. The timer, the open-the-screen pull and the button therefore all
  // go through this promise: a caller that arrives while one is running gets
  // that same promise instead of starting a second call.
  const inFlight = useRef<Promise<void> | null>(null);
  // Set once and never reset, so React 18's StrictMode double-mount (and any
  // remount of this view) cannot turn "pull when Facturen opens" into two pulls.
  const autoPulled = useRef(false);
  // The rows as they are RIGHT NOW, not as they were when the running fetch
  // started. A pull that began five minutes ago must merge into the list he has
  // been deciding on in the meantime — otherwise a row he just confirmed or
  // rejected would come back from a stale closure.
  const pendingRef = useRef(pending);
  const noticesRef = useRef(notices);
  useEffect(() => {
    pendingRef.current = pending;
    noticesRef.current = notices;
  }, [pending, notices]);

  /* ── Automatisch ophalen ──────────────────────────────────────────────────
   *
   * He should not have to press a button to see mail that already arrived. So
   * the queue is pulled when this screen opens and every PULL_INTERVAL_MS after
   * that; the button stays for an immediate re-check.
   *
   * Three things this must not break, all of them because the webhook empties
   * its queue as it answers and a fetched row is therefore the only copy:
   *   1. the rows land in App, not here, so navigating away mid-decision keeps
   *      them (that is why `pending` is a prop);
   *   2. exactly one request at a time — see `inFlight`;
   *   3. a run that started before he decided on a row merges into the CURRENT
   *      list — see `pendingRef`.
   *
   * And it does not fire at all when there is nothing to fetch WITH: an
   * unconfigured LaVega would otherwise open this screen with a red failure he
   * cannot act on from here. */
  const fetchLatest = useRef(handleFetchN8n);
  fetchLatest.current = handleFetchN8n;
  useEffect(() => {
    if (!storage) return; // see the `storage` prop doc: n8n stays off until wired
    const vault = storage;
    let cancelled = false;
    async function configured(): Promise<boolean> {
      try {
        const settings = await getN8nSettings(vault);
        return (
          (settings.invoiceUrl ?? "").trim() !== "" && (settings.invoiceToken ?? "").trim() !== ""
        );
      } catch {
        return false; // a vault read that fails (e.g. locked mid-session) is not "configured"
      }
    }
    void (async () => {
      if (cancelled || !(await configured())) return;
      if (!autoPulled.current) {
        autoPulled.current = true;
        void fetchLatest.current();
      }
    })();
    const id = setInterval(() => {
      void (async () => {
        if (!cancelled && (await configured())) void fetchLatest.current();
      })();
    }, PULL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Deliberately just `storage`: the timer belongs to this screen being open,
    // not to any value it renders, and `fetchLatest` keeps it calling the newest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);

  // Every outcome gets its own sentence, and none of the failures may read like
  // a success. The two that can cost data (a broken connection, an unreadable
  // body) say so plainly, because on those we cannot tell whether n8n already
  // emptied its queue.
  function handleFetchN8n(): Promise<void> {
    if (inFlight.current) return inFlight.current;
    const run = runFetchN8n().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }

  async function runFetchN8n() {
    if (!storage) {
      showN8nNote(c.n8nNotices.vaultNotLinked);
      return;
    }
    const vault = storage;
    setN8nBusy(true);
    showN8nNote(c.n8nNotices.fetching);
    try {
      const settings = await getN8nSettings(vault);
      const outcome = await fetchQueue(
        settings.invoiceUrl ?? "",
        settings.invoiceToken ?? "",
        fetchImpl,
      );
      if (outcome.kind === "not-configured") {
        showN8nNote(c.n8nNotices.notConfigured);
        return;
      }
      if (outcome.kind === "unauthorized") {
        showN8nNote({
          short: c.n8nNotices.unauthorized.short(outcome.status),
          detail: c.n8nNotices.unauthorized.detail,
          detailSummary: c.n8nNotices.unauthorized.detailSummary,
        });
        return;
      }
      if (outcome.kind === "http-error") {
        showN8nNote(c.n8nNotices.httpError(outcome.status));
        return;
      }
      if (outcome.kind === "network") {
        /* DE MEEST WAARSCHIJNLIJKE OORZAAK EERST, in plaats van drie naast
         * elkaar. Hij meldde "geen antwoord" ÉN dat er in n8n niets te zien was,
         * en die combinatie wijst één ding aan: LaVega stuurt de tokenheader
         * x-lavega-token mee, en een eigen header maakt van dit verzoek een
         * cross-origin CALL MET PREFLIGHT. De browser stuurt dan eerst OPTIONS,
         * en als de webhook die origin niet toestaat sterft het verzoek daar —
         * zonder dat n8n er een uitvoering van logt. "Niets in n8n" is dus geen
         * teken dat de URL fout is; het hoort bij dit geval.
         *
         * De oude tekst zette netwerk, URL en allowedOrigins als gelijke
         * kandidaten naast elkaar. Drie oorzaken noemen waarvan er één de echte
         * is, is bijna net zo onbruikbaar als er geen noemen. */
        showN8nNote(c.n8nNotices.network);
        return;
      }
      if (outcome.kind === "unreadable") {
        showN8nNote(c.n8nNotices.unreadable);
        return;
      }

      const handled = new Set(getHandledInvoiceMessageIds());
      const currentPending = pendingRef.current;
      const currentNotices = noticesRef.current;
      const already = new Set(currentPending.map((p) => p.messageId));
      const fresh = outcome.rows.filter(
        (r) => !handled.has(r.messageId) && !already.has(r.messageId),
      );
      const duplicates = outcome.rows.length - fresh.length;

      // The gate. Rows that clear it become invoices right here; the rest go to
      // the review list WITH the reason they are waiting, so the queue never
      // shows a row without saying why it needs him.
      const booked: Invoice[] = [];
      const bookedFrom: { invoiceId: string; messageId: string; subject?: string }[] = [];
      const decidedIds: string[] = [];
      let alreadyStored = 0;
      const proposals: PendingInvoice[] = [];
      const seenIds = new Set(invoices.map((i) => i.id));
      const entityCtx = { entityChoices, defaultEntity: selectedEntity };
      for (const row of fresh) {
        const draft = toPending(row, bookingEntity(entityCtx));
        const decision = autoBookDecision(row, entityCtx);
        if (!decision.book) {
          proposals.push({ ...draft, waitReason: holdSentence(c, decision.hold) });
          continue;
        }
        // De poort laat alleen door wat GEEN keuze meer is: één onderneming of
        // geen enkele. `bookingEntity` zegt welke dat dan is — dezelfde functie
        // die de poort gebruikte, zodat er niet op een andere BV geboekt kan
        // worden dan waarop hij goedkeurde.
        const result = pendingToInvoice({ ...draft, entity: bookingEntity(entityCtx) });
        if (!result.ok) {
          // Unreachable while the gate checks the same thing, but a row must
          // land in the review list rather than vanish if the two ever diverge.
          proposals.push({ ...draft, waitReason: c.queue.holds.gaps[result.gap] });
          continue;
        }
        if (seenIds.has(result.invoice.id)) {
          alreadyStored++;
        } else {
          seenIds.add(result.invoice.id);
          // ON THE RECORD, not beside it. `autoBooked` travels with the invoice
          // into the encrypted vault and the back-up, so "this one arrived without
          // you" survives a reload, a restore and a new device. The localStorage
          // log stays as well, for invoices booked before the field existed.
          booked.push({ ...result.invoice, autoBooked: true });
          bookedFrom.push({
            invoiceId: result.invoice.id,
            messageId: row.messageId,
            subject: row.subject,
          });
        }
        // Decided either way, so n8n's next hourly pass will not re-offer it.
        decidedIds.push(row.messageId);
      }
      if (decidedIds.length > 0) addHandledInvoiceMessageIds(decidedIds);
      if (booked.length > 0) {
        // ONE save with everything, and reconciled in the same breath: a payment
        // that already came in links now instead of at the next import.
        onSaveInvoices(reconcileInvoices([...invoices, ...booked], txs));
        for (const b of bookedFrom) await rememberAutoBooked(vault, b);
        await refreshLegacyAutoBooked();
      }
      if (proposals.length > 0) onPendingChange([...currentPending, ...proposals]);
      // Meldingen langs dezelfde zeef: afgehandeld is afgehandeld.
      const knownNotices = new Set(currentNotices.map((n) => n.messageId));
      const freshNotices = outcome.notices.filter(
        (n) => !handled.has(n.messageId) && !knownNotices.has(n.messageId),
      );
      if (freshNotices.length > 0) onNoticesChange([...currentNotices, ...freshNotices]);
      const parts: string[] = [];
      if (outcome.rows.length === 0) {
        parts.push(c.n8nNotices.emptyQueue);
      } else if (fresh.length === 0) {
        parts.push(c.n8nNotices.nothingNew);
      } else {
        parts.push(c.n8nNotices.fetched(fresh.length));
      }
      if (booked.length > 0) {
        parts.push(c.n8nNotices.autoBooked(booked.length));
      }
      if (alreadyStored > 0) {
        parts.push(
          alreadyStored === 1
            ? c.n8nNotices.alreadyStoredOne
            : c.n8nNotices.alreadyStoredMany(alreadyStored),
        );
      }
      if (proposals.length > 0) {
        parts.push(c.n8nNotices.waiting(proposals.length));
      }
      if (duplicates > 0) parts.push(c.n8nNotices.duplicatesSkipped(duplicates));
      if (outcome.dropped > 0) parts.push(c.n8nNotices.dropped(outcome.dropped));
      if (freshNotices.length > 0) {
        parts.push(c.n8nNotices.noticesWaiting(freshNotices.length));
      }
      showN8nNote(parts.join(" "));
    } finally {
      setN8nBusy(false);
    }
  }

  function patchRow(messageId: string, patch: Partial<PendingInvoice>) {
    onPendingChange(pending.map((p) => (p.messageId === messageId ? { ...p, ...patch } : p)));
  }

  function dropRowError(messageId: string) {
    setRowErrors((errs) => {
      const next = { ...errs };
      delete next[messageId];
      return next;
    });
  }

  // Confirm = the only path from an n8n row to a real Invoice. A row that
  // doesn't validate stays on screen with its reason; nothing is booked.
  function confirmRow(p: PendingInvoice) {
    const result = pendingToInvoice(p);
    if (!result.ok) {
      setRowErrors((errs) => ({ ...errs, [p.messageId]: c.queue.holds.gaps[result.gap] }));
      return;
    }
    const duplicate = invoices.some((i) => i.id === result.invoice.id);
    // Reconciled on the spot, exactly like the auto path and like a file import:
    // if the payment already went out, this invoice is linked before he leaves
    // the screen instead of at the next bank sync.
    if (!duplicate) onSaveInvoices(reconcileInvoices([...invoices, result.invoice], txs));
    addHandledInvoiceMessageIds([p.messageId]);
    onPendingChange(pending.filter((x) => x.messageId !== p.messageId));
    dropRowError(p.messageId);
    showN8nNote(
      duplicate
        ? c.n8nNotices.confirmedDuplicate(p.counterparty.trim())
        : c.n8nNotices.confirmedNew(result.invoice.counterparty),
    );
  }

  // Reject = decided, so it is remembered as handled and n8n's hourly re-scan
  // of the same week of mail can't put it back in front of him.
  function rejectRow(p: PendingInvoice) {
    addHandledInvoiceMessageIds([p.messageId]);
    onPendingChange(pending.filter((x) => x.messageId !== p.messageId));
    dropRowError(p.messageId);
    showN8nNote(c.n8nNotices.rejected);
  }

  // Een melding "Gedaan" zetten boekt niets — het is een to-do die van de lijst
  // gaat en, net als een verworpen regel, niet opnieuw wordt aangeboden.
  function dismissNotice(notice: N8nNotice) {
    addHandledInvoiceMessageIds([notice.messageId]);
    onNoticesChange(notices.filter((n) => n.messageId !== notice.messageId));
    showN8nNote(c.n8nNotices.noticeDismissed);
  }

  // Live projection: what the forecast will actually see from open invoices.
  const flows = useMemo(() => scheduledInvoiceFlows(invoices), [invoices]);
  const netCents = useMemo(
    () => flows.reduce((sum, f) => sum + f.sign * f.amountCents, 0),
    [flows],
  );

  /* ── Wel of geen ondernemingen ───────────────────────────────────────────
   *
   * Zijn regel: heeft de gebruiker ondernemingen opgegeven, dan per
   * onderneming; heeft hij ze niet, dan is het één zelfstandige die alles op
   * dezelfde rekening doet en staat het gewoon in het overzicht.
   *
   * Dus GEEN keuzelijst met één verzonnen optie erin. Die stond er wel — de
   * standaard van de app werd als "keuze" opgevoerd — en dat is een vraag
   * stellen waarop maar één antwoord bestaat. Erger: de poort in n8n.ts kreeg
   * daardoor altijd precies één optie te zien, dus dacht hij dat er een
   * onderneming gekozen wás. Nu ziet de poort de échte lijst, en zegt
   * `bookingEntity` één keer waarop er geboekt wordt.
   *
   * `entiteit` als woord komt hieronder alleen op het scherm als hij er zelf
   * ondernemingen heeft. */
  const hasEntities = entities.length > 0;
  const entityChoices = entities;
  // De keuzelijst mag nooit iets anders tonen dan waarop geboekt wordt: stond
  // in de state een entiteit die niet in de lijst staat (de app-standaard hoeft
  // niet tussen zijn BV's te zitten), dan toonde het scherm de eerste BV en
  // boekte "Toevoegen" op die standaard. Een factuur op de verkeerde BV staat
  // scheef in de btw — precies wat de poort moest voorkomen.
  const selectedEntity = hasEntities
    ? entityChoices.includes(entity)
      ? entity
      : entityChoices[0]
    : defaultEntity;
  // "Per onderneming" heeft alleen zin als er meer dan één is: bij één staat op
  // elke regel dezelfde naam.
  const showEntityColumn = entities.length > 1;

  // Which invoices got here without him clicking. `legacyAutoBookedIds` is
  // refreshed after every booking/undo (see `refreshLegacyAutoBooked` below) —
  // it is the vault's fallback log, kept for invoices booked before `autoBooked`
  // existed as a field. The FIELD is the truth; an invoice with autoBooked
  // absent was confirmed by hand — the safe reading, since that is what every
  // older row actually was.
  const autoBookedIds = new Set([
    ...invoices.filter((i) => i.autoBooked).map((i) => i.id),
    ...legacyAutoBookedIds,
  ]);

  function handleAdd() {
    const cp = counterparty.trim();
    const amt = Number(amount.replace(",", "."));
    const ccy = currency.trim().toUpperCase();
    // Refuse, and SAY why. Each of these was previously a silent no-op.
    if (!cp) return setManualError(c.manualErrors.missingCounterparty);
    if (!direction) return setManualError(c.manualErrors.missingDirection);
    if (!issueDate) return setManualError(c.manualErrors.missingIssueDate);
    if (!dueDate) return setManualError(c.manualErrors.missingDueDate);
    if (!Number.isFinite(amt) || amt <= 0) return setManualError(c.manualErrors.missingAmount);
    // Same rule as the n8n queue: an empty/unreadable currency is unknown, not
    // euros. LaVega never turns a blank field into EUR by itself.
    if (!/^[A-Z]{3}$/.test(ccy)) return setManualError(c.manualErrors.invalidCurrency);
    setManualError(null);
    const inv = makeInvoice({
      entity: selectedEntity,
      direction,
      counterparty: cp,
      invoiceNumber: invoiceNumber.trim() || undefined,
      issueDate,
      dueDate,
      amount: amt,
      currency: ccy,
      status: "expected",
      sourceType: pendingSource,
      confidence: pendingSource === "llm" ? (pendingConfidence ?? undefined) : undefined,
      // Wat in het veld staat wint van wat het concept meebracht: hij kan een
      // AI-bedrag corrigeren, en dan is zijn correctie het feit.
      vatAmount:
        vatInput.trim() !== "" && Number.isFinite(Number(vatInput.replace(",", ".")))
          ? Number(vatInput.replace(",", "."))
          : pendingSource === "llm"
            ? (pendingVat ?? undefined)
            : undefined,
    });
    // Whether the draft is added or turns out to be a duplicate, it has now been
    // dealt with — clear the AI-draft tags so the NEXT manual entry can't inherit
    // "llm"/confidence/vat. (A validation failure above keeps the draft alive so
    // the owner can fix it, which is why that path intentionally doesn't reset.)
    if (invoices.some((i) => i.id === inv.id)) {
      setImportNote(c.importNotices.duplicateManualEntry);
      clearDraftTags();
      return;
    }
    onSaveInvoices([...invoices, inv]);
    setCounterparty("");
    setInvoiceNumber("");
    setAmount("");
    setVatInput("");
    setImportNote(null);
    clearDraftTags();
  }

  function setStatus(id: string, status: Invoice["status"]) {
    onSaveInvoices(invoices.map((i) => (i.id === id ? { ...i, status } : i)));
  }

  // Undo an automatic booking. It CANCELS rather than deletes: cancelled drops
  // straight out of scheduledInvoiceFlows (so it stops moving the forecast) but
  // the record and its trail stay, which is what "reversible" has to mean for
  // something that entered his books on its own.
  function undoAutoBooked(id: string) {
    setStatus(id, "cancelled");
    if (storage) void forgetAutoBooked(storage, id).then(refreshLegacyAutoBooked, () => {});
    showN8nNote(c.n8nNotices.undone);
  }

  // Drop the AI-draft tags (source/confidence/vat/note) so a following MANUAL
  // entry isn't mislabeled as "llm" or given a stale confidence/BTW.
  function clearDraftTags() {
    setPendingSource("manual");
    setPendingConfidence(null);
    setPendingVat(null);
    setAiNote(null);
  }

  // Explicitly throw away a pre-filled AI draft: clears the tags AND the fields
  // the extraction populated, so nothing from it lingers if the owner decides
  // not to use it.
  function discardDraft() {
    clearDraftTags();
    setDraftParties(null);
    setCounterparty("");
    setInvoiceNumber("");
    setIssueDate("");
    setDueDate("");
    setAmount("");
    setVatInput("");
    setCurrency("EUR");
  }

  function handleImportFile(file: File) {
    void file.text().then((text) => {
      const rows = parseInvoiceFile(file.name, text);
      if (rows.length === 0) {
        setImportNote(c.importNotices.noneRecognized);
        return;
      }
      const parsed = rows.map((row) => makeInvoice({ ...row, entity: selectedEntity }));
      // Dedup by content-hashed id so re-importing the same file (or an
      // overlapping export) doesn't duplicate rows already on file.
      const seen = new Set(invoices.map((i) => i.id));
      const added: Invoice[] = [];
      for (const inv of parsed) {
        if (!seen.has(inv.id)) {
          seen.add(inv.id);
          added.push(inv);
        }
      }
      const merged = reconcileInvoices([...invoices, ...added], txs);
      onSaveInvoices(merged);
      setImportNote(
        added.length > 0
          ? c.importNotices.imported(added.length, parsed.length)
          : c.importNotices.noneNew,
      );
    });
  }

  /** THE one file entry point — the same for a drop and for the file picker
   *  behind it. A PDF can only be read by the AI extractor, so without the
   *  opt-in it is refused with a reason instead of being parsed as text. */
  function handleFile(file: File) {
    setImportNote(null);
    if (isPdf(file)) {
      if (!aiEnabled) {
        setImportNote(c.importNotices.pdfNeedsAi(file.name));
        return;
      }
      void handleExtractPdf(file);
      return;
    }
    handleImportFile(file);
  }

  function toggleAi(next: boolean) {
    setAiEnabled(next);
    setAiExtractionEnabled(next);
    if (!next) setAiNote(null);
  }

  // Opt-in, per-document: only fires when the owner has enabled the toggle AND
  // dropped/picked a specific PDF. Reads the file to base64 and POSTs it to OUR
  // server proxy (never to Mistral directly). On success it PRE-FILLS the
  // manual form as a draft — nothing is saved until the owner clicks "Toevoegen".
  async function handleExtractPdf(file: File) {
    setAiBusy(true);
    setAiNote(c.aiExtraction.reading);
    try {
      const pdfBase64 = await fileToBase64(file);
      const res = await fetch(`${API_BASE}/api/agent/extract-invoice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pdfBase64,
          filename: file.name,
          mediaType: file.type || "application/pdf",
        }),
      });
      if (!res.ok) {
        let msg = c.aiExtraction.extractFailedStatus(res.status);
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* non-JSON error body; keep the status-based message */
        }
        setAiNote(msg);
        return;
      }
      const { fields, confidence } = (await res.json()) as ExtractResponse;
      /* The model read the page; this decides what it means for HIM. An
       * unresolved case leaves the direction empty on purpose — handleAdd
       * refuses to book until he picks one, exactly as it does for a currency
       * it could not read. */
      const party = resolveInvoiceParties(
        { seller: fields.seller, buyer: fields.buyer, payeeIban: fields.payeeIban },
        { ibans: ownIbans, entityNames: entities },
      );
      setDirection(party.kind === "unknown" ? "" : party.kind === "sales" ? "in" : "out");
      setCounterparty(party.counterparty);
      setDraftParties(
        party.kind === "unknown" ? { seller: fields.seller, buyer: fields.buyer } : null,
      );
      /* The form has always had this field; the agent was simply never asked
       * for it, so an AI draft left it blank every time. */
      setInvoiceNumber(fields.invoiceNumber ?? "");
      setIssueDate(fields.issueDate);
      setDueDate(fields.dueDate || fields.issueDate);
      setAmount(String(fields.amount));
      // No currency read = no currency. Blanking it is deliberate: the manual
      // form then refuses to book until he fills it in, instead of inheriting
      // the "EUR" that happened to be standing in the field.
      setCurrency(fields.currency ?? "");
      setPendingSource("llm");
      setPendingConfidence(confidence);
      const vat = typeof fields.vatAmount === "number" ? fields.vatAmount : null;
      setVatInput(vat === null ? "" : String(vat));
      setPendingVat(vat);
      // Only show a percentage the model actually reported; otherwise just ask
      // the owner to check every field (no fabricated confidence number).
      const conf =
        typeof confidence === "number"
          ? c.aiExtraction.confidencePart(Math.round(confidence * 100))
          : "";
      const btw = vat !== null ? c.aiExtraction.vatPart(formatEuroIn(locale, vat)) : "";
      const noCcy = fields.currency ? "" : c.aiExtraction.noCurrencyPart;
      setAiNote(c.aiExtraction.draftReady(conf, btw, noCcy));
    } catch {
      setAiNote(c.aiExtraction.extractFailed);
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <>
      <div
        className="flex items-baseline justify-between gap-4 flex-wrap pb-2 mt-6 mb-4 border-b-2 border-ink first:mt-0"
        data-testid="view-head"
      >
        <h2 className="m-0 font-display text-[1.5rem] font-semibold tracking-[-0.01em] text-ink">
          {c.head.title}
        </h2>
        <span className="eyebrow flex-none">{c.head.eyebrow}</span>
      </div>

      <ModuleGrid label={c.forms.sectionLabel}>
        {/* ── 1. de automatische n8n-feed ─────────────────────────────── */}
        <Module title={c.forms.auto.moduleTitle} height="tall">
          <p className="cell-sub">{c.forms.auto.pullIntro(Math.round(PULL_INTERVAL_MS / 60000))}</p>
          <p className="cell-sub">{c.forms.auto.gateNote(entities.length)}</p>
          <div className="flex flex-wrap gap-2 mt-2" data-testid="stack-form-actions">
            <Button variant="primary" disabled={busy || n8nBusy} onClick={() => void handleFetchN8n()}>
              {c.forms.auto.fetchButton}
            </Button>
            <Button onClick={() => onNavigate("koppelingen")}>{c.forms.auto.connectionsButton}</Button>
          </div>
          {n8nNote && (
            <>
              <p className="cell-sub">{n8nNote.text}</p>
              {n8nNote.detail && n8nNote.detailSummary && (
                <ToonMeer summary={n8nNote.detailSummary}>
                  <p className="cell-sub">{n8nNote.detail}</p>
                </ToonMeer>
              )}
            </>
          )}
          {pending.length > 0 && (
            <p className="cell-sub text-warn">{c.forms.auto.pendingWarning(pending.length)}</p>
          )}
        </Module>

        {/* ── 2. sleep een factuurbestand hierheen ────────────────────── */}
        <Module title={c.forms.drop.moduleTitle} height="tall">
          <label
            className={dropzoneClass(dragOver)}
            data-testid="dropzone"
            aria-label={c.forms.drop.dropzoneAriaLabel}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer?.files?.[0];
              if (file) handleFile(file);
            }}
          >
            <span className="font-display text-[1.15rem] text-ink">{c.forms.drop.dropzoneTitle}</span>
            <span className="text-[0.8rem] max-w-[34ch]">{c.forms.drop.dropzoneSub}</span>
            {/* No `accept` filter for the non-PDF formats, same rationale as
                Import.tsx: format is sniffed from content, not extension. */}
            <input
              type="file"
              className="absolute w-px h-px p-0 -m-px overflow-hidden [clip:rect(0,0,0,0)] whitespace-nowrap [border:0]"
              disabled={busy || aiBusy}
              aria-label={c.forms.drop.fileInputAriaLabel}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) handleFile(file);
              }}
            />
          </label>
          <label style={{ marginTop: "var(--sp-3)", display: "block" }}>
            <input
              type="checkbox"
              checked={aiEnabled}
              disabled={busy}
              aria-label={c.forms.drop.aiCheckboxAriaLabel}
              onChange={(e) => toggleAi(e.target.checked)}
            />{" "}
            {c.forms.drop.aiCheckboxLabel}
          </label>
          <p className="cell-sub">{c.forms.drop.aiHint}</p>
          {importNote && <p className="cell-sub">{importNote}</p>}
          {aiNote && <p className="cell-sub">{aiNote}</p>}
        </Module>

        {/* ── 3. handmatig ────────────────────────────────────────────── */}
        <Module
          title={c.forms.manual.moduleTitle}
          height="tall"
          footer={<span>{c.forms.manual.footer}</span>}
        >
          <div className="flex flex-col gap-3" data-testid="stack-form">
            <div className="flex gap-3" data-testid="stack-form-row">
              {/* Geen ondernemingen = geen keuze = geen keuzelijst. */}
              {hasEntities && (
                <label className="flex flex-col gap-1 text-[0.82rem] text-muted flex-[1_1_0px] min-w-0">
                  {c.forms.manual.entityLabel}
                  <select
                    className="w-full box-border"
                    value={selectedEntity}
                    disabled={busy}
                    aria-label={c.forms.manual.entityAriaLabel}
                    onChange={(e) => setEntity(e.target.value)}
                  >
                    {entityChoices.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-[0.82rem] text-muted flex-[1_1_0px] min-w-0">
                {c.forms.manual.directionLabel}
                <select
                  className="w-full box-border"
                  value={direction}
                  disabled={busy}
                  aria-label={c.forms.manual.directionAriaLabel}
                  /* Narrowed, not cast. The option list can yield "" while the
                     direction is unresolved, so `as Invoice["direction"]` was
                     telling the compiler something untrue — harmless today only
                     because handleAdd refuses an empty direction, which is a
                     runtime guard standing in for a type. */
                  onChange={(e) => {
                    const v = e.target.value;
                    const next = v === "in" || v === "out" ? v : "";
                    setDirection(next);
                    /* Answering the direction also answers which printed name
                     * is the counterparty. Only fills an EMPTY field: if he has
                     * already typed one, his text wins. */
                    if (next && draftParties && !counterparty.trim())
                      setCounterparty(next === "in" ? draftParties.buyer : draftParties.seller);
                  }}
                >
                  {/* Present only while unresolved, so the list cannot be put
                      back into "unknown" by hand once he has answered. */}
                  {!direction && <option value="">{c.directionOptions.unset}</option>}
                  <option value="out">{c.directionOptions.out}</option>
                  <option value="in">{c.directionOptions.in}</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[0.82rem] text-muted">
              {c.forms.manual.counterpartyLabel}
              <input
                className="w-full box-border"
                value={counterparty}
                disabled={busy}
                aria-label={c.forms.manual.counterpartyAriaLabel}
                onChange={(e) => setCounterparty(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[0.82rem] text-muted">
              {c.forms.manual.invoiceNumberLabel}
              <input
                className="w-full box-border"
                value={invoiceNumber}
                disabled={busy}
                aria-label={c.forms.manual.invoiceNumberAriaLabel}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </label>
            <div className="flex gap-3" data-testid="stack-form-row">
              <label className="flex flex-col gap-1 text-[0.82rem] text-muted flex-[1_1_0px] min-w-0">
                {c.forms.manual.issueDateLabel}
                <input
                  className="w-full box-border"
                  type="date"
                  value={issueDate}
                  disabled={busy}
                  aria-label={c.forms.manual.issueDateAriaLabel}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.82rem] text-muted flex-[1_1_0px] min-w-0">
                {c.forms.manual.dueDateLabel}
                <input
                  className="w-full box-border"
                  type="date"
                  value={dueDate}
                  disabled={busy}
                  aria-label={c.forms.manual.dueDateAriaLabel}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </label>
            </div>
            <div className="flex gap-3" data-testid="stack-form-row">
              <label className="flex flex-col gap-1 text-[0.82rem] text-muted flex-[1_1_0px] min-w-0">
                {c.forms.manual.amountLabel}
                {pendingSource === "llm" && (
                  <Badge>{c.forms.manual.aiDraftBadge}</Badge>
                )}
                <SaldoInput
                  className="w-full box-border"
                  type="number"
                  step={0.01}
                  min={0}
                  value={amount}
                  disabled={busy}
                  aria-label={c.forms.manual.amountAriaLabel}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.82rem] text-muted flex-[1_1_0px] min-w-0">
                {/* BTW BIJ DE HAND, want de facturenbasis leest juist dit veld.
                    Het stond er niet: vatAmount kwam alleen mee met een AI-concept,
                    dus een handmatig ingevoerde factuur maakte het kwartaal
                    onvolledig en de Belasting-tab viel terug op de zwakkere
                    marge-benadering — precies de betere bron die hij net kan kiezen.
                    Leeg blijft ONBEKEND en wordt nooit 0: een factuur zonder btw en
                    een factuur waarvan de btw niet is ingevuld zijn niet hetzelfde,
                    en de dekkingsmeter moet dat verschil kunnen zien. Wil hij nul
                    zeggen (btw verlegd, ICP, 0%-export), dan typt hij 0. */}
                {c.forms.manual.vatLabel} <span className="cell-sub">{c.forms.manual.vatHint}</span>
                {pendingSource === "llm" && pendingVat !== null && (
                  <Badge>{c.forms.manual.aiDraftBadge}</Badge>
                )}
                <SaldoInput
                  className="w-full box-border"
                  type="number"
                  step={0.01}
                  min={0}
                  value={vatInput}
                  placeholder={c.forms.manual.vatPlaceholder}
                  disabled={busy}
                  aria-label={c.forms.manual.vatAriaLabel}
                  onChange={(e) => setVatInput(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.82rem] text-muted flex-[1_1_0px] min-w-0">
                {c.forms.manual.currencyLabel}
                <SaldoInput
                  className="w-full box-border"
                  value={currency}
                  maxLength={3}
                  placeholder={c.forms.manual.currencyPlaceholder}
                  disabled={busy}
                  aria-label={c.forms.manual.currencyAriaLabel}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 mt-2" data-testid="stack-form-actions">
              <Button variant="primary" disabled={busy} onClick={handleAdd}>
                {c.forms.manual.addButton}
              </Button>
              {pendingSource === "llm" && (
                <Button disabled={busy} onClick={discardDraft}>
                  {c.forms.manual.discardDraftButton}
                </Button>
              )}
            </div>
            {manualError && <p className="cell-sub text-neg">{manualError}</p>}
          </div>
        </Module>
      </ModuleGrid>

      {/* ── De confirm-first wachtrij. Ongewijzigd gedrag. ─────────────── */}
      {pending.length > 0 && (
        <Card as="section" className="n8n-block" aria-label={c.queue.sectionAriaLabel}>
          <CardHeader>
            <h2>{c.queue.heading}</h2>
            <span className="eyebrow">{c.queue.eyebrow(pending.length)}</span>
          </CardHeader>
          <p className="cell-sub text-neg">
            <strong>{c.queue.warningLead}</strong>
            {c.queue.warningBody(pending.length)}
          </p>
          <div className="n8n-rows">
            {pending.map((p) => (
              <div className="n8n-row" data-messageid={p.messageId} key={p.messageId}>
                <p className="n8n-row-source cell-sub">
                  {c.queue.mailSourcePrefix} {p.subject ?? c.notices.noSubjectFallback}
                  {p.note ? ` · ${p.note}` : ""}
                </p>
                {/* Waarom juist DEZE regel wacht. Zonder deze zin is "bevestig
                    hem zelf" een opdracht zonder reden — en de reden is het
                    enige waarmee hij kan beoordelen of hij hem wíl boeken. */}
                {p.waitReason && (
                  <p className="cell-sub text-warn">{c.queue.waitReason(p.waitReason)}</p>
                )}
                <div className="facturen-form">
                  {hasEntities && (
                    <>
                      <label>
                        {c.queue.entityLabel}{" "}
                        <select
                          value={p.entity}
                          aria-label={c.queue.entityAriaLabel}
                          onChange={(e) => patchRow(p.messageId, { entity: e.target.value })}
                        >
                          {entityChoices.map((e) => (
                            <option key={e} value={e}>
                              {e}
                            </option>
                          ))}
                        </select>
                      </label>{" "}
                    </>
                  )}
                  <label>
                    {c.queue.directionLabel}{" "}
                    <select
                      value={p.direction}
                      aria-label={c.queue.directionAriaLabel}
                      onChange={(e) =>
                        patchRow(p.messageId, { direction: e.target.value as Invoice["direction"] })
                      }
                    >
                      <option value="out">{c.directionOptions.out}</option>
                      <option value="in">{c.directionOptions.in}</option>
                    </select>
                  </label>{" "}
                  <label>
                    {c.queue.counterpartyLabel}{" "}
                    <input
                      value={p.counterparty}
                      aria-label={c.queue.counterpartyAriaLabel}
                      onChange={(e) => patchRow(p.messageId, { counterparty: e.target.value })}
                    />
                  </label>{" "}
                  <label>
                    {c.queue.invoiceNumberLabel}{" "}
                    <input
                      value={p.invoiceNumber}
                      aria-label={c.queue.invoiceNumberAriaLabel}
                      onChange={(e) => patchRow(p.messageId, { invoiceNumber: e.target.value })}
                    />
                  </label>{" "}
                  <label>
                    {c.queue.issueDateLabel}{" "}
                    <input
                      type="date"
                      value={p.issueDate}
                      aria-label={c.queue.issueDateAriaLabel}
                      onChange={(e) => patchRow(p.messageId, { issueDate: e.target.value })}
                    />
                  </label>{" "}
                  <label>
                    {c.queue.dueDateLabel}{" "}
                    <input
                      type="date"
                      value={p.dueDate}
                      aria-label={c.queue.dueDateAriaLabel}
                      onChange={(e) => patchRow(p.messageId, { dueDate: e.target.value })}
                    />
                  </label>{" "}
                  <label>
                    {c.queue.amountLabel}{" "}
                    <SaldoInput
                      type="number"
                      step={0.01}
                      min={0}
                      value={p.amount}
                      aria-label={c.queue.amountAriaLabel}
                      onChange={(e) => patchRow(p.messageId, { amount: e.target.value })}
                    />
                  </label>{" "}
                  <label>
                    {c.queue.currencyLabel}{" "}
                    <SaldoInput
                      value={p.currency}
                      maxLength={3}
                      placeholder={c.queue.currencyPlaceholder}
                      aria-label={c.queue.currencyAriaLabel}
                      onChange={(e) =>
                        patchRow(p.messageId, { currency: e.target.value.toUpperCase() })
                      }
                    />
                  </label>{" "}
                  <label>
                    {c.queue.vatLabel}{" "}
                    <SaldoInput
                      type="number"
                      step={0.01}
                      min={0}
                      value={p.vat}
                      placeholder={c.queue.vatPlaceholder}
                      aria-label={c.queue.vatAriaLabel}
                      onChange={(e) => patchRow(p.messageId, { vat: e.target.value })}
                    />
                  </label>{" "}
                  <Button variant="primary" disabled={busy} onClick={() => confirmRow(p)}>
                    {c.queue.confirmButton}
                  </Button>{" "}
                  <Button disabled={busy} onClick={() => rejectRow(p)}>
                    {c.queue.rejectButton}
                  </Button>
                </div>
                {!p.dueDate && <p className="cell-sub">{c.queue.missingDueDateNote}</p>}
                {!p.currency && <p className="cell-sub">{c.queue.missingCurrencyNote}</p>}
                {p.vat === "" && <p className="cell-sub">{c.queue.missingVatNote}</p>}
                {rowErrors[p.messageId] && (
                  <p className="cell-sub text-neg">{rowErrors[p.messageId]}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Zelf ophalen: mail die geen boekbare factuur was ───────────── */}
      {notices.length > 0 && (
        <Card as="section" className="n8n-block" aria-label={c.notices.sectionAriaLabel}>
          <CardHeader>
            <h2>{c.notices.heading}</h2>
            <span className="eyebrow">{c.notices.eyebrow(notices.length)}</span>
          </CardHeader>
          <p className="cell-sub">
            {c.notices.introLead} <strong>{c.notices.introStrong}</strong> {c.notices.introTail}
          </p>
          <div className="n8n-rows">
            {notices.map((n) => (
              <div className="n8n-row" data-noticeid={n.messageId} key={n.messageId}>
                <p className="n8n-row-source cell-sub">
                  <strong>{c.notices.kindLabels[n.kind]}</strong> ·{" "}
                  {n.subject ?? c.notices.noSubjectFallback}
                  {n.from ? ` · ${n.from}` : ""}
                </p>
                <p className="cell-sub">{n.reason}</p>
                <div className="flex flex-wrap gap-2 mt-2" data-testid="stack-form-actions">
                  {n.mailUrl ? (
                    <a
                      className={buttonVariants()}
                      href={n.mailUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {c.notices.openInGmail}
                    </a>
                  ) : (
                    <span className="cell-sub">{c.notices.noLinkFallback}</span>
                  )}
                  <Button onClick={() => dismissNotice(n)}>{c.notices.doneButton}</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Wat er binnen is ───────────────────────────────────────────── */}
      <div
        className="flex items-baseline justify-between gap-4 flex-wrap pb-2 mt-6 mb-4 border-b-2 border-ink first:mt-0"
        data-testid="view-head"
      >
        <h2 className="m-0 font-display text-[1.5rem] font-semibold tracking-[-0.01em] text-ink">
          {c.list.heading}
        </h2>
        <span className="eyebrow flex-none">
          {c.list.eyebrowCount(flows.length)}
          <span className={netCents >= 0 ? "text-pos" : "text-neg"}>
            {formatEuroIn(locale, netCents / 100)}
          </span>
        </span>
      </div>

      <Card as="section" aria-label={c.list.sectionAriaLabel}>
        {invoices.length === 0 ? (
          <p className="cell-sub">{c.list.empty}</p>
        ) : (
          <TableWrap>
            <Table cards>
              <thead>
                <tr>
                  <Th>{c.list.columns.counterparty}</Th>
                  {/* De onderneming staat er alleen als er meer dan één is. Bij
                      één (of geen) zou de kolom op elke regel hetzelfde zeggen,
                      en dan is het geen informatie maar ruis — en voor de
                      zelfstandige zonder entiteiten is het bovendien jargon. */}
                  {showEntityColumn && <Th>{c.list.columns.company}</Th>}
                  <Th>{c.list.columns.direction}</Th>
                  <Th numeric>{c.list.columns.amount}</Th>
                  <Th>{c.list.columns.dueDate}</Th>
                  <Th>{c.list.columns.status}</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const signed = inv.direction === "in" ? inv.amount : -inv.amount;
                  return (
                    <tr key={inv.id}>
                      <Td data-label={c.list.columns.counterparty}>
                        {inv.counterparty}
                        {inv.invoiceNumber ? (
                          <span className="cell-sub"> · {inv.invoiceNumber}</span>
                        ) : null}
                      </Td>
                      {showEntityColumn && (
                        <Td data-label={c.list.columns.company}>{inv.entity}</Td>
                      )}
                      <Td data-label={c.list.columns.direction}>
                        <Badge>
                          {inv.direction === "in"
                            ? c.list.directionBadge.in
                            : c.list.directionBadge.out}
                        </Badge>
                        {autoBookedIds.has(inv.id) && (
                          <>
                            {" "}
                            <Badge title={c.list.autoBadgeTitle}>{c.list.autoBadge}</Badge>
                          </>
                        )}
                      </Td>
                      <Td
                        numeric
                        className={signed >= 0 ? "text-pos" : "text-neg"}
                        data-label={c.list.columns.amount}
                      >
                        {formatEuroIn(locale, signed)}
                      </Td>
                      <Td data-label={c.list.columns.dueDate}>{inv.dueDate}</Td>
                      <Td data-label={c.list.columns.status}>
                        <Badge>{c.list.statusLabels[inv.status]}</Badge>
                      </Td>
                      <Td>
                        {inv.status === "expected" ? (
                          <>
                            {autoBookedIds.has(inv.id) && (
                              <>
                                <Button disabled={busy} onClick={() => undoAutoBooked(inv.id)}>
                                  {c.list.undoButton}
                                </Button>{" "}
                              </>
                            )}
                            <Button disabled={busy} onClick={() => setStatus(inv.id, "paid")}>
                              {c.list.markPaidButton}
                            </Button>{" "}
                            <Button disabled={busy} onClick={() => setStatus(inv.id, "cancelled")}>
                              {c.list.cancelButton}
                            </Button>
                          </>
                        ) : (
                          <span className="cell-sub">{c.list.noActions}</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
