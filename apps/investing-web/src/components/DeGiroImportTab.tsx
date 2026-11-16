import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "./ui/button.js";
import { DASHBOARD_REFRESH_EVENT } from "../lib/syncSession.js";
import {
  commitDeGiroImport,
  hasRows,
  importStatusLine,
  periodLabel,
  portfolioSelected,
  previewDeGiroImport,
  profileLabel,
  readDeGiroImportStatus,
  rowSummary,
  todayIso,
  type DeGiroImportCommit,
  type DeGiroImportFileReport,
  type DeGiroImportPreview,
  type DeGiroImportStatus,
  type RowCounts,
} from "../lib/degiroImport.js";

const MAX_FILES = 3;

type ImportFlow =
  | { kind: "empty" }
  | { kind: "reading" }
  | { kind: "ready"; preview: DeGiroImportPreview }
  | { kind: "committing"; preview: DeGiroImportPreview }
  | { kind: "done"; result: DeGiroImportCommit }
  | { kind: "failed"; problems: string[]; preview: DeGiroImportPreview | null };

const STEPS = [
  "Open DeGiro web and go to Inbox → Rekeningoverzicht (Account statement). Export the widest date range DeGiro allows. This file matters most: it alone proves your cash history.",
  "In Inbox → Transacties (Transactions), export the same date range. This adds the execution venue and FX rate.",
  "Open Portefeuille → Exporteren → CSV (Portfolio → Export → CSV). This file holds no date, so enter the export date below.",
];

function countsSentence(totals: RowCounts): string {
  const parts: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  };
  add(totals.trades, "trade", "trades");
  add(totals.cashFlows, "cash flow", "cash flows");
  add(totals.dividends, "dividend", "dividends");
  add(totals.positions, "position", "positions");
  add(totals.cashBalances, "cash balance", "cash balances");
  if (parts.length === 0) return "no new rows";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function sameFile(left: File, right: File): boolean {
  return (
    left.name === right.name && left.size === right.size && left.lastModified === right.lastModified
  );
}

