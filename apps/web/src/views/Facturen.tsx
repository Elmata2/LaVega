import { useEffect, useMemo, useRef, useState } from "react";
import type { Invoice, Tx } from "@lavega/core";
import { makeInvoice, parseInvoiceFile, reconcileInvoices, scheduledInvoiceFlows } from "@lavega/core";
import type { View } from "../App";
import { formatEuro } from "../format";
import { API_BASE } from "../api";
import Module from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import {
  addHandledInvoiceMessageIds,
  getAiExtractionEnabled,
  getHandledInvoiceMessageIds,
  getN8nInvoiceToken,
  getN8nInvoiceUrl,
  setAiExtractionEnabled,
} from "../settings";
import {
  autoBookDecision,
  fetchQueue,
  forgetAutoBooked,
  getAutoBookedInvoices,
  pendingToInvoice,
  rememberAutoBooked,
  toPending,
  NOTICE_LABELS,
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
 * whole rule: a verified sender, one unambiguous entity, and a complete
 * invoice. Everything else stays a proposal AND carries the reason it waits.
 * What does book itself is visible as automatic (the "automatisch" badge, from
 * the auto-booked log) and reversible in one click ("Terugdraaien" → cancelled,
 * which drops it out of the forecast without deleting the record). Something
 * silent that changes his books is worse than a click.
 */

/** Shape returned by our own server proxy (POST /api/agent/extract-invoice).
 *  The browser only ever talks to our server — never api.anthropic.com. */
type ExtractResponse = {
  fields: {
    counterparty: string;
    amount: number;
    currency?: string;
    issueDate: string;
    dueDate?: string;
    direction: "in" | "out";
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
};

const STATUS_LABELS: Record<Invoice["status"], string> = {
  expected: "verwacht",
  paid: "betaald",
  cancelled: "geannuleerd",
};

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** How often this screen re-checks his n8n while it is open. The workflow itself
 *  runs hourly, so anything faster only costs an empty round-trip — five minutes
 *  is short enough that a mail forwarded during a session shows up on its own. */
export const PULL_INTERVAL_MS = 5 * 60 * 1000;

export default function Facturen({
  entities,
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
}: FacturenProps) {
  const [entity, setEntity] = useState(defaultEntity);
  const [direction, setDirection] = useState<Invoice["direction"]>("out");
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
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // --- Ophalen uit n8n. `n8nNote` is disposable UI text; the ROWS live in App
  // (see the `pending` prop) because they are the only copy that exists.
  const [n8nBusy, setN8nBusy] = useState(false);
  const [n8nNote, setN8nNote] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

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
    const configured = () => getN8nInvoiceUrl().trim() !== "" && getN8nInvoiceToken().trim() !== "";
    if (!configured()) return;
    if (!autoPulled.current) {
      autoPulled.current = true;
      void fetchLatest.current();
    }
    const id = setInterval(() => {
      if (configured()) void fetchLatest.current();
    }, PULL_INTERVAL_MS);
    return () => clearInterval(id);
    // Deliberately empty: the timer belongs to this screen being open, not to
    // any value it renders, and `fetchLatest` keeps it calling the newest one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setN8nBusy(true);
    setN8nNote("Bezig met ophalen…");
    try {
      const outcome = await fetchQueue(getN8nInvoiceUrl(), getN8nInvoiceToken(), fetchImpl);
      if (outcome.kind === "not-configured") {
        setN8nNote("Nog niet ingesteld: vul eerst de webhook-URL en het token in onder Koppelingen. Er is niets opgehaald.");
        return;
      }
      if (outcome.kind === "unauthorized") {
        setN8nNote(`n8n weigerde het token (${outcome.status}). Er is niets opgehaald; de wachtrij in n8n staat er nog, want de workflow is niet eens gestart. Controleer het token onder Koppelingen.`);
        return;
      }
      if (outcome.kind === "http-error") {
        setN8nNote(`n8n antwoordde met status ${outcome.status}. Er is niets opgehaald. Staat de workflow aan?`);
        return;
      }
      if (outcome.kind === "network") {
        setN8nNote("Geen antwoord van n8n — netwerk, verkeerde URL, of allowedOrigins staat deze pagina niet toe. Hier is niets binnengekomen; heeft n8n het verzoek tóch verwerkt, dan is die wachtrij nu leeg. Kijk in dat geval in n8n.");
        return;
      }
      if (outcome.kind === "unreadable") {
        setN8nNote("Het antwoord van n8n was niet te lezen. Er is niets overgenomen — en omdat de wachtrij bij het ophalen geleegd wordt, kan die rij verloren zijn. Kijk in n8n.");
        return;
      }

      const handled = new Set(getHandledInvoiceMessageIds());
      const currentPending = pendingRef.current;
      const currentNotices = noticesRef.current;
      const already = new Set(currentPending.map((p) => p.messageId));
      const fresh = outcome.rows.filter((r) => !handled.has(r.messageId) && !already.has(r.messageId));
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
      const fallbackEntity = entity || defaultEntity;
      for (const row of fresh) {
        const draft = toPending(row, fallbackEntity);
        const decision = autoBookDecision(row, { entityChoices, defaultEntity: fallbackEntity });
        if (!decision.book) {
          proposals.push({ ...draft, waitReason: decision.reason });
          continue;
        }
        // The gate guarantees exactly one entity, so THAT is the one to book on
        // — never the app-wide default, which may be a different BV.
        const result = pendingToInvoice({ ...draft, entity: entityChoices[0] });
        if (!result.ok) {
          // Unreachable while the gate checks the same thing, but a row must
          // land in the review list rather than vanish if the two ever diverge.
          proposals.push({ ...draft, waitReason: result.error });
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
          bookedFrom.push({ invoiceId: result.invoice.id, messageId: row.messageId, subject: row.subject });
        }
        // Decided either way, so n8n's next hourly pass will not re-offer it.
        decidedIds.push(row.messageId);
      }
      if (decidedIds.length > 0) addHandledInvoiceMessageIds(decidedIds);
      if (booked.length > 0) {
        // ONE save with everything, and reconciled in the same breath: a payment
        // that already came in links now instead of at the next import.
        onSaveInvoices(reconcileInvoices([...invoices, ...booked], txs));
        for (const b of bookedFrom) rememberAutoBooked(b);
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
        parts.push("De wachtrij in n8n was leeg. Er is niets opgehaald — dat is geen bevestiging dat er facturen zijn.");
      } else if (fresh.length === 0) {
        parts.push("Niets nieuws: alles wat n8n stuurde was hier al afgehandeld.");
      } else {
        parts.push(`${fresh.length} ${fresh.length === 1 ? "factuur" : "facturen"} opgehaald. n8n heeft de wachtrij hiermee geleegd.`);
      }
      if (booked.length > 0) {
        parts.push(
          `${booked.length} daarvan ${booked.length === 1 ? "is" : "zijn"} automatisch geboekt: de afzender kwam door de SPF/DKIM-controle en er stond alles in wat nodig is. Ze staan hieronder met “automatisch” erbij en zijn met één klik terug te draaien.`,
        );
      }
      if (alreadyStored > 0) {
        parts.push(
          alreadyStored === 1
            ? "Eén ervan stond al in LaVega en is niet dubbel geboekt."
            : `${alreadyStored} ervan stonden al in LaVega en zijn niet dubbel geboekt.`,
        );
      }
      if (proposals.length > 0) {
        parts.push(`${proposals.length} ${proposals.length === 1 ? "regel wacht" : "regels wachten"} op jou — bij elke regel staat waarom.`);
      }
      if (duplicates > 0) parts.push(`${duplicates} regel(s) kende LaVega al (zelfde messageId) en worden niet opnieuw aangeboden.`);
      if (outcome.dropped > 0) parts.push(`${outcome.dropped} regel(s) misten een messageId of een bedrag en zijn niet overgenomen — die staan niet in LaVega en niet meer in n8n.`);
      if (freshNotices.length > 0) {
        parts.push(`${freshNotices.length} ${freshNotices.length === 1 ? "mail wacht" : "mails wachten"} onder “Zelf ophalen”: daar zat geen factuur in die LaVega kon boeken.`);
      }
      setN8nNote(parts.join(" "));
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
      setRowErrors((errs) => ({ ...errs, [p.messageId]: result.error }));
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
    setN8nNote(
      duplicate
        ? `Deze factuur (${p.counterparty.trim()}) stond al in LaVega — regel afgevinkt, niets dubbel geboekt.`
        : `Factuur van ${result.invoice.counterparty} toegevoegd als verwacht.`,
    );
  }

  // Reject = decided, so it is remembered as handled and n8n's hourly re-scan
  // of the same week of mail can't put it back in front of him.
  function rejectRow(p: PendingInvoice) {
    addHandledInvoiceMessageIds([p.messageId]);
    onPendingChange(pending.filter((x) => x.messageId !== p.messageId));
    dropRowError(p.messageId);
    setN8nNote("Regel verworpen. Er is niets geboekt, en hij wordt niet opnieuw aangeboden.");
  }

  // Een melding "Gedaan" zetten boekt niets — het is een to-do die van de lijst
  // gaat en, net als een verworpen regel, niet opnieuw wordt aangeboden.
  function dismissNotice(notice: N8nNotice) {
    addHandledInvoiceMessageIds([notice.messageId]);
    onNoticesChange(notices.filter((n) => n.messageId !== notice.messageId));
    setN8nNote("Melding afgevinkt. Er is niets geboekt.");
  }

  // Live projection: what the forecast will actually see from open invoices.
  const flows = useMemo(() => scheduledInvoiceFlows(invoices), [invoices]);
  const netCents = useMemo(
    () => flows.reduce((sum, f) => sum + f.sign * f.amountCents, 0),
    [flows],
  );

  // Entity options: fall back to the app's default entity when no accounts are
  // imported yet, so a first invoice still attaches to a BV (and thus scopes).
  const entityChoices = entities.length > 0 ? entities : [defaultEntity];

  // Which invoices got here without him clicking. Read from the log on EVERY
  // render, deliberately un-memoised: the log is written by this view (booking,
  // undoing) and by a previous session, so any cache key would be a guess about
  // when it changed. It is one localStorage read of a handful of ids.
  // The FIELD is the truth; the log is the fallback for invoices booked before
  // the field existed. An invoice with autoBooked absent was confirmed by hand —
  // the safe reading, since that is what every older row actually was.
  const autoBookedIds = new Set([
    ...invoices.filter((i) => i.autoBooked).map((i) => i.id),
    ...getAutoBookedInvoices().map((a) => a.invoiceId),
  ]);

  function handleAdd() {
    const cp = counterparty.trim();
    const amt = Number(amount.replace(",", "."));
    const ccy = currency.trim().toUpperCase();
    // Refuse, and SAY why. Each of these was previously a silent no-op.
    if (!cp) return setManualError("Vul een relatie in.");
    if (!issueDate) return setManualError("Vul een factuurdatum in.");
    if (!dueDate) return setManualError("Vul een vervaldatum in.");
    if (!Number.isFinite(amt) || amt <= 0) return setManualError("Vul een geldig bedrag in — zonder bedrag wordt er niets geboekt.");
    // Same rule as the n8n queue: an empty/unreadable currency is unknown, not
    // euros. LaVega never turns a blank field into EUR by itself.
    if (!/^[A-Z]{3}$/.test(ccy)) return setManualError("Vul de valuta in (3 letters) — LaVega gokt geen euro's.");
    setManualError(null);
    const inv = makeInvoice({
      entity: entity || defaultEntity,
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
      vatAmount: pendingSource === "llm" ? (pendingVat ?? undefined) : undefined,
    });
    // Whether the draft is added or turns out to be a duplicate, it has now been
    // dealt with — clear the AI-draft tags so the NEXT manual entry can't inherit
    // "llm"/confidence/vat. (A validation failure above keeps the draft alive so
    // the owner can fix it, which is why that path intentionally doesn't reset.)
    if (invoices.some((i) => i.id === inv.id)) {
      setImportNote("Deze factuur staat er al.");
      clearDraftTags();
      return;
    }
    onSaveInvoices([...invoices, inv]);
    setCounterparty("");
    setInvoiceNumber("");
    setAmount("");
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
    forgetAutoBooked(id);
    setN8nNote("Automatische boeking teruggedraaid: de factuur staat op geannuleerd en telt niet meer mee in de prognose.");
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
    setCounterparty("");
    setInvoiceNumber("");
    setIssueDate("");
    setDueDate("");
    setAmount("");
    setCurrency("EUR");
  }

  function handleImportFile(file: File) {
    void file.text().then((text) => {
      const rows = parseInvoiceFile(file.name, text);
      if (rows.length === 0) {
        setImportNote("Geen facturen herkend in dit bestand.");
        return;
      }
      const parsed = rows.map((row) => makeInvoice({ ...row, entity: entity || defaultEntity }));
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
          ? `${added.length} van ${parsed.length} facturen geïmporteerd${
              added.length !== parsed.length ? " (rest was al aanwezig)" : ""
            }.`
          : "Geen nieuwe facturen (allemaal al aanwezig).",
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
        setImportNote(
          `"${file.name}" is een PDF. Die kan alleen door de AI-lezer gelezen worden — zet hieronder "AI-facturen lezen" aan, of voer de factuur handmatig in. Er is niets verstuurd.`,
        );
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
  // server proxy (never to Anthropic directly). On success it PRE-FILLS the
  // manual form as a draft — nothing is saved until the owner clicks "Toevoegen".
  async function handleExtractPdf(file: File) {
    setAiBusy(true);
    setAiNote("Bezig met lezen…");
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
        let msg = `AI-extractie mislukt (${res.status}).`;
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
      setDirection(fields.direction);
      setCounterparty(fields.counterparty);
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
      setPendingVat(vat);
      // Only show a percentage the model actually reported; otherwise just ask
      // the owner to check every field (no fabricated confidence number).
      const conf = typeof confidence === "number" ? ` (AI-inschatting zekerheid ${Math.round(confidence * 100)}%)` : "";
      const btw = vat !== null ? `, incl. btw ${formatEuro(vat)}` : "";
      const noCcy = fields.currency ? "" : " De valuta stond er niet in — vul hem zelf in.";
      setAiNote(`AI-concept — controleer elk veld en bevestig${conf}${btw}.${noCcy}`);
    } catch {
      setAiNote("AI-extractie mislukt. Probeer het opnieuw.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <>
      <div className="view-head">
        <h2>Drie manieren om een factuur binnen te krijgen</h2>
        <span className="eyebrow">alleen een geverifieerde afzender boekt zichzelf</span>
      </div>

      <ModuleGrid label="Facturen invoeren">
        {/* ── 1. de automatische n8n-feed ─────────────────────────────── */}
        <Module title="1 · Automatisch (n8n)" height="tall">
          <p className="cell-sub">
            LaVega haalt de wachtrij van je eigen n8n op zodra dit scherm opent, en daarna
            elke {Math.round(PULL_INTERVAL_MS / 60000)} minuten zolang je hier bent. De knop
            hieronder is voor een directe hercontrole.
          </p>
          <p className="cell-sub">
            Een factuur boekt zichzelf alleen als er niets meer te beslissen valt: de mail
            kwam via je doorstuuradres binnen én door de SPF/DKIM-controle, je hebt één
            onderneming, en de factuur is compleet. Die krijgt het label “automatisch” en is
            met één klik terug te draaien. Al het andere wacht op jou, met de reden erbij —
            een niet-geverifieerde afzender boekt hier niets.
          </p>
          <div className="stack-form-actions">
            <button type="button" className="btn btn-primary" disabled={busy || n8nBusy} onClick={() => void handleFetchN8n()}>
              Ophalen uit n8n
            </button>
            <button type="button" className="btn" onClick={() => onNavigate("koppelingen")}>
              Koppelingen instellen
            </button>
          </div>
          {n8nNote && <p className="cell-sub">{n8nNote}</p>}
          {pending.length > 0 && (
            <p className="cell-sub text-warn">
              {pending.length} {pending.length === 1 ? "regel wacht" : "regels wachten"} op je beslissing — zie hieronder.
            </p>
          )}
        </Module>

        {/* ── 2. sleep een factuurbestand hierheen ────────────────────── */}
        <Module title="2 · Sleep een factuur hierheen" height="tall">
          <label
            className={`dropzone${dragOver ? " dropzone-over" : ""}`}
            aria-label="Factuurbestand hierheen slepen"
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
            <span className="dropzone-title">Sleep een factuur hierheen</span>
            <span className="dropzone-sub">PDF, CSV-export of UBL/EN-16931 XML. Of klik om te kiezen.</span>
            {/* No `accept` filter for the non-PDF formats, same rationale as
                Import.tsx: format is sniffed from content, not extension. */}
            <input
              type="file"
              className="dropzone-input"
              disabled={busy || aiBusy}
              aria-label="Factuurbestand kiezen"
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
              aria-label="AI-facturen lezen"
              onChange={(e) => toggleAi(e.target.checked)}
            />{" "}
            AI-facturen lezen (PDF → Claude)
          </label>
          <p className="cell-sub">
            Alleen met deze schakelaar aan gaat een PDF via onze server naar Claude — dat ene
            document, en je bevestigt zelf voor het meetelt.
          </p>
          {importNote && <p className="cell-sub">{importNote}</p>}
          {aiNote && <p className="cell-sub">{aiNote}</p>}
        </Module>

        {/* ── 3. handmatig ────────────────────────────────────────────── */}
        <Module
          title="3 · Handmatig"
          height="tall"
          footer={
            <span>
              Een verwachte factuur verschijnt op de vervaldatum in Overzicht en Forecast en gaat
              zelf op “betaald” zodra een passende banktransactie binnenkomt.
            </span>
          }
        >
          <div className="stack-form">
            <div className="stack-form-row">
              <label>
                Entiteit
                <select value={entity} disabled={busy} aria-label="Entiteit" onChange={(e) => setEntity(e.target.value)}>
                  {entityChoices.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </label>
              <label>
                Richting
                <select value={direction} disabled={busy} aria-label="Richting"
                  onChange={(e) => setDirection(e.target.value as Invoice["direction"])}>
                  <option value="out">Uitgaand (inkoop)</option>
                  <option value="in">Inkomend (verkoop)</option>
                </select>
              </label>
            </div>
            <label>
              Relatie
              <input value={counterparty} disabled={busy} aria-label="Relatie"
                onChange={(e) => setCounterparty(e.target.value)} />
            </label>
            <label>
              Factuurnr.
              <input value={invoiceNumber} disabled={busy} aria-label="Factuurnummer"
                onChange={(e) => setInvoiceNumber(e.target.value)} />
            </label>
            <div className="stack-form-row">
              <label>
                Factuurdatum
                <input type="date" value={issueDate} disabled={busy} aria-label="Factuurdatum"
                  onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              <label>
                Vervaldatum
                <input type="date" value={dueDate} disabled={busy} aria-label="Vervaldatum"
                  onChange={(e) => setDueDate(e.target.value)} />
              </label>
            </div>
            <div className="stack-form-row">
              <label>
                Bedrag
                {pendingSource === "llm" && <span className="badge">AI-concept</span>}
                <input className="saldo-input" type="number" step={0.01} min={0} value={amount}
                  disabled={busy} aria-label="Bedrag" onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label>
                Valuta
                <input className="saldo-input" value={currency} maxLength={3} placeholder="onbekend"
                  disabled={busy} aria-label="Valuta" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
              </label>
            </div>
            <div className="stack-form-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleAdd}>
                Toevoegen
              </button>
              {pendingSource === "llm" && (
                <button type="button" className="btn" disabled={busy} onClick={discardDraft}>
                  Verwijder AI-concept
                </button>
              )}
            </div>
            {manualError && <p className="cell-sub text-neg">{manualError}</p>}
          </div>
        </Module>
      </ModuleGrid>

      {/* ── De confirm-first wachtrij. Ongewijzigd gedrag. ─────────────── */}
      {pending.length > 0 && (
        <section className="card n8n-block" aria-label="Te bevestigen facturen">
          <div className="card-header">
            <h2>Te bevestigen</h2>
            <span className="eyebrow">uit n8n · {pending.length}</span>
          </div>
          <p className="cell-sub text-neg">
            <strong>Let op — dit is de enige kopie.</strong> n8n leegt zijn wachtrij op het
            moment dat hij antwoordt: nog eens ophalen levert deze {pending.length}{" "}
            {pending.length === 1 ? "regel" : "regels"} niet terug. Ook herladen of
            vergrendelen wist ze. Bevestig of verwerp ze nu.
          </p>
          <div className="n8n-rows">
            {pending.map((p) => (
              <div className="n8n-row" data-messageid={p.messageId} key={p.messageId}>
                <p className="n8n-row-source cell-sub">
                  Uit de mail: {p.subject ?? "(geen onderwerp)"}
                  {p.note ? ` · ${p.note}` : ""}
                </p>
                {/* Waarom juist DEZE regel wacht. Zonder deze zin is "bevestig
                    hem zelf" een opdracht zonder reden — en de reden is het
                    enige waarmee hij kan beoordelen of hij hem wíl boeken. */}
                {p.waitReason && <p className="cell-sub text-warn">Wacht op jou: {p.waitReason}</p>}
                <div className="facturen-form">
                  <label>
                    Entiteit{" "}
                    <select value={p.entity} aria-label="Entiteit (n8n)"
                      onChange={(e) => patchRow(p.messageId, { entity: e.target.value })}>
                      {entityChoices.map((e) => (
                        <option key={e} value={e}>{e}</option>
                      ))}
                    </select>
                  </label>{" "}
                  <label>
                    Richting{" "}
                    <select value={p.direction} aria-label="Richting (n8n)"
                      onChange={(e) => patchRow(p.messageId, { direction: e.target.value as Invoice["direction"] })}>
                      <option value="out">Uitgaand (inkoop)</option>
                      <option value="in">Inkomend (verkoop)</option>
                    </select>
                  </label>{" "}
                  <label>
                    Relatie{" "}
                    <input value={p.counterparty} aria-label="Relatie (n8n)"
                      onChange={(e) => patchRow(p.messageId, { counterparty: e.target.value })} />
                  </label>{" "}
                  <label>
                    Factuurnr.{" "}
                    <input value={p.invoiceNumber} aria-label="Factuurnummer (n8n)"
                      onChange={(e) => patchRow(p.messageId, { invoiceNumber: e.target.value })} />
                  </label>{" "}
                  <label>
                    Factuurdatum{" "}
                    <input type="date" value={p.issueDate} aria-label="Factuurdatum (n8n)"
                      onChange={(e) => patchRow(p.messageId, { issueDate: e.target.value })} />
                  </label>{" "}
                  <label>
                    Vervaldatum{" "}
                    <input type="date" value={p.dueDate} aria-label="Vervaldatum (n8n)"
                      onChange={(e) => patchRow(p.messageId, { dueDate: e.target.value })} />
                  </label>{" "}
                  <label>
                    Bedrag{" "}
                    <input className="saldo-input" type="number" step={0.01} min={0} value={p.amount}
                      aria-label="Bedrag (n8n)"
                      onChange={(e) => patchRow(p.messageId, { amount: e.target.value })} />
                  </label>{" "}
                  <label>
                    Valuta{" "}
                    <input className="saldo-input" value={p.currency} maxLength={3}
                      placeholder="onbekend" aria-label="Valuta (n8n)"
                      onChange={(e) => patchRow(p.messageId, { currency: e.target.value.toUpperCase() })} />
                  </label>{" "}
                  <label>
                    Btw{" "}
                    <input className="saldo-input" type="number" step={0.01} min={0} value={p.vat}
                      placeholder="onbekend" aria-label="Btw (n8n)"
                      onChange={(e) => patchRow(p.messageId, { vat: e.target.value })} />
                  </label>{" "}
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => confirmRow(p)}>
                    Bevestigen
                  </button>{" "}
                  <button type="button" className="btn" disabled={busy} onClick={() => rejectRow(p)}>
                    Verwerpen
                  </button>
                </div>
                {!p.dueDate && (
                  <p className="cell-sub">
                    Geen vervaldatum gevonden — vul hem zelf in. LaVega verzint er geen
                    betaaltermijn bij.
                  </p>
                )}
                {!p.currency && (
                  <p className="cell-sub">
                    Geen valuta gevonden — vul hem zelf in. LaVega boekt niets in euro&apos;s
                    omdat de factuur toevallig geen valuta noemde.
                  </p>
                )}
                {p.vat === "" && (
                  <p className="cell-sub">Btw stond niet in de factuur; leeg blijft “onbekend”, niet €&nbsp;0,00.</p>
                )}
                {rowErrors[p.messageId] && <p className="cell-sub text-neg">{rowErrors[p.messageId]}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Zelf ophalen: mail die geen boekbare factuur was ───────────── */}
      {notices.length > 0 && (
        <section className="card n8n-block" aria-label="Zelf ophalen">
          <div className="card-header">
            <h2>Zelf ophalen</h2>
            <span className="eyebrow">uit n8n · {notices.length}</span>
          </div>
          <p className="cell-sub">
            Deze mails gingen over een factuur, maar er zat er geen in die LaVega kan
            boeken. Er staat met opzet <strong>geen bedrag</strong> bij: dit is een
            lijstje om zelf af te werken, geen boeking in wording. Haal de factuur op
            en sleep hem hierboven naar binnen.
          </p>
          <div className="n8n-rows">
            {notices.map((n) => (
              <div className="n8n-row" data-noticeid={n.messageId} key={n.messageId}>
                <p className="n8n-row-source cell-sub">
                  <strong>{NOTICE_LABELS[n.kind]}</strong> · {n.subject ?? "(geen onderwerp)"}
                  {n.from ? ` · ${n.from}` : ""}
                </p>
                <p className="cell-sub">{n.reason}</p>
                <div className="stack-form-actions">
                  {n.mailUrl ? (
                    <a className="btn" href={n.mailUrl} target="_blank" rel="noreferrer noopener">
                      Open in Gmail
                    </a>
                  ) : (
                    <span className="cell-sub">n8n gaf geen link mee; zoek de mail op het onderwerp.</span>
                  )}
                  <button type="button" className="btn" onClick={() => dismissNotice(n)}>
                    Gedaan
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Wat er binnen is ───────────────────────────────────────────── */}
      <div className="view-head">
        <h2>Openstaand en geboekt</h2>
        <span className="eyebrow">
          {flows.length} openstaande {flows.length === 1 ? "factuur" : "facturen"} · netto verwacht{" "}
          <span className={netCents >= 0 ? "text-pos" : "text-neg"}>{formatEuro(netCents / 100)}</span>
        </span>
      </div>

      <section className="card" aria-label="Facturen">
        {invoices.length === 0 ? (
          <p className="cell-sub">Nog geen facturen.</p>
        ) : (
          <div className="table-wrap table-cards">
            <table className="table">
              <thead>
                <tr>
                  <th>Relatie</th>
                  <th>Richting</th>
                  <th className="num">Bedrag</th>
                  <th>Vervaldatum</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const signed = inv.direction === "in" ? inv.amount : -inv.amount;
                  return (
                    <tr key={inv.id}>
                      <td data-label="Relatie">
                        {inv.counterparty}
                        {inv.invoiceNumber ? <span className="cell-sub"> · {inv.invoiceNumber}</span> : null}
                      </td>
                      <td data-label="Richting">
                        <span className="badge">{inv.direction === "in" ? "AR · inkomend" : "AP · uitgaand"}</span>
                        {autoBookedIds.has(inv.id) && (
                          <>
                            {" "}
                            <span className="badge" title="Deze factuur is zonder klik geboekt: de afzender kwam door de SPF/DKIM-controle en de factuur was compleet.">
                              automatisch
                            </span>
                          </>
                        )}
                      </td>
                      <td className={`num ${signed >= 0 ? "text-pos" : "text-neg"}`} data-label="Bedrag">{formatEuro(signed)}</td>
                      <td data-label="Vervaldatum">{inv.dueDate}</td>
                      <td data-label="Status">
                        <span className="badge">{STATUS_LABELS[inv.status]}</span>
                      </td>
                      <td>
                        {inv.status === "expected" ? (
                          <>
                            {autoBookedIds.has(inv.id) && (
                              <>
                                <button type="button" className="btn" disabled={busy}
                                  onClick={() => undoAutoBooked(inv.id)}>
                                  Terugdraaien
                                </button>{" "}
                              </>
                            )}
                            <button type="button" className="btn" disabled={busy}
                              onClick={() => setStatus(inv.id, "paid")}>
                              markeer betaald
                            </button>{" "}
                            <button type="button" className="btn" disabled={busy}
                              onClick={() => setStatus(inv.id, "cancelled")}>
                              annuleer
                            </button>
                          </>
                        ) : (
                          <span className="cell-sub">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
