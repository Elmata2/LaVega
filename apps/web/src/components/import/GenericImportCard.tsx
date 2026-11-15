import { useState } from "react";
import type {
  Account,
  GenericImportPlan,
  GenericMapping,
  ImportFormat,
  ImportSession,
  Tx,
} from "@lavega/core";
import {
  detectDelimiter,
  detectGenericMapping,
  planGenericImport,
  rowsFromCsv,
} from "@lavega/core";
import { useAppLocale } from "../../appLocale.js";
import { importSessionCopy } from "../../copy/importSession.js";
import { formatEuroIn } from "../../format.js";
import Button from "../ui/Button.js";
import Card from "../ui/Card.js";
import CardLink from "../ui/CardLink.js";
import StatusLine from "../ui/StatusLine.js";
import { tableFromRows, xlsxToRows } from "../../xlsx.js";

export type GenericImportRequest = {
  plan: GenericImportPlan;
  mapping: GenericMapping;
  format: ImportFormat;
  filename: string;
  /** The file's bytes, so App can retain the source in the document store. */
  bytes: Uint8Array;
  headers: string[];
  rows: string[][];
};

export type GenericImportCardProps = {
  accounts: Account[];
  existingTxs: Tx[];
  sessions: ImportSession[];
  busy: boolean;
  /** Result line of the last import/revert, already formatted. */
  notice?: string | null;
  onImport: (request: GenericImportRequest) => void;
  onRevert: (sessionId: string) => void;
};

