import { useState } from "react";
import type { FormEvent } from "react";
import type { VaultStorage } from "@lavega/adapters";
import type { GateState } from "../vault-gate.js";
import { migrateToVault } from "../migrate.js";
import { parseBackup } from "../backup.js";

const RESTORE_ERROR = "Onjuist wachtwoord of ongeldig back-upbestand.";

const DATA_LOSS_WARNING = 'Wachtwoord kwijt = data kwijt — geen herstel. Er is geen "wachtwoord vergeten"-optie.';

type VaultGateProps = {
  gate: GateState;
  storage: VaultStorage;
  onReady: () => void;
  onBackup: () => void; // enter the app AND jump to the Back-up tab (post-migration nudge)
};

// Gates the app behind the encrypted vault: renders the matching screen for
// every non-"ready" GateState. App only mounts this while gate !== "ready".
export default function VaultGate({ gate, storage, onReady, onBackup }: VaultGateProps) {
  if (gate === "loading") {
    return (
      <div className="vault-gate">
        <p className="text-muted">Laden…</p>
      </div>
    );
  }
  if (gate === "unlock") return <UnlockScreen storage={storage} onReady={onReady} />;
  if (gate === "setup") return <SetupScreen storage={storage} onReady={onReady} />;
  if (gate === "migrate") return <MigrateScreen storage={storage} onReady={onReady} onBackup={onBackup} />;
  return null; // "ready" — App renders the app itself in this state
}

type ScreenProps = { storage: VaultStorage; onReady: () => void };

function UnlockScreen({ storage, onReady }: ScreenProps) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const ok = await storage.unlock(pass);
      if (!ok) {
        setError("Onjuist wachtwoord.");
        return;
      }
      onReady();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vault-gate">
      <form className="card vault-gate-card" onSubmit={submit}>
        <h2>Kluis ontgrendelen</h2>
        <div className="vault-field">
          <label htmlFor="unlock-pass">Wachtwoord</label>
          <input
            id="unlock-pass"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || pass.length === 0}>
          Ontgrendelen
        </button>
      </form>
    </div>
  );
}

function SetupScreen({ storage, onReady }: ScreenProps) {
  const [mode, setMode] = useState<"create" | "restore">("create");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mismatch = pass2.length > 0 && pass1 !== pass2;
  const canSubmit = pass1.length > 0 && pass1 === pass2 && understood && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await storage.setup(pass1);
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "restore") {
    return <RestoreOnSetupScreen storage={storage} onReady={onReady} onCancel={() => setMode("create")} />;
  }

  return (
    <div className="vault-gate">
      <form className="card vault-gate-card" onSubmit={submit}>
        <h2>Kluis instellen</h2>
        <p className="text-warn">{DATA_LOSS_WARNING}</p>
        <div className="vault-field">
          <label htmlFor="setup-pass1">Wachtwoord</label>
          <input
            id="setup-pass1"
            type="password"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
        <div className="vault-field">
          <label htmlFor="setup-pass2">Herhaal wachtwoord</label>
          <input
            id="setup-pass2"
            type="password"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            disabled={busy}
          />
        </div>
        {mismatch && <p className="text-warn">Wachtwoorden komen niet overeen.</p>}
        <label className="vault-checkbox-field">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            disabled={busy}
          />
          Ik begrijp dit
        </label>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          Kluis aanmaken
        </button>
        <p>
          Heb je al een back-up?{" "}
          <button type="button" className="btn" onClick={() => setMode("restore")} disabled={busy}>
            Herstel uit back-up
          </button>
        </p>
      </form>
    </div>
  );
}

type RestoreOnSetupScreenProps = ScreenProps & { onCancel: () => void };

// Fresh-machine recovery: no vault exists yet, so instead of creating a new
// (empty) one, adopt a downloaded .lavega back-up as THE vault.
function RestoreOnSetupScreen({ storage, onReady, onCancel }: RestoreOnSetupScreenProps) {
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = file != null && pass.length > 0 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setBusy(true);
    setError("");
    try {
      const text = await file.text();
      const blob = parseBackup(text); // throws on malformed/misshaped file
      const ok = await storage.restore(blob, pass);
      if (!ok) {
        setError(RESTORE_ERROR);
        return;
      }
      onReady();
    } catch {
      setError(RESTORE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vault-gate">
      <form className="card vault-gate-card" onSubmit={submit}>
        <h2>Herstel uit back-up</h2>
        <p>Kies je back-upbestand (.lavega) en vul het bijbehorende wachtwoord in.</p>
        <div className="vault-field">
          <label htmlFor="setup-restore-file">Back-upbestand</label>
          <input
            id="setup-restore-file"
            type="file"
            accept=".lavega"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="vault-field">
          <label htmlFor="setup-restore-pass">Wachtwoord</label>
          <input
            id="setup-restore-pass"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          Herstellen
        </button>
        <p>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Terug
          </button>
        </p>
      </form>
    </div>
  );
}

function MigrateScreen({ storage, onReady, onBackup }: ScreenProps & { onBackup: () => void }) {
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [migrated, setMigrated] = useState(false);

  const mismatch = pass2.length > 0 && pass1 !== pass2;
  const canSubmit = pass1.length > 0 && pass1 === pass2 && understood && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await migrateToVault(storage, pass1);
      setMigrated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (migrated) {
    return (
      <div className="vault-gate">
        <div className="card vault-gate-card">
          <h2>Migratie geslaagd</h2>
          <p>Je bestaande data is versleuteld opgeslagen in de kluis.</p>
          <p className="text-warn">
            Maak nu meteen een back-up. Bij een vergeten wachtwoord is je data zonder back-up
            onherstelbaar verloren.
          </p>
          <button type="button" className="btn btn-primary" onClick={onBackup}>
            Maak nu een back-up
          </button>{" "}
          <button type="button" className="btn" onClick={onReady}>
            Later, naar de app
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vault-gate">
      <form className="card vault-gate-card" onSubmit={submit}>
        <h2>Bestaande data versleutelen</h2>
        <p>Je bestaande data wordt versleuteld en verplaatst naar de kluis.</p>
        <p className="text-warn">{DATA_LOSS_WARNING}</p>
        <div className="vault-field">
          <label htmlFor="migrate-pass1">Wachtwoord</label>
          <input
            id="migrate-pass1"
            type="password"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
        <div className="vault-field">
          <label htmlFor="migrate-pass2">Herhaal wachtwoord</label>
          <input
            id="migrate-pass2"
            type="password"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            disabled={busy}
          />
        </div>
        {mismatch && <p className="text-warn">Wachtwoorden komen niet overeen.</p>}
        <label className="vault-checkbox-field">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            disabled={busy}
          />
          Ik begrijp dit
        </label>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {busy ? "Bezig met versleutelen…" : "Versleutelen & doorgaan"}
        </button>
      </form>
    </div>
  );
}