function FileCard({
  file,
  report,
  reading,
  busy,
  onRemove,
}: {
  file: File;
  report: DeGiroImportFileReport | undefined;
  reading: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="min-w-0 rounded-tile border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm font-semibold">{file.name}</p>
          {report === undefined ? (
            reading ? (
              <p className="mt-1 text-sm text-muted-foreground">Reading…</p>
            ) : null
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-pill bg-secondary px-2.5 py-1 text-xs font-semibold">
                  {profileLabel(report.profile)}
                </span>
                {report.profile !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {periodLabel(report.period)} · {rowSummary(report.rows)}
                  </span>
                )}
              </div>
              {report.problems.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-negative">
                  {report.problems.map((problem, index) => (
                    <li key={`${problem}-${index}`}>{problem}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Remove ${file.name}`}
          className="min-h-11 min-w-11 shrink-0"
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

export function DeGiroImportTab() {
  const [files, setFiles] = useState<File[]>([]);
  const [asOf, setAsOf] = useState(todayIso);
  /* Read by the preview effect without becoming its dependency: a date change
   * must not refetch a preview that already detected the files. */
  const asOfRef = useRef(asOf);
  const [flow, setFlow] = useState<ImportFlow>({ kind: "empty" });
  const [status, setStatus] = useState<DeGiroImportStatus | null>(null);
  const [pickerProblem, setPickerProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  /* Kept while a re-read runs: dropping a second file must not hide the date
   * the user already typed for a portfolio that was detected a moment ago. */
  const [portfolioDetected, setPortfolioDetected] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void readDeGiroImportStatus(controller.signal).then((result) => {
      if (current && result.ok) setStatus(result.data);
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (files.length === 0) return;
    const controller = new AbortController();
    let current = true;
    /* The preview reports rows and problems, which do not depend on the export
     * date. The date belongs to the commit, so a later change does not refetch
     * and does not clear the detected file types. */
    /* A cleared date field must not turn a portfolio preview into a 400. The
     * preview only needs a valid day to read the positions; the commit still
     * uses the field and stays disabled while it is empty. */
    const previewDay = asOfRef.current === "" ? todayIso() : asOfRef.current;
    void previewDeGiroImport(files, previewDay, controller.signal).then((result) => {
      if (!current) return;
      setFlow(
        result.ok
          ? { kind: "ready", preview: result.data }
          : { kind: "failed", problems: result.problems, preview: null },
      );
      if (result.ok) setPortfolioDetected(portfolioSelected(result.data.files));
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [files]);

  useEffect(() => {
    if (flow.kind === "done") successHeadingRef.current?.focus();
  }, [flow.kind]);

  /* The flow's file-derived state is set by the event that changes the files,
   * never by the effect: it starts one preview per file list and nothing else. */
  function startReading(next: File[]) {
    setFiles(next);
    if (next.length === 0) {
      setFlow({ kind: "empty" });
      setPortfolioDetected(false);
      return;
    }
    setFlow({ kind: "reading" });
  }

  function addFiles(incoming: readonly File[]) {
    const next = [...files];
    let ignored = false;
    for (const file of incoming) {
      if (next.some((existing) => sameFile(existing, file))) continue;
      if (next.length >= MAX_FILES) {
        ignored = true;
        continue;
      }
      next.push(file);
    }
    setPickerProblem(ignored ? "At most 3 files at once." : null);
    if (next.length !== files.length) startReading(next);
  }

  function removeFile(index: number) {
    startReading(files.filter((_file, position) => position !== index));
    setPickerProblem(null);
    /* The button that had focus is gone, so focus the picker the list belongs
     * to instead of dropping the keyboard user back to the document. */
    fileInputRef.current?.focus();
  }

  const committablePreview = flow.kind === "ready" || flow.kind === "failed" ? flow.preview : null;

  async function commit() {
    const preview = committablePreview;
    if (preview === null || !canCommit || flow.kind === "committing") return;
    setFlow({ kind: "committing", preview });
    const result = await commitDeGiroImport(files, asOf);
    if (result.ok && result.data.committed) {
      setFlow({ kind: "done", result: result.data });
      /* The commit response already proves what was imported. Show that line
       * before the follow-up read, so a failed read cannot hide it. */
      setStatus({
        mode: "status",
        importedAt: result.data.importedAt ?? null,
        files: result.data.files.map(({ filename, sha256 }) => ({ filename, sha256 })),
        coverage: result.data.coverage ?? null,
        positionsAsOf: null,
      });
      window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
      const next = await readDeGiroImportStatus();
      if (next.ok) setStatus(next.data);
      return;
    }
    const problems = result.ok
      ? result.data.problems.length > 0
        ? result.data.problems
        : ["The import was not committed."]
      : result.problems;
    setFlow({ kind: "failed", problems, preview });
  }

  const busy = flow.kind === "committing";
  const preview =
    flow.kind === "ready" || flow.kind === "committing"
      ? flow.preview
      : flow.kind === "failed"
        ? flow.preview
        : flow.kind === "done"
          ? { mode: "preview" as const, files: flow.result.files }
          : null;
  const reports = preview?.files ?? null;
  const canCommit =
    committablePreview !== null &&
    hasRows(committablePreview.files) &&
    (!portfolioSelected(committablePreview.files) || asOf !== "");
  const disabledReason =
    flow.kind === "ready" && !canCommit
      ? hasRows(flow.preview.files)
        ? "Choose the portfolio export date."
        : "Fix the file problems before importing."
      : null;
  const statusLine = status === null ? null : importStatusLine(status);

  return (
    <section className="space-y-6">
      <div>
        <h3 className="font-display text-3xl">Import DeGiro files</h3>
        {statusLine !== null && <p className="mt-2 text-sm text-muted-foreground">{statusLine}</p>}
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          DeGiro has no API. Export your own CSV files and import them here. LaVega parses them on
          your server and stores only the parsed rows.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <div className="rounded-card border border-border bg-card p-5 sm:p-6">
          <h4 className="text-lg font-semibold">Export from DeGiro</h4>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground">
            {STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
            The account statement is the primary import. Transactions and Portfolio add detail and
            are optional.
          </p>
        </div>

        <div className="space-y-5">
          <label
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (busy) return;
              addFiles([...event.dataTransfer.files]);
            }}
            className={`flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-card border border-dashed p-6 text-center transition-colors duration-150 ease-out focus-within:ring-2 focus-within:ring-ring motion-reduce:transition-none ${
              dragging ? "border-ring bg-secondary/60" : "border-border hover:border-ring/60"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".csv,text/csv"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            <span className="block font-semibold">Choose CSV files</span>
            <span className="block text-sm text-muted-foreground">or drop them here</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Account statement, transactions and portfolio. Up to 3 files, 4 MB total.
            </span>
          </label>

          {pickerProblem !== null && (
            <p role="alert" className="text-sm text-negative">
              {pickerProblem}
            </p>
          )}

          {files.length > 0 && (
            <ul className="space-y-3">
              {files.map((file, index) => (
                <FileCard
                  key={`${file.name}-${file.lastModified}-${index}`}
                  file={file}
                  report={reports?.[index]}
                  reading={flow.kind === "reading"}
                  busy={busy}
                  onRemove={() => removeFile(index)}
                />
              ))}
            </ul>
          )}

          {portfolioDetected && (
            <div className="rounded-card border border-border bg-card p-5 sm:p-6">
              <label className="block text-sm font-semibold">
                Portfolio export date
                <input
                  type="date"
                  required
                  value={asOf}
                  disabled={busy}
                  onChange={(event) => {
                    asOfRef.current = event.target.value;
                    setAsOf(event.target.value);
                  }}
                  className="mt-2 block w-full rounded-tile border border-input bg-background px-3 py-2.5 text-sm font-normal"
                />
                <span className="mt-2 block text-xs font-normal text-muted-foreground">
                  The portfolio export has no date column. LaVega dates its positions with this day.
                </span>
              </label>
            </div>
          )}

          {flow.kind === "failed" && (
            <div
              role="alert"
              className="rounded-tile border border-negative/20 bg-negative/5 px-4 py-3 text-sm"
            >
              <p className="font-semibold">
                {flow.preview === null ? "Preview failed" : "Import failed"}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {flow.problems.map((problem, index) => (
                  <li key={`${problem}-${index}`}>{problem}</li>
                ))}
              </ul>
            </div>
          )}

          {disabledReason !== null && (
            <p id="degiro-import-reason" className="text-sm text-muted-foreground">
              {disabledReason}
            </p>
          )}

          {flow.kind !== "done" && files.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                disabled={!canCommit}
                aria-describedby={disabledReason === null ? undefined : "degiro-import-reason"}
                onClick={() => void commit()}
              >
                {busy ? "Importing…" : "Confirm import"}
              </Button>
              {flow.kind === "failed" && flow.preview === null && files.length > 0 && (
                <Button type="button" variant="outline" onClick={() => startReading([...files])}>
                  Try again
                </Button>
              )}
              {files.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    startReading([]);
                    setPickerProblem(null);
                    fileInputRef.current?.focus();
                  }}
                >
                  Clear files
                </Button>
              )}
            </div>
          )}

          {flow.kind === "done" && (
            <div
              role="status"
              className="rounded-card border border-positive/30 bg-positive/5 p-5 sm:p-6"
            >
              <h3
                ref={successHeadingRef}
                tabIndex={-1}
                className="font-display text-3xl outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
              >
                Import complete.
              </h3>
              <p className="mt-2 text-sm leading-6 text-positive">
                Your DeGiro account now holds {countsSentence(flow.result.totals)}.
              </p>
              {flow.result.problems.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-foreground">
                  {flow.result.problems.map((problem, index) => (
                    <li key={`${problem}-${index}`}>{problem}</li>
                  ))}
                </ul>
              )}
              <Link
                to="/"
                className="mt-3 inline-block text-sm font-semibold text-accent underline-offset-2 hover:underline"
              >
                View overview
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
