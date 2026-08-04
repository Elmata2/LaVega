import { useMemo, useState } from "react";
import type { Invoice, Tx } from "@lavega/core";
import { makeInvoice, parseInvoiceFile, reconcileInvoices, scheduledInvoiceFlows } from "@lavega/core";
import { formatEuro } from "../format";

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
      sourceType: "manual",
    });
    onSaveInvoices([...invoices, inv]);
    setCounterparty("");
    setInvoiceNumber("");
    setAmount("");
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
          Bedrag{" "}
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
