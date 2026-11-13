import { useMemo, useState } from "react";
import StatusLine from "../ui/StatusLine.js";
import type { Account, Tx, UploadProblem, Valuation, VaultDocument } from "@lavega/core";
import {
  DOCUMENT_MAX_BYTES,
  checkDocumentUpload,
  documentCoversMonth,
  reconcileStatement,
  statementReviewQueue,
} from "@lavega/core";
import { useAppLocale } from "../../appLocale.js";
import { documentsCopy } from "../../copy/documents.js";
import { formatEuroIn } from "../../format.js";
import Button from "../ui/Button.js";
import Card from "../ui/Card.js";
import CardLink from "../ui/CardLink.js";

/** What the last upload did, so the card can say WHY a file was refused or was
 *  already there instead of leaving the owner guessing. */
export type DocumentNotice =
  | { kind: "stored"; filename: string }
  | { kind: "duplicate"; filename: string }
  | { kind: "refused"; filename: string; problem: UploadProblem };

export type DocumentsCardProps = {
  documents: VaultDocument[];
  accounts: Account[];
  txs: Tx[];
  valuations?: readonly Valuation[];
  asOf: string;
  busy: boolean;
  notice: DocumentNotice | null;
  /** How many documents the last erase removed, for one honest line. */
  erased?: number | null;
  onUpload: (file: File) => void;
  onLink: (id: string, accountKey: string) => void;
  onReject: (id: string) => void;
  onRemove: (id: string) => void;
  onEraseAll: () => void;
};

/** Documents (WS3.4) and their statement pipeline (WS3.5): upload gate, review
 *  queue with the refusal reasons, and a reconciliation line that only says
 *  "checked" when checks actually matched. */
