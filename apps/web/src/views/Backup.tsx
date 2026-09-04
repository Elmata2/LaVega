import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CipherBlob, VaultStorage } from "@lavega/adapters";
import { backupFilename, serializeBackup, parseBackup } from "../backup.js";
import { fetchServerBackup, uploadServerBackup } from "../vaultSync.js";

type BackupProps = {
  storage: VaultStorage;
  asOf: string;
  // Called after a successful restore so App reloads accounts/txs/rules from
  // the (now swapped) vault state — restore() itself never touches React state.
  onRestored: () => void;
};

const RESTORE_ERROR = "Onjuist wachtwoord of ongeldig back-upbestand.";

const dutchDate = (iso: string) => new Date(iso).toLocaleString("nl-NL");

/**
 * Back-up naar de server. De kluis wordt hier versleuteld en gaat er versleuteld
 * heen: de server bewaart bytes die hij niet kan lezen. Dat is de reden dat dit
 * mag bestaan naast de download, en het is ook de reden dat een verloren
 * wachtwoord deze back-up net zo onbruikbaar maakt als die op schijf.
 */
function ServerBackup({ storage }: { storage: VaultStorage }) {
  const [state, setState] = useState<"checking" | "signed-out" | "ready">("checking");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [serverBlob, setServerBlob] = useState<CipherBlob | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    void fetchServerBackup()
      .then((result) => {
        if (!current) return;
        if (result === "signed-out") return setState("signed-out");
        setState("ready");
        setUpdatedAt(result.updatedAt);
        setServerBlob(result.blob);
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
    if (!blob) return setError("Ontgrendel de kluis voordat je een back-up maakt.");
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
      setMessage("Back-up opgeslagen.");
    } catch {
      setError("Back-up opslaan mislukt.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") return null;
  if (state === "signed-out") {
    return (
      <>
        <h3>Back-up op de server</h3>
        <p>
          Log in om je versleutelde kluis ook op de server te bewaren. Handig voor een tweede
          apparaat.
        </p>
      </>
    );
  }

  return (
    <>
      <h3>Back-up op de server</h3>
      <p>
        {updatedAt ? `Laatste back-up: ${dutchDate(updatedAt)}.` : "Nog geen back-up op de server."}{" "}
        De server bewaart alleen versleutelde bytes en kan je gegevens niet lezen.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={() => void upload(false)}
      >
        {busy ? "Bezig…" : "Nu back-uppen"}
      </button>
      {conflict && (
        <>
          <p role="alert" className="text-warn">
            Een ander apparaat heeft op {dutchDate(conflict)} een nieuwere back-up opgeslagen.
            Overschrijven verwijdert die.
          </p>
          <button type="button" className="btn" disabled={busy} onClick={() => void upload(true)}>
            Toch overschrijven
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
          Herstellen van de server? Download &apos;m eerst en gebruik het formulier hieronder.{" "}
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
            Haal back-up van server
          </button>
        </p>
      )}
    </>
  );
}

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
        Download een versleutelde back-up. Bewaar &apos;m veilig; je hebt je wachtwoord nodig om
        &apos;m te herstellen.
      </p>
      <button type="button" className="btn btn-primary" onClick={handleDownload}>
        Download back-up
      </button>

      <ServerBackup storage={storage} />

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
