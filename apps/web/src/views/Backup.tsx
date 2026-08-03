import { useState } from "react";
import type { FormEvent } from "react";
import type { VaultStorage } from "@lavega/adapters";
import { backupFilename, serializeBackup, parseBackup } from "../backup.js";

type BackupProps = {
  storage: VaultStorage;
  asOf: string;
  // Called after a successful restore so App reloads accounts/txs/rules from
  // the (now swapped) vault state — restore() itself never touches React state.
  onRestored: () => void;
};

const RESTORE_ERROR = "Onjuist wachtwoord of ongeldig back-upbestand.";

export default function Backup({ storage, asOf, onRestored }: BackupProps) {
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);

  function handleDownload() {
    const blob = storage.export();
    if (!blob) return; // locked/empty — nothing to download
    const url = URL.createObjectURL(new Blob([serializeBackup(blob)], { type: "application/json" }));
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
        setError(RESTORE_ERROR);
        return;
      }
      setRestored(true);
      setPass("");
      setFile(null);
      setConfirmed(false);
      onRestored();
    } catch {
      setError(RESTORE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Back-up">
      <h2>Back-up</h2>

      <h3>Download</h3>
      <p>
        Download een versleutelde back-up. Bewaar &apos;m veilig; je hebt je wachtwoord nodig om &apos;m te
        herstellen.
      </p>
      <button type="button" className="btn btn-primary" onClick={handleDownload}>
        Download back-up
      </button>

      <h3>Herstel uit back-up</h3>
      <p className="text-warn">Dit vervangt je huidige data in deze kluis.</p>
      <form onSubmit={handleRestore}>
        <div className="vault-field">
          <label htmlFor="backup-restore-file">Back-upbestand</label>
          <input
            id="backup-restore-file"
            type="file"
            accept=".lavega"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="vault-field">
          <label htmlFor="backup-restore-pass">Wachtwoord</label>
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
          Ik snap dat dit mijn huidige data in deze kluis vervangt
        </label>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        {restored && <p>Herstel geslaagd.</p>}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !file || pass.length === 0 || !confirmed}
        >
          Herstellen
        </button>
      </form>
    </section>
  );
}