export default function DocumentsCard({
  documents,
  accounts,
  txs,
  valuations,
  asOf,
  busy,
  notice,
  erased = null,
  onUpload,
  onLink,
  onReject,
  onRemove,
  onEraseAll,
}: DocumentsCardProps) {
  const [locale] = useAppLocale();
  const c = documentsCopy[locale];
  const [confirmErase, setConfirmErase] = useState(false);
  const [linkTarget, setLinkTarget] = useState<Record<string, string>>({});
  const accountByKey = useMemo(
    () => new Map(accounts.map((account) => [account.key, account])),
    [accounts],
  );
  const queue = useMemo(() => statementReviewQueue({ documents, accounts }), [documents, accounts]);
  const months = Math.round(DOCUMENT_MAX_BYTES / (1024 * 1024));

  const reconciliationOf = (doc: VaultDocument) =>
    doc.accountKey == null ? null : reconcileStatement({ doc, accounts, txs, valuations, asOf });

  const noticeText =
    notice == null
      ? null
      : notice.kind === "stored"
        ? c.stored
        : notice.kind === "duplicate"
          ? c.duplicate
          : c.refused[notice.problem];

  return (
    <Card as="section" aria-label={c.title} data-testid="documents-card">
      <h2>{c.title}</h2>
      <p className="m-0 text-muted">{c.intro}</p>
      <div className="import-controls">
        <input
          type="file"
          accept=".pdf,.csv,.xlsx"
          aria-label={c.uploadAria}
          data-testid="documents-upload"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onUpload(file);
          }}
        />
        <span className="cell-sub">{c.cap(months)}</span>
      </div>
      {erased != null && (
        <p role="status" data-testid="documents-erased">
          {c.erased(erased)}
        </p>
      )}
      {noticeText != null &&
        (notice?.kind === "refused" ? (
          <StatusLine tone="warning" role="alert" data-testid="documents-notice">
            {noticeText}
          </StatusLine>
        ) : (
          <p role="status" data-testid="documents-notice">
            {noticeText}
          </p>
        ))}

      <h3 className="mt-4">{c.review}</h3>
      {queue.length === 0 ? (
        <p className="m-0 text-muted">{c.reviewEmpty}</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0" data-testid="documents-review">
          {queue.map((item) => {
            const doc = item.document;
            const suggestion =
              item.suggestion.status === "matched"
                ? (accountByKey.get(item.suggestion.accountKey)?.name ?? item.suggestion.accountKey)
                : null;
            const tied =
              item.suggestion.status === "ambiguous"
                ? item.suggestion.tiedKeys
                    .map((key) => accountByKey.get(key)?.name ?? key)
                    .join(", ")
                : null;
            const confidence =
              item.suggestion.status === "none" ? null : item.suggestion.confidence;
            return (
              <li
                key={doc.id}
                className="border border-line rounded-sm p-3"
                data-testid={`documents-review-${doc.id}`}
              >
                <p className="m-0 font-medium">{doc.filename}</p>
                <p className="m-0 cell-sub" data-testid={`documents-reason-${doc.id}`}>
                  {c.reason[item.reason]}
                </p>
                <p className="m-0 cell-sub">
                  {doc.periodFrom != null && doc.periodTo != null
                    ? c.period(doc.periodFrom, doc.periodTo)
                    : c.noPeriod}
                  {" · "}
                  {suggestion != null
                    ? c.suggested(suggestion, `${Math.round((confidence ?? 0) * 100)}%`)
                    : tied != null
                      ? c.tied(tied)
                      : c.noSuggestion}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <select
                    aria-label={c.linkTo}
                    data-testid={`documents-link-select-${doc.id}`}
                    value={linkTarget[doc.id] ?? ""}
                    onChange={(e) =>
                      setLinkTarget((current) => ({ ...current, [doc.id]: e.target.value }))
                    }
                  >
                    <option value="">{c.linkTo}</option>
                    {accounts.map((account) => (
                      <option key={account.key} value={account.key}>
                        {account.name || account.key}
                      </option>
                    ))}
                  </select>
                  <Button
                    data-testid={`documents-link-${doc.id}`}
                    disabled={busy || (linkTarget[doc.id] ?? "") === ""}
                    onClick={() => {
                      const key = linkTarget[doc.id];
                      if (key) onLink(doc.id, key);
                    }}
                  >
                    {c.link}
                  </Button>
                  {suggestion != null && (
                    <Button
                      data-testid={`documents-reject-${doc.id}`}
                      disabled={busy}
                      onClick={() => onReject(doc.id)}
                    >
                      {c.reject}
                    </Button>
                  )}
                  <CardLink
                    className="text-neg"
                    data-testid={`documents-remove-${doc.id}`}
                    disabled={busy}
                    onClick={() => onRemove(doc.id)}
                  >
                    {c.remove}
                  </CardLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="mt-4">{c.title}</h3>
      {documents.length === 0 ? (
        <p className="m-0 text-muted" data-testid="documents-empty">
          {c.empty}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0" data-testid="documents-list">
          {documents.map((doc) => {
            const reconciliation = reconciliationOf(doc);
            const difference = reconciliation?.checks.find((check) => !check.matched);
            return (
              <li
                key={doc.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-1 last:border-b-0"
                data-testid={`documents-row-${doc.id}`}
              >
                <span className="flex flex-col">
                  <span>{doc.filename}</span>
                  <span className="cell-sub">
                    {doc.periodFrom != null && doc.periodTo != null
                      ? c.period(doc.periodFrom, doc.periodTo)
                      : c.noPeriod}
                    {" · "}
                    {doc.accountKey != null
                      ? c.linked(accountByKey.get(doc.accountKey)?.name ?? doc.accountKey)
                      : c.reason.unmatched}
                    {" · "}
                    {Math.round(doc.byteSize / 1024)} kB
                  </span>
                </span>
                <span className="cell-sub" data-testid={`documents-reconciliation-${doc.id}`}>
                  {reconciliation == null
                    ? ""
                    : reconciliation.status === "matched"
                      ? c.reconciliation.verified
                      : reconciliation.status === "mismatched"
                        ? c.reconciliation.mismatched(
                            formatEuroIn(locale, Math.abs(difference?.differenceCents ?? 0) / 100),
                          )
                        : `${c.reconciliation.unavailable}${
                            reconciliation.reason == null
                              ? ""
                              : ` (${c.reconciliation.reason[reconciliation.reason]})`
                          }`}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {documents.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {confirmErase ? (
            <>
              <StatusLine tone="warning" as="span">
                {c.eraseAllConfirm}
              </StatusLine>
              <Button
                variant="primary"
                data-testid="documents-erase-confirm"
                disabled={busy}
                onClick={() => {
                  setConfirmErase(false);
                  onEraseAll();
                }}
              >
                {c.eraseAll}
              </Button>
              <Button data-testid="documents-erase-cancel" onClick={() => setConfirmErase(false)}>
                {c.eraseAllCancel}
              </Button>
            </>
          ) : (
            <CardLink
              className="text-neg"
              data-testid="documents-erase"
              onClick={() => setConfirmErase(true)}
            >
              {c.eraseAll}
            </CardLink>
          )}
        </div>
      )}
    </Card>
  );
}

/** Kept beside the card so the App handler and the copy stay in one shape. */
export function documentQueueReasonFor(
  documents: readonly VaultDocument[],
  accounts: readonly Account[],
  id: string,
): string | null {
  const item = statementReviewQueue({ documents, accounts }).find(
    (entry) => entry.document.id === id,
  );
  return item?.reason ?? null;
}

/** Exported for the app walk/test: does a document cover a given month? */
export { documentCoversMonth, checkDocumentUpload };