const FIELD_KEYS = [
  "date",
  "amount",
  "debit",
  "credit",
  "counterparty",
  "description",
  "currency",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

/** The generic CSV/Excel session (WS3.6, issue #294): map, preview (dry run),
 *  import, revert. Nothing is written until Import; the dry run is the plan. */
export default function GenericImportCard({
  accounts,
  existingTxs,
  sessions,
  busy,
  notice,
  onImport,
  onRevert,
}: GenericImportCardProps) {
  const [locale] = useAppLocale();
  const c = importSessionCopy[locale];
  const [filename, setFilename] = useState<string | null>(null);
  const [format, setFormat] = useState<ImportFormat>("generic-csv");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [mapping, setMapping] = useState<GenericMapping | null>(null);
  const [accountKey, setAccountKey] = useState("");
  const [allowCrossFormat, setAllowCrossFormat] = useState(false);
  const [error, setError] = useState(false);

  const plan =
    mapping != null && accountKey !== ""
      ? planGenericImport({
          rows,
          mapping,
          accountKey,
          existingTxs,
          sessions,
          format,
          allowCrossFormat,
        })
      : null;

  async function choose(file: File) {
    setError(false);
    setAllowCrossFormat(false);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const isXlsx = /\.xlsx$/i.test(file.name) || file.type.includes("spreadsheet");
      let table: { headers: string[]; rows: string[][] };
      let text: string | undefined;
      if (isXlsx) {
        table = tableFromRows(await xlsxToRows(buffer));
      } else {
        text = new TextDecoder().decode(buffer);
        table = rowsFromCsv(text, detectDelimiter(text));
      }
      const guess = detectGenericMapping({
        headers: table.headers,
        sampleRows: table.rows,
        ...(text == null ? {} : { text }),
      });
      setFilename(file.name);
      setFormat(isXlsx ? "generic-xlsx" : "generic-csv");
      setBytes(buffer);
      setHeaders(table.headers);
      setRows(table.rows);
      setMapping(guess.mapping);
    } catch {
      setError(true);
      setFilename(null);
      setMapping(null);
      setBytes(null);
    }
  }

  const patch = (next: Partial<GenericMapping>) =>
    setMapping((current) => (current == null ? current : { ...current, ...next }));

  const columnOptions = (
    <>
      <option value={-1}>{c.fields.none}</option>
      {headers.map((header, index) => (
        <option key={`${header}-${index}`} value={index}>
          {header || `${index + 1}`}
        </option>
      ))}
    </>
  );

  const field = (key: FieldKey) => {
    const current =
      key === "date"
        ? mapping?.dateColumn
        : key === "amount"
          ? mapping?.amountColumn
          : key === "debit"
            ? mapping?.debitColumn
            : key === "credit"
              ? mapping?.creditColumn
              : key === "counterparty"
                ? mapping?.counterpartyColumn
                : key === "description"
                  ? mapping?.descriptionColumn
                  : mapping?.currencyColumn;
    return (
      <label className="flex flex-col gap-1 min-w-0" key={key}>
        <span className="text-muted">{c.fields[key]}</span>
        <select
          aria-label={c.fields[key]}
          data-testid={`generic-map-${key}`}
          value={current ?? -1}
          disabled={busy}
          onChange={(e) => {
            const value = Number(e.target.value);
            const column = value < 0 ? null : value;
            if (key === "date") patch({ dateColumn: value });
            else if (key === "amount")
              patch({ amountColumn: column, debitColumn: null, creditColumn: null });
            else if (key === "debit") patch({ debitColumn: column, amountColumn: null });
            else if (key === "credit") patch({ creditColumn: column, amountColumn: null });
            else if (key === "counterparty") patch({ counterpartyColumn: column });
            else if (key === "description") patch({ descriptionColumn: column });
            else patch({ currencyColumn: column });
          }}
        >
          {columnOptions}
        </select>
      </label>
    );
  };

  return (
    <Card as="section" aria-label={c.title} data-testid="generic-import-card">
      <h2>{c.title}</h2>
      <p className="m-0 text-muted">{c.intro}</p>
      <div className="import-controls">
        <input
          type="file"
          accept=".csv,.txt,.xlsx"
          aria-label={c.chooseAria}
          data-testid="generic-import-file"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void choose(file);
          }}
        />
      </div>
      {error && (
        <StatusLine
          tone="problem"
          role="alert"
          
          data-testid="generic-import-error"
        >
          {c.unsupported}
        </StatusLine>
      )}
      {filename == null && !error && <p className="m-0 text-muted">{c.noFile}</p>}

      {mapping != null && (
        <>
          <h3 className="mt-4">{c.mapping}</h3>
          <p className="m-0 cell-sub">{c.mappingHint}</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 mt-2">
            {FIELD_KEYS.map(field)}
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.dateOrder}</span>
              <select
                aria-label={c.dateOrder}
                data-testid="generic-map-order"
                value={mapping.dateOrder}
                disabled={busy}
                onChange={(e) => patch({ dateOrder: e.target.value as "DMY" | "MDY" })}
              >
                <option value="DMY">{c.dmy}</option>
                <option value="MDY">{c.mdy}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                aria-label={c.invert}
                data-testid="generic-map-invert"
                checked={mapping.invertAmount}
                disabled={busy}
                onChange={(e) => patch({ invertAmount: e.target.checked })}
              />
              <span className="cell-sub">{c.invert}</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.account}</span>
              <select
                aria-label={c.account}
                data-testid="generic-import-account"
                value={accountKey}
                disabled={busy}
                onChange={(e) => setAccountKey(e.target.value)}
              >
                <option value="">{c.accountPlaceholder}</option>
                {accounts.map((account) => (
                  <option key={account.key} value={account.key}>
                    {account.name || account.key}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {plan != null && plan.warnings.length > 0 && (
            <div className="mt-3" data-testid="generic-import-cross-format">
              <StatusLine tone="warning" className="m-0">
                {c.crossFormat(plan.warnings[0]!.formats.map((f) => c.formatLabels[f]).join(", "))}
              </StatusLine>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={c.crossFormatOverride}
                  data-testid="generic-import-override"
                  checked={allowCrossFormat}
                  disabled={busy}
                  onChange={(e) => setAllowCrossFormat(e.target.checked)}
                />
                <span>{c.crossFormatOverride}</span>
              </label>
            </div>
          )}

          {plan != null && (
            <>
              <p className="m-0 mt-3" data-testid="generic-import-counts">
                {c.counts(
                  plan.rowsRead,
                  plan.newRows.length,
                  plan.duplicatesOnFile + plan.duplicatesInFile,
                  plan.rejected.length,
                )}
              </p>
              {plan.rejected.length > 0 && (
                <ul
                  className="m-0 mt-1 grid list-none gap-1 p-0 text-[0.85rem] text-muted"
                  data-testid="generic-import-rejected"
                >
                  {plan.rejected.slice(0, 8).map((row) => (
                    <li key={row.line}>{c.rejectedRow(row.line, c.reason[row.reason])}</li>
                  ))}
                </ul>
              )}
              <h4 className="mt-3 mb-1">{c.preview}</h4>
              {plan.newRows.length === 0 ? (
                <p className="m-0 text-muted" data-testid="generic-import-nothing-new">
                  {c.nothingNew}
                </p>
              ) : (
                <table className="w-full text-[0.85rem]" data-testid="generic-import-preview">
                  <tbody>
                    {plan.newRows.slice(0, 5).map((row) => (
                      <tr key={`${row.line}`}>
                        <td className="pr-2 whitespace-nowrap">{row.date}</td>
                        <td className="pr-2">{row.counterparty}</td>
                        <td className="pr-2 text-muted">{row.description}</td>
                        <td className="text-right tabular-nums">
                          {formatEuroIn(locale, row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  data-testid="generic-import-run"
                  disabled={
                    busy || plan.blocked != null || plan.newRows.length === 0 || bytes == null
                  }
                  onClick={() => {
                    if (bytes == null) return;
                    onImport({
                      plan,
                      mapping,
                      format,
                      filename: filename ?? "import",
                      bytes,
                      headers,
                      rows,
                    });
                  }}
                >
                  {busy ? c.importing : c.import}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {notice != null && (
        <p role="status" data-testid="generic-import-notice">
          {notice}
        </p>
      )}

      <h3 className="mt-4">{c.sessions}</h3>
      {sessions.length === 0 ? (
        <p className="m-0 text-muted">{c.sessionsEmpty}</p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0" data-testid="generic-import-sessions">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-1 last:border-b-0"
              data-testid={`generic-import-session-${session.id}`}
            >
              <span className="cell-sub">
                {c.sessionRow(session.filename, session.rowsImported, session.importedAt)}
              </span>
              <CardLink
                className="text-neg"
                data-testid={`generic-import-revert-${session.id}`}
                disabled={busy}
                onClick={() => onRevert(session.id)}
              >
                {c.revert}
              </CardLink>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
