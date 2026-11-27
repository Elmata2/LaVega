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

type PortableExportState =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "verified"; message: string }
  | { kind: "failed"; message: string };

/**
 * Draagbare export (WS6.1, #302): a readable, versioned ZIP of the open vault,
 * read back through the core reader before the screen reports success. The
 * encrypted `.lavega` download above stays what it is: a restore artifact, not
 * a portable one.
 */
function PortableExport({ storage, asOf }: { storage: VaultStorage; asOf: string }) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].backup.portable;
  const [state, setState] = useState<PortableExportState>({ kind: "idle" });
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleExport() {
    if (state.kind === "building" || inFlightRef.current) return;
    inFlightRef.current = true;
    setState({ kind: "building" });
    try {
      const built = await buildPortableExport(storage, asOf);
      if (!mountedRef.current) return;
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
        setState({
          kind: "verified",
          message: c.verified(rows, built.manifest.sections.length),
        });
      } else {
        setState({
          kind: "failed",
          message: c.verificationFailed(built.readback.problems.length),
        });
      }
    } catch {
      if (mountedRef.current) setState({ kind: "failed", message: c.error });
    } finally {
      inFlightRef.current = false;
    }
  }

  return (
    <>
      <h3>{c.title}</h3>
      <p>{c.description}</p>
      <Button
        variant="primary"
        data-testid="portable-export"
        disabled={state.kind === "building"}
        onClick={() => void handleExport()}
      >
        {state.kind === "building" ? c.building : c.button}
      </Button>
      {(state.kind === "verified" || state.kind === "failed") && (
        <p
          role={state.kind === "failed" ? "alert" : undefined}
          data-testid="portable-export-result"
        >
          {state.message}
        </p>
      )}
    </>
  );
}

const formatDateTime = (locale: Locale, iso: string) =>
  new Date(iso).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB");

type ResetPersonalPhase =
  | { kind: "idle"; returnFocus?: boolean }
  | { kind: "confirming" }
  | { kind: "running" }
  | { kind: "failed"; message: string };

