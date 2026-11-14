import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CipherBlob, VaultStorage } from "@lavega/adapters";
import { backupFilename, buildPortableExport, serializeBackup, parseBackup } from "../backup.js";
import {
  eraseServerData,
  fetchServerBackup,
  PersonalResetError,
  resetPersonalData,
  uploadServerBackup,
} from "../vaultSync.js";
import { adminCopy } from "../copy/admin.js";
import { useAppLocale } from "../appLocale.js";
import type { Locale } from "../locale.js";
import type { VaultOwner } from "../vaultKey.js";
import posthog from "../posthog.js";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import { Field, CheckboxField } from "../components/ui/Field.js";
import StatusLine from "../components/ui/StatusLine.js";

type BackupProps = {
  storage: VaultStorage;
  asOf: string;
  /** How many documents the vault holds; used to refuse a server backup that
   *  cannot carry them, instead of silently dropping the files. */
  documentCount?: number;
  /** Whose vault is open. An account owner has a server copy; a device owner is local-only. */
  owner: VaultOwner;
  // Called after a successful restore so App reloads accounts/txs/rules from
  // the (now swapped) vault state — restore() itself never touches React state.
  onRestored: () => void;
};

/**
 * Draagbare export (WS6.1, #302): a readable, versioned ZIP of the open vault,
 * read back through the core reader before the screen reports success. The
 * encrypted `.lavega` download above stays what it is: a restore artifact, not
 * a portable one.
 */
function PortableExport({ storage, asOf }: { storage: VaultStorage; asOf: string }) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].backup.portable;
  const [state, setState] = useState<"idle" | "building" | "verified" | "failed">("idle");
  const [message, setMessage] = useState("");

  async function handleExport() {
    setState("building");
    setMessage("");
    try {
      const built = await buildPortableExport(storage, asOf);
      const url = URL.createObjectURL(
        new Blob([built.bytes.slice().buffer as ArrayBuffer], { type: "application/zip" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = built.filename;
      link.click();
      URL.revokeObjectURL(url);
      if (built.readback.ok) {
        const rows = Object.values(built.manifest.recordCounts).reduce(
          (sum, count) => sum + count,
          0,
        );
        setState("verified");
        setMessage(c.verified(rows, built.manifest.sections.length));
      } else {
        setState("failed");
        setMessage(c.verificationFailed(built.readback.problems.length));
      }
    } catch {
      setState("failed");
      setMessage(c.error);
    }
  }

  return (
    <>
      <h3>{c.title}</h3>
      <p>{c.description}</p>
      <Button
        variant="primary"
        data-testid="portable-export"
        disabled={state === "building"}
        onClick={handleExport}
      >
        {state === "building" ? c.building : c.button}
      </Button>
      {message !== "" && (
        <p role={state === "failed" ? "alert" : undefined} data-testid="portable-export-result">
          {message}
        </p>
      )}
    </>
  );
}

const formatDateTime = (locale: Locale, iso: string) =>
  new Date(iso).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB");

/**
 * Reset the personal side only (docs/superpowers/specs/2026-11-14-personal-data-reset-design.md).
 * Whether a server exists is decided by the owner, before any click: an account
 * owner always has one (so the server call must succeed first), a device owner
 * is a local-only install. On success the page reloads at /app.
 */
function ResetPersonal({
  storage,
  owner,
  ready,
}: {
  storage: VaultStorage;
  owner: VaultOwner;
  /** False while the account state is still being checked: confirm waits. */
  ready: boolean;
}) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].backup;
  const r = c.resetPersonal;
  const account = owner.kind === "account";
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const introRef = useRef<HTMLParagraphElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      introRef.current?.focus();
    }
  }, [confirming]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function describe(err: unknown): string {
    if (!(err instanceof PersonalResetError)) return r.errors.generic;
    const prefix = account ? r.serverCleared : "";
    switch (err.code) {
      case "network":
        return r.errors.network;
      case "unauthorized":
        return r.errors.unauthorized;
      case "owner-changed":
        return r.errors.ownerChanged;
      case "local-blocked":
        return prefix + r.errors.localBlocked;
      case "local-failed":
        return prefix + r.errors.localFailed;
      default:
        return err.message || r.errors.generic;
    }
  }

  async function reset() {
    if (running.current) return; // a double click must not start a second run
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await resetPersonalData({ locale, storage, owner });
      posthog.capture("personal_data_reset", { account });
      // The page is navigating to /app; keep the busy state until it does.
    } catch (err) {
      setError(describe(err));
      setBusy(false);
      running.current = false;
    }
  }

  return (
    <>
      {!confirming && (
        <p ref={introRef} tabIndex={-1}>
          <Button
            data-testid="reset-personal"
            onClick={() => {
              setConfirming(true);
              setError("");
            }}
          >
            {r.button}
          </Button>
        </p>
      )}
      {confirming && (
        <div data-testid="reset-personal-confirm" ref={confirmRef} tabIndex={-1}>
          <StatusLine tone="warning" role="alert">
            {r.closeTabs} {account ? r.goes : r.goesLocalOnly}{" "}
            {account ? r.stays : r.staysLocalOnly} {r.cannotUndo} {r.otherDevices}
            {account ? ` ${r.bankConsent}` : ""}
          </StatusLine>
          {!ready && <p role="status">{r.checking}</p>}
          <Button disabled={busy || !ready} onClick={() => void reset()}>
            {busy ? c.common.busy : r.confirmButton}
          </Button>{" "}
          <Button
            disabled={busy}
            onClick={() => {
              cancelled.current = true;
              setError("");
              setConfirming(false);
            }}
          >
            {r.cancelButton}
          </Button>
        </div>
      )}
      {error && (
        <div ref={errorRef} tabIndex={-1} data-testid="reset-personal-error">
          <StatusLine tone="problem" role="alert">
            {error}
          </StatusLine>
        </div>
      )}
    </>
  );
}

