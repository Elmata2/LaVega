import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { VaultStorage } from "@lavega/adapters";
import type { GateState } from "../vault-gate.js";
import { useAppLocale } from "../appLocale.js";
import { signOut } from "../authClient.js";
import { shellCopy } from "../copy/shell.js";
import Button from "./ui/Button.js";
import Card from "./ui/Card.js";
import { Field } from "./ui/Field.js";
import PasswordInput from "./ui/PasswordInput.js";
import StatusLine from "./ui/StatusLine.js";

type VaultGateProps = {
  gate: GateState;
  storage: VaultStorage;
  /** `fresh` is true when the owner chose to start with an empty vault. */
  onReady: (fresh: boolean) => void;
  onRetry: () => void;
  /** Runs after the sign-out request succeeded; App sends the user to the landing page. */
  onSignedOut: () => void;
};

type SignOutPhase = { kind: "idle" } | { kind: "signing-out" } | { kind: "failed" };

// The vault opens with the account's key, so in the normal case this renders
// only a loading line. App only mounts it while gate !== "ready".
export default function VaultGate({
  gate,
  storage,
  onReady,
  onRetry,
  onSignedOut,
}: VaultGateProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale].vaultGate;
  const [signOutPhase, setSignOutPhase] = useState<SignOutPhase>({ kind: "idle" });
  const signingOutRef = useRef(false);

  const signingOut = signOutPhase.kind === "signing-out";
  const signOutFailed = signOutPhase.kind === "failed";

  async function handleSignOut() {
    if (signingOut || signingOutRef.current) return;
    signingOutRef.current = true;
    setSignOutPhase({ kind: "signing-out" });
    try {
      await signOut();
      onSignedOut();
    } catch {
      setSignOutPhase({ kind: "failed" });
    } finally {
      signingOutRef.current = false;
    }
  }

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
          <Button type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
            {c.keyError.signOut}
          </Button>
          {signOutFailed && (
            <p role="alert" className="text-warn">
              {c.keyError.signOutError}
            </p>
          )}
        </Card>
      </div>
    );
  }
  return null; // "ready" — App renders the app itself in this state
}

type AdoptPhase =
  | { kind: "idle" }
  | { kind: "adopting" }
  | { kind: "starting-fresh" }
  | { kind: "error"; message: string };

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
  const [phase, setPhase] = useState<AdoptPhase>({ kind: "idle" });
  const inFlightRef = useRef(false);

  const busy = phase.kind === "adopting" || phase.kind === "starting-fresh";
  const error = phase.kind === "error" ? phase.message : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || inFlightRef.current || pass.length === 0) return;
    inFlightRef.current = true;
    setPhase({ kind: "adopting" });
    try {
      if (!(await storage.adoptPasswordVault(pass))) {
        setPhase({ kind: "error", message: g.adopt.wrongPassword });
        return;
      }
      setPhase({ kind: "idle" });
      onReady(false);
    } catch {
      setPhase({ kind: "error", message: g.adopt.wrongPassword });
    } finally {
      inFlightRef.current = false;
    }
  }

  async function startFresh() {
    if (busy || inFlightRef.current) return;
    inFlightRef.current = true;
    setPhase({ kind: "starting-fresh" });
    try {
      await storage.startFresh();
      setPhase({ kind: "idle" });
      onReady(true);
    } catch {
      setPhase({ kind: "idle" });
    } finally {
      inFlightRef.current = false;
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
          <StatusLine tone="problem" role="alert">
            {error}
          </StatusLine>
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