/**
 * Reset the personal side only.
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
  const [phase, setPhase] = useState<ResetPersonalPhase>({ kind: "idle" });
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const introRef = useRef<HTMLParagraphElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (phase.kind === "confirming") confirmRef.current?.focus();
    else if (phase.kind === "failed") errorRef.current?.focus();
    else if (phase.kind === "idle" && phase.returnFocus) introRef.current?.focus();
  }, [phase]);

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
    if (runningRef.current || phase.kind === "running") return; // a double click must not start a second run
    runningRef.current = true;
    setPhase({ kind: "running" });
    try {
      await resetPersonalData({ locale, storage, owner });
      posthog.capture("personal_data_reset", { account });
      // The page is navigating to /app; keep the running state until it does.
    } catch (err) {
      runningRef.current = false;
      if (mountedRef.current) setPhase({ kind: "failed", message: describe(err) });
    }
  }

  const busy = phase.kind === "running";
  const showConfirm = phase.kind !== "idle";

  return (
    <>
      {!showConfirm && (
        <p ref={introRef} tabIndex={-1}>
          <Button data-testid="reset-personal" onClick={() => setPhase({ kind: "confirming" })}>
            {r.button}
          </Button>
        </p>
      )}
      {showConfirm && (
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
          <Button disabled={busy} onClick={() => setPhase({ kind: "idle", returnFocus: true })}>
            {r.cancelButton}
          </Button>
        </div>
      )}
      {phase.kind === "failed" && (
        <div ref={errorRef} tabIndex={-1} data-testid="reset-personal-error">
          <StatusLine tone="problem" role="alert">
            {phase.message}
          </StatusLine>
        </div>
      )}
    </>
  );
}

type UploadPhase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "conflict"; updatedAt: string | null }
  | { kind: "succeeded"; message: string }
  | { kind: "failed"; message: string };

type ErasePhase =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "erasing" }
  | { kind: "succeeded"; message: string }
  | { kind: "failed"; message: string };

type ServerSession =
  | { kind: "checking" }
  | { kind: "signed-out" }
  | {
      kind: "ready";
      updatedAt: string | null;
      serverBlob: CipherBlob | null;
      upload: UploadPhase;
      erase: ErasePhase;
    };

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
  const [session, setSession] = useState<ServerSession>({ kind: "checking" });
  const mountedRef = useRef(true);
  const uploadInFlightRef = useRef(false);
  const eraseInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    void fetchServerBackup()
      .then((result) => {
        if (!current) return;
        if (result === "signed-out") {
          setSession({ kind: "signed-out" });
          return;
        }
        setSession({
          kind: "ready",
          updatedAt: result.updatedAt,
          serverBlob: result.blob,
          upload: { kind: "idle" },
          erase: { kind: "idle" },
        });
      })
      .catch(() => {
        if (current) setSession({ kind: "signed-out" });
      });
    return () => {
      current = false;
    };
  }, []);

  async function upload(overwrite: boolean) {
    if (session.kind !== "ready" || uploadInFlightRef.current || eraseInFlightRef.current) return;
    const blob = storage.export();
    if (!blob) {
      setSession((prev) =>
        prev.kind === "ready"
          ? { ...prev, upload: { kind: "failed", message: c.server.errors.locked } }
          : prev,
      );
      return;
    }
    const baseUpdatedAt = session.updatedAt;
    uploadInFlightRef.current = true;
    setSession((prev) =>
      prev.kind === "ready" ? { ...prev, upload: { kind: "uploading" } } : prev,
    );
    try {
      const result = await uploadServerBackup(blob, baseUpdatedAt, overwrite);
      if (!mountedRef.current) return;
      if (result.status === "signed-out") {
        setSession({ kind: "signed-out" });
        return;
      }
      if (result.status === "conflict") {
        /* Niet stilletjes overschrijven: de andere kant is iemands echte
         * administratie. De datum erbij, zodat de keuze een keuze is. */
        setSession((prev) =>
          prev.kind === "ready"
            ? { ...prev, upload: { kind: "conflict", updatedAt: result.updatedAt } }
            : prev,
        );
        return;
      }
      setSession((prev) =>
        prev.kind === "ready"
          ? {
              ...prev,
              updatedAt: result.updatedAt,
              serverBlob: blob,
              upload: { kind: "succeeded", message: c.server.success },
            }
          : prev,
      );
      posthog.capture("server_backup_uploaded", { overwritten: overwrite });
    } catch {
      if (mountedRef.current) {
        setSession((prev) =>
          prev.kind === "ready"
            ? { ...prev, upload: { kind: "failed", message: c.server.errors.saveFailed } }
            : prev,
        );
      }
    } finally {
      uploadInFlightRef.current = false;
    }
  }

  async function eraseData() {
    if (session.kind !== "ready" || eraseInFlightRef.current || uploadInFlightRef.current) return;
    eraseInFlightRef.current = true;
    setSession((prev) => (prev.kind === "ready" ? { ...prev, erase: { kind: "erasing" } } : prev));
    try {
      const report = await eraseServerData(locale);
      if (!mountedRef.current) return;
      const touched = report.filter((entry) => entry.rows > 0);
      const rows = touched.reduce((sum, entry) => sum + entry.rows, 0);
      const successMessage = c.server.erase.success(rows, touched.length);
      posthog.capture("server_data_erased", {
        collections_erased: touched.length,
        rows_erased: rows,
      });
      try {
        const refreshed = await fetchServerBackup();
        if (!mountedRef.current) return;
        if (refreshed === "signed-out") {
          setSession({ kind: "signed-out" });
          return;
        }
        setSession({
          kind: "ready",
          updatedAt: refreshed.updatedAt,
          serverBlob: refreshed.blob,
          upload: { kind: "idle" },
          erase: { kind: "succeeded", message: successMessage },
        });
      } catch {
        if (mountedRef.current) setSession({ kind: "signed-out" });
      }
    } catch (err) {
      if (mountedRef.current) {
        setSession((prev) =>
          prev.kind === "ready"
            ? {
                ...prev,
                erase: {
                  kind: "failed",
                  message: err instanceof Error ? err.message : c.server.erase.errorGeneric,
                },
              }
            : prev,
        );
      }
    } finally {
      eraseInFlightRef.current = false;
    }
  }

  if (session.kind === "checking") {
    // Nothing to show yet except the reset, whose confirm waits for an account owner.
    return <ResetPersonal storage={storage} owner={owner} ready={owner.kind === "device"} />;
  }
  if (session.kind === "signed-out") {
    return (
      <>
        <h3>{c.server.title}</h3>
        <p>{c.server.signedOut}</p>
        <ResetPersonal storage={storage} owner={owner} ready />
      </>
    );
  }

  const { updatedAt, serverBlob, upload: uploadPhase, erase: erasePhase } = session;
  const uploading = uploadPhase.kind === "uploading";
  const erasing = erasePhase.kind === "erasing";
  const actionDisabled = uploading || erasing;
  const confirmErase = erasePhase.kind === "confirming" || erasePhase.kind === "erasing";

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
        disabled={actionDisabled || documentCount > 0}
        onClick={() => void upload(false)}
      >
        {uploading ? c.common.busy : c.server.backupNowButton}
      </Button>
      {uploadPhase.kind === "conflict" && (
        <>
          <StatusLine tone="problem" role="alert">
            {uploadPhase.updatedAt
              ? c.server.conflict.message(formatDateTime(locale, uploadPhase.updatedAt))
              : c.server.conflict.missing}
          </StatusLine>
          <Button disabled={actionDisabled} onClick={() => void upload(true)}>
            {c.server.conflict.overwriteButton}
          </Button>
        </>
      )}
      {uploadPhase.kind === "succeeded" && <p>{uploadPhase.message}</p>}
      {uploadPhase.kind === "failed" && (
        <StatusLine tone="problem" role="alert">
          {uploadPhase.message}
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
            disabled={actionDisabled}
            onClick={() =>
              setSession((prev) =>
                prev.kind === "ready" ? { ...prev, erase: { kind: "confirming" } } : prev,
              )
            }
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
          <Button disabled={actionDisabled} onClick={() => void eraseData()}>
            {erasing ? c.common.busy : c.server.erase.confirmButton}
          </Button>{" "}
          <Button
            disabled={actionDisabled}
            onClick={() =>
              setSession((prev) =>
                prev.kind === "ready" ? { ...prev, erase: { kind: "idle" } } : prev,
              )
            }
          >
            {c.server.erase.cancelButton}
          </Button>
        </>
      )}
      {erasePhase.kind === "succeeded" && <p>{erasePhase.message}</p>}
      {erasePhase.kind === "failed" && (
        <StatusLine tone="problem" role="alert">
          {erasePhase.message}
        </StatusLine>
      )}
    </>
  );
}

