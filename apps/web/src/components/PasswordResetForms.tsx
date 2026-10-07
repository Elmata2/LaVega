import { useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "../locale.js";
import {
  requestPasswordReset,
  resetPassword,
  type MailResult,
  type ResetPasswordFailure,
} from "../authClient.js";
import { shellCopy } from "../copy/shell.js";
import posthog from "../posthog.js";
import Button from "./ui/Button.js";
import { Field } from "./ui/Field.js";
import PasswordInput from "./ui/PasswordInput.js";

type MailFailure = Extract<MailResult, { ok: false }>["kind"];

/* Step one of a reset: ask for the address, then say the same thing whether or
 * not it has an account. Saying "no account found" would let anyone test which
 * addresses use LaVega. */
export function RequestResetForm({
  locale,
  initialEmail = "",
  introClassName = "cell-sub",
  onBack,
}: {
  locale: Locale;
  initialEmail?: string;
  introClassName?: string;
  onBack: () => void;
}) {
  const c = shellCopy[locale].profiel.account;
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MailFailure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    const result = await requestPasswordReset(email.trim());
    setBusy(false);
    if (!result.ok) {
      setFailure(result.kind);
      return;
    }
    setSentTo(email.trim());
    posthog.capture("password_reset_requested");
  }

  const back = (
    <button
      type="button"
      className="mt-2 self-start bg-transparent! border-0! p-0! text-[0.9rem] text-muted underline cursor-pointer"
      onClick={onBack}
    >
      {c.reset.backToSignIn}
    </button>
  );

  if (sentTo !== null)
    return (
      <div role="status">
        <p className={introClassName}>{c.reset.sentBody(sentTo)}</p>
        {back}
      </div>
    );

  return (
    <>
      <p className={introClassName}>{c.reset.requestIntro}</p>
      <form onSubmit={(e) => void submit(e)}>
        <Field>
          <label htmlFor="reset-email">{c.emailLabel}</label>
          <input
            id="reset-email"
            type="email"
            required
            value={email}
            disabled={busy}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {failure !== null && (
          <p role="alert" className="text-warn">
            {c.mailError[failure]}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
          {c.reset.requestSubmit}
        </Button>
      </form>
      {back}
    </>
  );
}

/* Step two: the emailed link landed on /reset-password?token=…. A token
 * better-auth already rejected arrives as `null` and shows the expired-link
 * message without a form that cannot succeed. */
export function NewPasswordForm({
  locale,
  token,
  introClassName = "cell-sub",
  onDone,
  onRequestNew,
}: {
  locale: Locale;
  token: string | null;
  introClassName?: string;
  onDone: () => void;
  onRequestNew: () => void;
}) {
  const c = shellCopy[locale].profiel.account;
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ResetPasswordFailure | null>(
    token === null ? "invalid-link" : null,
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (token === null) return;
    setBusy(true);
    setFailure(null);
    const result = await resetPassword(token, password);
    setBusy(false);
    if (!result.ok) {
      setFailure(result.kind);
      return;
    }
    setPassword("");
    posthog.capture("password_reset_completed");
    onDone();
  }

  if (failure === "invalid-link")
    return (
      <>
        <p role="alert" className={introClassName}>
          {c.reset.error["invalid-link"]}
        </p>
        <Button type="button" variant="primary" onClick={onRequestNew}>
          {c.reset.requestSubmit}
        </Button>
      </>
    );

  return (
    <form onSubmit={(e) => void submit(e)}>
      {/* Lets the password manager file the new password under the right account. */}
      <input type="text" autoComplete="username" hidden readOnly />
      <Field>
        <label htmlFor="reset-password">{c.reset.newPasswordLabel}</label>
        <PasswordInput
          id="reset-password"
          required
          minLength={8}
          maxLength={128}
          value={password}
          disabled={busy}
          autoComplete="new-password"
          aria-describedby="reset-password-hint"
          showLabel={c.showPassword}
          hideLabel={c.hidePassword}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span id="reset-password-hint" className="text-[0.85rem] text-muted">
          {c.signUp.passwordHint}
        </span>
      </Field>
      {failure !== null && (
        <p role="alert" className="text-warn">
          {c.reset.error[failure]}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy || password.length === 0}>
        {c.reset.save}
      </Button>
    </form>
  );
}
