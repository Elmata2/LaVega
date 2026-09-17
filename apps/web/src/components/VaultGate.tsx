import { useState } from "react";
import type { FormEvent } from "react";
import type { VaultStorage } from "@lavega/adapters";
import type { GateState } from "../vault-gate.js";
import { migrateToVault } from "../migrate.js";
import { parseBackup } from "../backup.js";
import { vaultPasswordProblem, MIN_VAULT_PASSWORD, type VaultPasswordProblem } from "../vaultPassword.js";
import { useAppLocale } from "../appLocale.js";
import { shellCopy, type ShellCopy } from "../copy/shell.js";
import Button from "./ui/Button.js";
import Card from "./ui/Card.js";
import { Field, CheckboxField } from "./ui/Field.js";

function weakPasswordMessage(c: ShellCopy, kind: VaultPasswordProblem | null): string | null {
  if (kind === "tooShort") return c.vaultGate.passwordProblem.tooShort(MIN_VAULT_PASSWORD);
  if (kind === "lowVariation") return c.vaultGate.passwordProblem.lowVariation;
  return null;
}

type VaultGateProps = {
  gate: GateState;
  storage: VaultStorage;
  onReady: () => void;
  onBackup: () => void; // enter the app AND jump to the Back-up tab (post-migration nudge)
};

// Gates the app behind the encrypted vault: renders the matching screen for
// every non-"ready" GateState. App only mounts this while gate !== "ready".
export default function VaultGate({ gate, storage, onReady, onBackup }: VaultGateProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  if (gate === "loading") {
    return (
      <div className="vault-gate">
        <p className="text-muted">{c.vaultGate.loading}</p>
      </div>
    );
  }
  if (gate === "unlock") return <UnlockScreen storage={storage} onReady={onReady} />;
  if (gate === "setup") return <SetupScreen storage={storage} onReady={onReady} />;
  if (gate === "migrate")
    return <MigrateScreen storage={storage} onReady={onReady} onBackup={onBackup} />;
  return null; // "ready" — App renders the app itself in this state
}

type ScreenProps = { storage: VaultStorage; onReady: () => void };

function UnlockScreen({ storage, onReady }: ScreenProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
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
        setError(c.vaultGate.unlock.wrongPassword);
        return;
      }
      onReady();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vault-gate">
      <Card as="form" className="vault-gate-card" onSubmit={submit}>
        <h2>{c.vaultGate.unlock.title}</h2>
        <Field>
          <label htmlFor="unlock-pass">{c.vaultGate.passwordLabel}</label>
          <input
            id="unlock-pass"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </Field>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy || pass.length === 0}>
          {c.vaultGate.unlock.submit}
        </Button>
      </Card>
    </div>
  );
}

function SetupScreen({ storage, onReady }: ScreenProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const [mode, setMode] = useState<"create" | "restore">("create");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mismatch = pass2.length > 0 && pass1 !== pass2;
  // Only judge once something has been typed, so the screen does not open by
  // scolding an empty field.
  const weak = pass1.length > 0 ? weakPasswordMessage(c, vaultPasswordProblem(pass1)) : null;
  const canSubmit = weak === null && pass1.length > 0 && pass1 === pass2 && understood && !busy;

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
    return (
      <RestoreOnSetupScreen
        storage={storage}
        onReady={onReady}
        onCancel={() => setMode("create")}
      />
    );
  }

  return (
    <div className="vault-gate">
      <Card as="form" className="vault-gate-card" onSubmit={submit}>
        <h2>{c.vaultGate.setup.title}</h2>
        <p className="text-warn">{c.vaultGate.dataLossWarning}</p>
        <Field>
          <label htmlFor="setup-pass1">{c.vaultGate.passwordLabel}</label>
          <input
            id="setup-pass1"
            type="password"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </Field>
        <Field>
          <label htmlFor="setup-pass2">{c.vaultGate.repeatPasswordLabel}</label>
          <input
            id="setup-pass2"
            type="password"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            disabled={busy}
          />
        </Field>
        {weak && <p className="text-warn">{weak}</p>}
        {mismatch && <p className="text-warn">{c.vaultGate.mismatch}</p>}
        <CheckboxField>
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            disabled={busy}
          />
          {c.vaultGate.understood}
        </CheckboxField>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {c.vaultGate.setup.submit}
        </Button>
        <p>
          {c.vaultGate.setup.haveBackupQuestion}{" "}
          <Button onClick={() => setMode("restore")} disabled={busy}>
            {c.vaultGate.setup.restoreFromBackup}
          </Button>
        </p>
      </Card>
    </div>
  );
}

