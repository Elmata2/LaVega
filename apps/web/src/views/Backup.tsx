import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CipherBlob, VaultStorage } from "@lavega/adapters";
import { backupFilename, serializeBackup, parseBackup } from "../backup.js";
import { eraseServerData, fetchServerBackup, uploadServerBackup } from "../vaultSync.js";
import { adminCopy } from "../copy/admin.js";
import { useAppLocale } from "../appLocale.js";
import type { Locale } from "../locale.js";

type BackupProps = {
  storage: VaultStorage;
  asOf: string;
  // Called after a successful restore so App reloads accounts/txs/rules from
  // the (now swapped) vault state — restore() itself never touches React state.
  onRestored: () => void;
};

const formatDateTime = (locale: Locale, iso: string) =>
  new Date(iso).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB");

/**
 * Back-up naar de server. De kluis wordt hier versleuteld en gaat er versleuteld
 * heen: de server bewaart bytes die hij niet kan lezen. Dat is de reden dat dit
 * mag bestaan naast de download, en het is ook de reden dat een verloren
 * wachtwoord deze back-up net zo onbruikbaar maakt als die op schijf.
 */
function ServerBackup({ storage }: { storage: VaultStorage }) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].backup;
  const [state, setState] = useState<"checking" | "signed-out" | "ready">("checking");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [serverBlob, setServerBlob] = useState<CipherBlob | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
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
        setConflict(result.updatedAt);
        return;
      }
      setUpdatedAt(result.updatedAt);
      setServerBlob(blob);
      setMessage(c.server.success);
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
      const report = await eraseServerData();
      const touched = report.filter((entry) => entry.rows > 0);
      const rows = touched.reduce((sum, entry) => sum + entry.rows, 0);
      setEraseMessage(c.server.erase.success(rows, touched.length));
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

  if (state === "checking") return null;
  if (state === "signed-out") {
    return (
      <>
        <h3>{c.server.title}</h3>
        <p>{c.server.signedOut}</p>
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
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || erasing}
        onClick={() => void upload(false)}
      >
        {busy ? c.common.busy : c.server.backupNowButton}
      </button>
      {conflict && (
        <>
          <p role="alert" className="text-warn">
            {c.server.conflict.message(formatDateTime(locale, conflict))}
          </p>
          <button
            type="button"
            className="btn"
            disabled={busy || erasing}
            onClick={() => void upload(true)}
          >
            {c.server.conflict.overwriteButton}
          </button>
        </>
      )}
      {message && <p>{message}</p>}
      {error && (
        <p role="alert" className="text-warn">
          {error}
        </p>
      )}
      {serverBlob && (
        <p>
          {c.server.restoreFromServer.prompt}{" "}
          <button
            type="button"
            className="btn"
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
          </button>
        </p>
      )}
      {!confirmErase && (
        <p>
          <button
            type="button"
            className="btn"
            disabled={busy || erasing}
            onClick={() => {
              setConfirmErase(true);
              setEraseMessage("");
              setEraseError("");
            }}
          >
            {c.server.erase.button}
          </button>
        </p>
      )}
      {confirmErase && (
        <>
          <p role="alert" className="text-warn">
            {c.server.erase.warning}
          </p>
          <button
            type="button"
            className="btn"
            disabled={busy || erasing}
            onClick={() => void eraseData()}
          >
            {erasing ? c.common.busy : c.server.erase.confirmButton}
          </button>{" "}
          <button
            type="button"
            className="btn"
            disabled={busy || erasing}
            onClick={() => setConfirmErase(false)}
          >
            {c.server.erase.cancelButton}
          </button>
        </>
      )}
      {eraseMessage && <p>{eraseMessage}</p>}
      {eraseError && (
        <p role="alert" className="text-warn">
          {eraseError}
        </p>
      )}
    </>
  );
}

export default function Backup({ storage, asOf, onRestored }: BackupProps) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].backup;
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);

  function handleDownload() {
    const blob = storage.export();
    if (!blob) return; // locked/empty — nothing to download
    const url = URL.createObjectURL(
      new Blob([serializeBackup(blob)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFilename(asOf);
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRestore(e: FormEvent) {
    e.preventDefault();
    if (!file || pass.length === 0 || !confirmed) return;
    setBusy(true);
    setError("");
    setRestored(false);
    try {
      const text = await file.text();
      const blob = parseBackup(text); // throws on malformed/misshaped file
      const ok = await storage.restore(blob, pass);
      if (!ok) {
        setError(c.restore.error);
        return;
      }
      setRestored(true);
      setPass("");
      setFile(null);
      setConfirmed(false);
      onRestored();
    } catch {
      setError(c.restore.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label={c.ariaLabel}>
      <h2>{c.title}</h2>

      <h3>{c.download.title}</h3>
      <p>{c.download.description}</p>
      <button type="button" className="btn btn-primary" onClick={handleDownload}>
        {c.download.button}
      </button>

      <ServerBackup storage={storage} />

      <h3>{c.restore.title}</h3>
      <p className="text-warn">{c.restore.warning}</p>
      <form onSubmit={handleRestore}>
        <div className="vault-field">
          <label htmlFor="backup-restore-file">{c.restore.fileLabel}</label>
          <input
            id="backup-restore-file"
            type="file"
            accept=".lavega"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="vault-field">
          <label htmlFor="backup-restore-pass">{c.restore.passwordLabel}</label>
          <input
            id="backup-restore-pass"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            disabled={busy}
          />
        </div>
        <label className="vault-checkbox-field">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
          />
          {c.restore.confirmLabel}
        </label>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        {restored && <p>{c.restore.success}</p>}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !file || pass.length === 0 || !confirmed}
        >
          {c.restore.submitButton}
        </button>
      </form>
    </section>
  );
}
