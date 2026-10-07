import { useState } from "react";
import type { FormEvent } from "react";
import type { VaultStorage } from "@lavega/adapters";
import type { GateState } from "../vault-gate.js";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import Button from "./ui/Button.js";
import Card from "./ui/Card.js";
import { Field } from "./ui/Field.js";
import PasswordInput from "./ui/PasswordInput.js";

type VaultGateProps = {
  gate: GateState;
  storage: VaultStorage;
  /** `fresh` is true when the owner chose to start with an empty vault. */
  onReady: (fresh: boolean) => void;
  onRetry: () => void;
  onSignOut: () => void;
};

// The vault opens with the account's key, so in the normal case this renders
// only a loading line. App only mounts it while gate !== "ready".
export default function VaultGate({ gate, storage, onReady, onRetry, onSignOut }: VaultGateProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale].vaultGate;
  if (gate === "loading") {
    return (
      <div className="vault-gate">
        <p className="text-muted">{c.loading}</p>
      </div>
    );
  }
  if (gate === "password-vault") return <AdoptScreen storage={storage} onReady={onReady} />;
  if (typeof gate === "object") {
    return (
      <div className="vault-gate">
        <Card className="vault-gate-card">
          <h2>{c.keyError.title}</h2>
          <p role="alert">{c.keyError[gate.error]}</p>
          <Button variant="primary" onClick={onRetry}>
            {c.keyError.retry}
          </Button>
          <Button onClick={onSignOut}>{c.keyError.signOut}</Button>
        </Card>
      </div>
    );
  }
  return null; // "ready" — App renders the app itself in this state
}

/* Shown once, to someone whose browser holds a vault sealed with the vault
 * password LaVega used to ask for. The password proves the vault is theirs;
 * after this it opens with the account like any other. */
function AdoptScreen({
  storage,
  onReady,
}: {
  storage: VaultStorage;
  onReady: (fresh: boolean) => void;
}) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const g = c.vaultGate;
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!(await storage.adoptPasswordVault(pass))) {
        setError(g.adopt.wrongPassword);
        return;
      }
      onReady(false);
    } finally {
      setBusy(false);
    }
  }

  async function startFresh() {
    setBusy(true);
    try {
      await storage.startFresh();
      onReady(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vault-gate">
      <Card as="form" className="vault-gate-card" onSubmit={submit}>
        <h2>{g.adopt.title}</h2>
        <p>{g.adopt.intro}</p>
        <Field>
          <label htmlFor="adopt-pass">{g.passwordLabel}</label>
          <PasswordInput
            id="adopt-pass"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            disabled={busy}
            autoComplete="current-password"
            showLabel={c.profiel.account.showPassword}
            hideLabel={c.profiel.account.hidePassword}
            autoFocus
          />
        </Field>
        {error && (
          <p role="alert" className="text-warn">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy || pass.length === 0}>
          {busy ? g.adopt.busy : g.adopt.submit}
        </Button>
        <p className="text-muted mt-4">
          <strong>{g.adopt.forgotTitle}</strong> {g.adopt.forgotBody}
        </p>
        <Button type="button" disabled={busy} onClick={() => void startFresh()}>
          {g.adopt.startFresh}
        </Button>
      </Card>
    </div>
  );
}