type RestoreOnSetupScreenProps = ScreenProps & { onCancel: () => void };

// Fresh-machine recovery: no vault exists yet, so instead of creating a new
// (empty) one, adopt a downloaded .lavega back-up as THE vault.
function RestoreOnSetupScreen({ storage, onReady, onCancel }: RestoreOnSetupScreenProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
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
        setError(c.vaultGate.restoreOnSetup.restoreError);
        return;
      }
      onReady();
    } catch {
      setError(c.vaultGate.restoreOnSetup.restoreError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vault-gate">
      <Card as="form" className="vault-gate-card" onSubmit={submit}>
        <h2>{c.vaultGate.restoreOnSetup.title}</h2>
        <p>{c.vaultGate.restoreOnSetup.intro}</p>
        <Field>
          <label htmlFor="setup-restore-file">{c.vaultGate.restoreOnSetup.fileLabel}</label>
          <input
            id="setup-restore-file"
            type="file"
            accept=".lavega"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field>
          <label htmlFor="setup-restore-pass">{c.vaultGate.passwordLabel}</label>
          <input
            id="setup-restore-pass"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </Field>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {c.vaultGate.restoreOnSetup.submit}
        </Button>
        <p>
          <Button onClick={onCancel} disabled={busy}>
            {c.vaultGate.restoreOnSetup.back}
          </Button>
        </p>
      </Card>
    </div>
  );
}

function MigrateScreen({ storage, onReady, onBackup }: ScreenProps & { onBackup: () => void }) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [migrated, setMigrated] = useState(false);

  const mismatch = pass2.length > 0 && pass1 !== pass2;
  // Only judge once something has been typed, so the screen does not open by
  // scolding an empty field.
  const weak = pass1.length > 0 ? weakPasswordMessage(c, vaultPasswordProblem(pass1)) : null;
  const canSubmit = weak === null && pass1.length > 0 && pass1 === pass2 && understood && !busy;

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
        <Card className="vault-gate-card">
          <h2>{c.vaultGate.migrate.done.title}</h2>
          <p>{c.vaultGate.migrate.done.body}</p>
          <p className="text-warn">{c.vaultGate.migrate.done.warning}</p>
          <Button variant="primary" onClick={onBackup}>
            {c.vaultGate.migrate.done.backupNow}
          </Button>{" "}
          <Button onClick={onReady}>{c.vaultGate.migrate.done.later}</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="vault-gate">
      <Card as="form" className="vault-gate-card" onSubmit={submit}>
        <h2>{c.vaultGate.migrate.title}</h2>
        <p>{c.vaultGate.migrate.intro}</p>
        <p className="text-warn">{c.vaultGate.dataLossWarning}</p>
        <Field>
          <label htmlFor="migrate-pass1">{c.vaultGate.passwordLabel}</label>
          <input
            id="migrate-pass1"
            type="password"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </Field>
        <Field>
          <label htmlFor="migrate-pass2">{c.vaultGate.repeatPasswordLabel}</label>
          <input
            id="migrate-pass2"
            type="password"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            disabled={busy}
          />
        </Field>
        {weak && <p className="text-warn">{weak}</p>}
        {mismatch && <p className="text-warn">{c.vaultGate.mismatch}</p>}
        <CheckboxField>
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            disabled={busy}
          />
          {c.vaultGate.understood}
        </CheckboxField>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {busy ? c.vaultGate.migrate.submitBusy : c.vaultGate.migrate.submitIdle}
        </Button>
      </Card>
    </div>
  );
}
