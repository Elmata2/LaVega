import { useMemo, useState } from "react";
import type { Invoice, Tx } from "@lavega/core";
import { makeInvoice, parseInvoiceFile, reconcileInvoices, scheduledInvoiceFlows } from "@lavega/core";
import { formatEuro } from "../format";
import { API_BASE } from "../api";
import { getAiExtractionEnabled, setAiExtractionEnabled } from "../settings";

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
  confidence: number;
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
    const clearDraftTags = () => {
      setPendingSource("manual");
      setPendingConfidence(null);
      setPendingVat(null);
      setAiNote(null);
    };
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
      setAiNote(
        `AI-concept — controleer en bevestig (betrouwbaarheid ${Math.round(confidence * 100)}%${
          vat !== null ? `, incl. btw ${formatEuro(vat)}` : ""
        }).`,
      );
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