/**
 * Back-up naar de server. De kluis wordt hier versleuteld en gaat er versleuteld
 * heen: de server bewaart bytes die hij niet kan lezen. Dat is de reden dat dit
 * mag bestaan naast de download, en het is ook de reden dat een verloren
 * wachtwoord deze back-up net zo onbruikbaar maakt als die op schijf.
 */
function ServerBackup({
  storage,
  owner,
  documentCount = 0,
}: {
  storage: VaultStorage;
  owner: VaultOwner;
  documentCount?: number;
}) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].backup;
  const [state, setState] = useState<"checking" | "signed-out" | "ready">("checking");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [serverBlob, setServerBlob] = useState<CipherBlob | null>(null);
  const [conflict, setConflict] = useState<{ updatedAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmErase, setConfirmErase] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseMessage, setEraseMessage] = useState("");
  const [eraseError, setEraseError] = useState("");

  function applyStatus(result: Awaited<ReturnType<typeof fetchServerBackup>>) {
    if (result === "signed-out") return setState("signed-out");
    setState("ready");
    setUpdatedAt(result.updatedAt);
    setServerBlob(result.blob);
  }

  useEffect(() => {
    let current = true;
    void fetchServerBackup()
      .then((result) => {
        if (current) applyStatus(result);
      })
      .catch(() => {
        if (current) setState("signed-out");
      });
    return () => {
      current = false;
    };
  }, []);

  async function upload(overwrite: boolean) {
    const blob = storage.export();
    if (!blob) return setError(c.server.errors.locked);
    setBusy(true);
    setError("");
    setMessage("");
    setConflict(null);
    try {
      const result = await uploadServerBackup(blob, updatedAt, overwrite);
      if (result.status === "signed-out") return setState("signed-out");
      if (result.status === "conflict") {
        /* Niet stilletjes overschrijven: de andere kant is iemands echte
         * administratie. De datum erbij, zodat de keuze een keuze is. */
        setConflict({ updatedAt: result.updatedAt });
        return;
      }
      setUpdatedAt(result.updatedAt);
      setServerBlob(blob);
      setMessage(c.server.success);
      posthog.capture("server_backup_uploaded", { overwritten: overwrite });
    } catch {
      setError(c.server.errors.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  async function eraseData() {
    setErasing(true);
    setEraseError("");
    setEraseMessage("");
    try {
      const report = await eraseServerData(locale);
      const touched = report.filter((entry) => entry.rows > 0);
      const rows = touched.reduce((sum, entry) => sum + entry.rows, 0);
      setEraseMessage(c.server.erase.success(rows, touched.length));
      posthog.capture("server_data_erased", {
        collections_erased: touched.length,
        rows_erased: rows,
      });
      await fetchServerBackup()
        .then(applyStatus)
        .catch(() => setState("signed-out"));
    } catch (err) {
      setEraseError(err instanceof Error ? err.message : c.server.erase.errorGeneric);
    } finally {
      setErasing(false);
      setConfirmErase(false);
    }
  }

  if (state === "checking") {
    // Nothing to show yet except the reset, whose confirm waits for an account owner.
    return <ResetPersonal storage={storage} owner={owner} ready={owner.kind === "device"} />;
  }
  if (state === "signed-out") {
    return (
      <>
        <h3>{c.server.title}</h3>
        <p>{c.server.signedOut}</p>
        <ResetPersonal storage={storage} owner={owner} ready />
      </>
    );
  }

  return (
    <>
      <h3>{c.server.title}</h3>
      <p>
        {updatedAt ? c.server.lastBackup(formatDateTime(locale, updatedAt)) : c.server.noBackupYet}{" "}
        {c.server.encryptionNote}
      </p>
      {documentCount > 0 && (
        <p role="status" data-testid="server-backup-documents-blocked">
          {c.server.documentsBlocked(documentCount)}
        </p>
      )}
      <Button
        variant="primary"
        disabled={busy || erasing || documentCount > 0}
        onClick={() => void upload(false)}
      >
        {busy ? c.common.busy : c.server.backupNowButton}
      </Button>
      {conflict && (
        <>
          <StatusLine tone="problem" role="alert">
            {conflict.updatedAt
              ? c.server.conflict.message(formatDateTime(locale, conflict.updatedAt))
              : c.server.conflict.missing}
          </StatusLine>
          <Button disabled={busy || erasing} onClick={() => void upload(true)}>
            {c.server.conflict.overwriteButton}
          </Button>
        </>
      )}
      {message && <p>{message}</p>}
      {error && (
        <StatusLine tone="problem" role="alert">
          {error}
        </StatusLine>
      )}
      {serverBlob && (
        <p>
          {c.server.restoreFromServer.prompt}{" "}
          <Button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([serializeBackup(serverBlob)], { type: "application/json" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = backupFilename((updatedAt ?? "").slice(0, 10));
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            {c.server.restoreFromServer.button}
          </Button>
        </p>
      )}
      <ResetPersonal storage={storage} owner={owner} ready />
      {!confirmErase && (
        <p>
          <Button
            disabled={busy || erasing}
            onClick={() => {
              setConfirmErase(true);
              setEraseMessage("");
              setEraseError("");
            }}
          >
            {c.server.erase.button}
          </Button>
        </p>
      )}
      {confirmErase && (
        <>
          <StatusLine tone="warning" role="alert">
            {c.server.erase.warning}
          </StatusLine>
          <Button disabled={busy || erasing} onClick={() => void eraseData()}>
            {erasing ? c.common.busy : c.server.erase.confirmButton}
          </Button>{" "}
          <Button disabled={busy || erasing} onClick={() => setConfirmErase(false)}>
            {c.server.erase.cancelButton}
          </Button>
        </>
      )}
      {eraseMessage && <p>{eraseMessage}</p>}
      {eraseError && (
        <StatusLine tone="problem" role="alert">
          {eraseError}
        </StatusLine>
      )}
    </>
  );
}

export default function Backup({
  storage,
  asOf,
  documentCount = 0,
  owner,
  onRestored,
}: BackupProps) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].backup;
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  async function handleDownload() {
    // The FULL bundle (v3): the vault AND the sealed document bytes. A download
    // that dropped documents would be worse than no download at all.
    const blob = await storage.exportBundle();
    if (!blob) return; // locked/empty — nothing to download
    const url = URL.createObjectURL(
      new Blob([serializeBackup(blob)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFilename(asOf);
    a.click();
    URL.revokeObjectURL(url);
    posthog.capture("backup_downloaded", { documents: documentCount });
  }

  async function handleRestore(e: FormEvent) {
    e.preventDefault();
    if (!file || !confirmed) return;
    setBusy(true);
    setError("");
    setRestored(false);
    try {
      const text = await file.text();
      const blob = parseBackup(text); // throws on malformed/misshaped file
      const ok = await storage.restore(blob, pass || undefined);
      if (!ok) {
        setError(c.restore.error);
        return;
      }
      setRestored(true);
      setRestoreOpen(false);
      setPass("");
      setFile(null);
      setConfirmed(false);
      onRestored();
      posthog.capture("backup_restored");
    } catch {
      setError(c.restore.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" aria-label={c.ariaLabel}>
      <h2>{c.title}</h2>
      <p>{c.download.description}</p>
      <div className="flex flex-wrap gap-2" data-testid="backup-primary">
        <Button variant="primary" onClick={handleDownload}>
          {c.simple.makeButton}
        </Button>
        <Button
          aria-expanded={restoreOpen}
          aria-controls="backup-restore-form"
          onClick={() => setRestoreOpen((open) => !open)}
        >
          {c.simple.restoreButton}
        </Button>
      </div>

      {restoreOpen && (
        <form id="backup-restore-form" onSubmit={handleRestore}>
          <h3>{c.restore.title}</h3>
          <StatusLine tone="warning">{c.restore.warning}</StatusLine>
          <Field>
            <label htmlFor="backup-restore-file">{c.restore.fileLabel}</label>
            <input
              id="backup-restore-file"
              type="file"
              accept=".lavega"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field>
            <label htmlFor="backup-restore-pass">{c.restore.passwordLabel}</label>
            <input
              id="backup-restore-pass"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              disabled={busy}
            />
          </Field>
          <CheckboxField>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy}
            />
            {c.restore.confirmLabel}
          </CheckboxField>
          {error && (
            <StatusLine tone="problem" role="alert">
              {error}
            </StatusLine>
          )}
          <Button type="submit" variant="primary" disabled={busy || !file || !confirmed}>
            {c.restore.submitButton}
          </Button>
        </form>
      )}
      {restored && <p>{c.restore.success}</p>}

      <details className="mt-4" data-testid="backup-more">
        <summary className="cursor-pointer">{c.simple.moreOptions}</summary>
        <PortableExport storage={storage} asOf={asOf} />
        <ServerBackup storage={storage} owner={owner} documentCount={documentCount} />
      </details>
    </Card>
  );
}