type RestorePanelState =
  | { kind: "closed"; restored: boolean }
  | { kind: "open"; status: "idle" | "restoring"; error: string | null };

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
  const [restorePanel, setRestorePanel] = useState<RestorePanelState>({
    kind: "closed",
    restored: false,
  });
  const mountedRef = useRef(true);
  const restoreInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const restoreOpen = restorePanel.kind === "open";
  const busy = restorePanel.kind === "open" && restorePanel.status === "restoring";
  const error = restorePanel.kind === "open" ? (restorePanel.error ?? "") : "";
  const restored = restorePanel.kind === "closed" && restorePanel.restored;

  function toggleRestorePanel() {
    if (busy || restoreInFlightRef.current) return;
    setFile(null);
    setPass("");
    setConfirmed(false);
    setRestorePanel((prev) =>
      prev.kind === "open"
        ? { kind: "closed", restored: false }
        : { kind: "open", status: "idle", error: null },
    );
  }

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
    if (!file || !confirmed || busy || restoreInFlightRef.current) return;
    restoreInFlightRef.current = true;
    setRestorePanel({ kind: "open", status: "restoring", error: null });
    try {
      const text = await file.text();
      const blob = parseBackup(text); // throws on malformed/misshaped file
      const ok = await storage.restore(blob, pass || undefined);
      if (!mountedRef.current) return;
      if (!ok) {
        setRestorePanel({ kind: "open", status: "idle", error: c.restore.error });
        return;
      }
      setPass("");
      setFile(null);
      setConfirmed(false);
      setRestorePanel({ kind: "closed", restored: true });
      onRestored();
      posthog.capture("backup_restored");
    } catch {
      if (mountedRef.current) {
        setRestorePanel({ kind: "open", status: "idle", error: c.restore.error });
      }
    } finally {
      restoreInFlightRef.current = false;
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
          disabled={busy}
          onClick={toggleRestorePanel}
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
