import { useEffect, useMemo, useState } from "react";
import type { Invoice, Tx } from "@lavega/core";
import { makeInvoice, parseInvoiceFile, reconcileInvoices, scheduledInvoiceFlows } from "@lavega/core";
import type { View } from "../App";
import { formatEuro } from "../format";
import { API_BASE } from "../api";
import {
  addHandledInvoiceMessageIds,
  getAiExtractionEnabled,
  getHandledInvoiceMessageIds,
  getN8nInvoiceToken,
  getN8nInvoiceUrl,
  setAiExtractionEnabled,
} from "../settings";
import { fetchQueue, pendingToInvoice, toPending, type PendingInvoice } from "../n8n";

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
  onNavigate: (view: View) => void;
  /** Injectable for tests; production uses the browser's own fetch. */
  fetchImpl?: typeof fetch;
};

const STATUS_LABELS: Record<Invoice["status"], string> = {
  expected: "verwacht",
  paid: "betaald",
  cancelled: "geannuleerd",
};

export default function Facturen({
  entities,
  invoices,
  txs,
  busy,
  defaultEntity,
  onSaveInvoices,
  pending,
  onPendingChange,
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
    if (pending.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending.length]);

  // Every outcome gets its own sentence, and none of the failures may read like
  // a success. The two that can cost data (a broken connection, an unreadable
  // body) say so plainly, because on those we cannot tell whether n8n already
  // emptied its queue.
  async function handleFetchN8n() {
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
      const already = new Set(pending.map((p) => p.messageId));
      const fresh = outcome.rows.filter((r) => !handled.has(r.messageId) && !already.has(r.messageId));
      const duplicates = outcome.rows.length - fresh.length;
      if (fresh.length > 0) {
        onPendingChange([...pending, ...fresh.map((r) => toPending(r, entity || defaultEntity))]);
      }
      const parts: string[] = [];
      if (outcome.rows.length === 0) {
        parts.push("De wachtrij in n8n was leeg. Er is niets opgehaald — dat is geen bevestiging dat er facturen zijn.");
      } else if (fresh.length === 0) {
        parts.push("Niets nieuws: alles wat n8n stuurde was hier al afgehandeld.");
      } else {
        parts.push(`${fresh.length} ${fresh.length === 1 ? "factuur" : "facturen"} opgehaald. n8n heeft de wachtrij hiermee geleegd — bevestig of verwerp elke regel.`);
      }
      if (duplicates > 0) parts.push(`${duplicates} regel(s) kende LaVega al (zelfde messageId) en worden niet opnieuw aangeboden.`);
      if (outcome.dropped > 0) parts.push(`${outcome.dropped} regel(s) misten een messageId of een bedrag en zijn niet overgenomen — die staan niet in LaVega en niet meer in n8n.`);
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
    if (!duplicate) onSaveInvoices([...invoices, result.invoice]);
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

  // Live projection: what the forecast will actually see from open invoices.
  const flows = useMemo(() => scheduledInvoiceFlows(invoices), [invoices]);
  const netCents = useMemo(
    () => flows.reduce((sum, f) => sum + f.sign * f.amountCents, 0),
    [flows],
  );

  // Entity options: fall back to the app's default entity when no accounts are
  // imported yet, so a first invoice still attaches to a BV (and thus scopes).
  const entityChoices = entities.length > 0 ? entities : [defaultEntity];

  function handleAdd() {
    const cp = counterparty.trim();
    const amt = Number(amount.replace(",", "."));
    if (!cp || !issueDate || !dueDate || !Number.isFinite(amt) || amt <= 0) return;
    const inv = makeInvoice({
      entity: entity || defaultEntity,
      direction,
      counterparty: cp,
      invoiceNumber: invoiceNumber.trim() || undefined,
      issueDate,
      dueDate,
      amount: amt,
      currency: currency.trim() || "EUR",
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

  function toggleAi(next: boolean) {
    setAiEnabled(next);
    setAiExtractionEnabled(next);
    if (!next) setAiNote(null);
  }

  // Opt-in, per-document: only fires when the owner has enabled the toggle AND
  // picked a specific PDF. Reads the file to base64 and POSTs it to OUR server
  // proxy (never to Anthropic directly). On success it PRE-FILLS the existing
  // form as a draft — nothing is saved until the owner clicks "Toevoegen".
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
      setCurrency(fields.currency || "EUR");
      setPendingSource("llm");
      setPendingConfidence(confidence);
      const vat = typeof fields.vatAmount === "number" ? fields.vatAmount : null;
      setPendingVat(vat);
      // Only show a percentage the model actually reported; otherwise just ask
      // the owner to check every field (no fabricated confidence number).
      const conf = typeof confidence === "number" ? ` (AI-inschatting zekerheid ${Math.round(confidence * 100)}%)` : "";
      const btw = vat !== null ? `, incl. btw ${formatEuro(vat)}` : "";
      setAiNote(`AI-concept — controleer elk veld en bevestig${conf}${btw}.`);
    } catch {
      setAiNote("AI-extractie mislukt. Probeer het opnieuw.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Facturen">
      <div className="card-header">
        <h2>Facturen</h2>
        <span className="eyebrow">verwachte kasstromen</span>
      </div>
      <p className="cell-sub">
        Voer inkomende (verkoop, AR) en uitgaande (inkoop, AP) facturen in. Een
        verwachte factuur verschijnt op de vervaldatum in het Overzicht en de Forecast
        en wordt automatisch op "betaald" gezet zodra een passende banktransactie binnenkomt.
      </p>

      <div className="n8n-block">
        <div className="n8n-head">
          <button type="button" className="btn btn-primary" disabled={busy || n8nBusy} onClick={() => void handleFetchN8n()}>
            Ophalen uit n8n
          </button>{" "}
          <button type="button" className="btn" onClick={() => onNavigate("koppelingen")}>
            Koppelingen instellen
          </button>
        </div>
        <p className="cell-sub">
          Haalt de facturen op die je eigen n8n uit je mailbox heeft gehaald. Er wordt
          niets automatisch geboekt: je ziet elke regel eerst en bevestigt hem zelf.
        </p>
        {n8nNote && <p className="cell-sub">{n8nNote}</p>}

        {pending.length > 0 && (
          <>
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
          </>
        )}
      </div>

      <div className="ai-extract" style={{ marginBottom: "var(--sp-3)" }}>
        <label>
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
          De gekozen PDF wordt via onze server naar Claude gestuurd om te lezen — opt-in, alleen
          dat ene document, en je bevestigt zelf voor het meetelt.
        </p>
        {aiEnabled && (
          <label>
            PDF-factuur lezen{" "}
            <input
              type="file"
              className="btn"
              accept="application/pdf"
              disabled={busy || aiBusy}
              aria-label="PDF-factuur lezen met AI"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleExtractPdf(file);
              }}
            />
          </label>
        )}
        {aiNote && <p className="cell-sub">{aiNote}</p>}
      </div>

      <div className="facturen-form">
        <label>
          Entiteit{" "}
          <select value={entity} disabled={busy} aria-label="Entiteit"
            onChange={(e) => setEntity(e.target.value)}>
            {entityChoices.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Richting{" "}
          <select value={direction} disabled={busy} aria-label="Richting"
            onChange={(e) => setDirection(e.target.value as Invoice["direction"])}>
            <option value="out">Uitgaand (inkoop)</option>
            <option value="in">Inkomend (verkoop)</option>
          </select>
        </label>{" "}
        <label>
          Relatie{" "}
          <input value={counterparty} disabled={busy} aria-label="Relatie"
            onChange={(e) => setCounterparty(e.target.value)} />
        </label>{" "}
        <label>
          Factuurnr.{" "}
          <input value={invoiceNumber} disabled={busy} aria-label="Factuurnummer"
            onChange={(e) => setInvoiceNumber(e.target.value)} />
        </label>{" "}
        <label>
          Factuurdatum{" "}
          <input type="date" value={issueDate} disabled={busy} aria-label="Factuurdatum"
            onChange={(e) => setIssueDate(e.target.value)} />
        </label>{" "}
        <label>
          Vervaldatum{" "}
          <input type="date" value={dueDate} disabled={busy} aria-label="Vervaldatum"
            onChange={(e) => setDueDate(e.target.value)} />
        </label>{" "}
        <label>
          Bedrag
          {pendingSource === "llm" && (
            <span className="badge" style={{ marginLeft: "var(--sp-1)" }}>AI-concept</span>
          )}{" "}
          <input className="saldo-input" type="number" step={0.01} min={0} value={amount}
            disabled={busy} aria-label="Bedrag"
            onChange={(e) => setAmount(e.target.value)} />
        </label>{" "}
        <label>
          Valuta{" "}
          <input className="saldo-input" value={currency} disabled={busy} aria-label="Valuta"
            onChange={(e) => setCurrency(e.target.value)} />
        </label>{" "}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleAdd}>
          Toevoegen
        </button>
        {pendingSource === "llm" && (
          <>
            {" "}
            <button type="button" className="btn" disabled={busy} onClick={discardDraft}>
              Verwijder AI-concept
            </button>
          </>
        )}
      </div>

      <p className="cell-sub" style={{ marginTop: "var(--sp-3)" }}>
        Of importeer facturen in bulk uit een CSV-export (elk boekhoudpakket heeft
        een net iets andere kolomindeling — headers als "Relatie/Bedrag/Factuurdatum/
        Vervaldatum/Richting" worden automatisch herkend, NL of EN) of een UBL/
        EN-16931 XML-factuur.
      </p>
      <label>
        CSV of UBL/XML importeren{" "}
        {/* No `accept` filter, same rationale as Import.tsx: format is sniffed
            from content, not extension. */}
        <input
          type="file"
          className="btn"
          disabled={busy}
          aria-label="Facturen CSV of UBL/XML importeren"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleImportFile(file);
          }}
        />
      </label>
      {importNote && <p className="cell-sub">{importNote}</p>}

      <p className="eyebrow" style={{ marginTop: "var(--sp-3)" }}>
        {flows.length} openstaande {flows.length === 1 ? "factuur" : "facturen"} in de forecast · netto verwacht{" "}
        <span className={netCents >= 0 ? "text-pos" : "text-neg"}>{formatEuro(netCents / 100)}</span>
      </p>

      {invoices.length === 0 ? (
        <p>Nog geen facturen.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Relatie</th>
                <th>Richting</th>
                <th>Bedrag</th>
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
                    <td>
                      {inv.counterparty}
                      {inv.invoiceNumber ? <span className="cell-sub"> · {inv.invoiceNumber}</span> : null}
                    </td>
                    <td>
                      <span className="badge">{inv.direction === "in" ? "AR · inkomend" : "AP · uitgaand"}</span>
                    </td>
                    <td className={signed >= 0 ? "text-pos" : "text-neg"}>{formatEuro(signed)}</td>
                    <td>{inv.dueDate}</td>
                    <td>
                      <span className="badge">{STATUS_LABELS[inv.status]}</span>
                    </td>
                    <td>
                      {inv.status === "expected" ? (
                        <>
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
  );
}
