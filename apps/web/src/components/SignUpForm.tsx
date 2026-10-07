import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "../locale.js";
import {
  resendVerification,
  signUp,
  verificationCallbackUrl,
  type MailResult,
  type SignUpFailure,
} from "../authClient.js";
import { shellCopy } from "../copy/shell.js";
import posthog from "../posthog.js";
import Button from "./ui/Button.js";
import { Field } from "./ui/Field.js";
import PasswordInput from "./ui/PasswordInput.js";

/** Seconds before the confirmation mail may be sent again. */
export const RESEND_COOLDOWN = 60;

export type SignUpFormProps = {
  locale: Locale;
  intro: string;
  introClassName?: string;
};

export default function SignUpForm({
  locale,
  intro,
  introClassName = "cell-sub",
}: SignUpFormProps) {
  const c = shellCopy[locale].profiel.account;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SignUpFailure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const complete = name.trim() !== "" && email.trim() !== "" && password.trim() !== "" && agreed;

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    if (!complete) return;
    setBusy(true);
    setFailure(null);
    const result = await signUp({
      name: name.trim(),
      email,
      password,
      callbackURL: verificationCallbackUrl(),
    });
    setBusy(false);
    if (!result.ok) {
      setFailure(result.kind);
      return;
    }
    setPassword("");
    setSentTo(email);
    posthog.capture("sign_up_requested");
  }

  if (sentTo !== null)
    return (
      <CheckEmail
        locale={locale}
        email={sentTo}
        introClassName={introClassName}
        onOtherEmail={() => setSentTo(null)}
      />
    );

  return (
    <>
      <p className={introClassName}>{intro}</p>
      <form onSubmit={(e) => void handleSignUp(e)}>
        <Field>
          <label htmlFor="signup-name">{c.signUp.nameLabel}</label>
          <input
            id="signup-name"
            type="text"
            value={name}
            disabled={busy}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field>
          <label htmlFor="signup-email">{c.emailLabel}</label>
          <input
            id="signup-email"
            type="email"
            value={email}
            disabled={busy}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <label htmlFor="signup-password">{c.passwordLabel}</label>
          <PasswordInput
            id="signup-password"
            value={password}
            disabled={busy}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            aria-describedby="signup-password-hint"
            showLabel={c.showPassword}
            hideLabel={c.hidePassword}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span id="signup-password-hint" className="text-[0.85rem] text-muted">
            {c.signUp.passwordHint}
          </span>
        </Field>
        <label htmlFor="signup-consent" className="flex items-start gap-2">
          <input
            id="signup-consent"
            type="checkbox"
            required
            checked={agreed}
            disabled={busy}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            {c.signUp.consentBefore}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              {c.signUp.privacyLink}
            </a>
            {c.signUp.consentBetween}
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              {c.signUp.termsLink}
            </a>
          </span>
        </label>
        {failure !== null && (
          <p role="alert" className="text-warn">
            {c.signUp.error[failure]}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy || !complete}>
          {busy ? c.signUp.busy : c.signUp.submit}
        </Button>
      </form>
    </>
  );
}

type MailFailure = Extract<MailResult, { ok: false }>["kind"];

/* The screen most new accounts stall on. It names the address (typos show up
 * here), offers a resend after a short wait, and a way back to fix the address. */
function CheckEmail({
  locale,
  email,
  introClassName,
  onOtherEmail,
}: {
  locale: Locale;
  email: string;
  introClassName: string;
  onOtherEmail: () => void;
}) {
  const c = shellCopy[locale].profiel.account;
  const [wait, setWait] = useState(RESEND_COOLDOWN);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [failure, setFailure] = useState<MailFailure | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function resend() {
    setBusy(true);
    setFailure(null);
    setResent(false);
    const result = await resendVerification(email);
    setBusy(false);
    setWait(RESEND_COOLDOWN);
    if (!result.ok) {
      setFailure(result.kind);
      return;
    }
    setResent(true);
    posthog.capture("verification_email_resent");
  }

  return (
    <div role="status" className="flex flex-col gap-2">
      <p className={introClassName}>
        <strong>{c.signUp.doneTitle}</strong>
      </p>
      <p className={introClassName}>{c.signUp.doneBody(email)}</p>
      {resent && <p className={introClassName}>{c.signUp.resent}</p>}
      {failure !== null && (
        <p role="alert" className="text-warn">
          {c.mailError[failure]}
        </p>
      )}
      <Button
        type="button"
        variant="primary"
        disabled={busy || wait > 0}
        onClick={() => void resend()}
      >
        {wait > 0 ? c.signUp.resendIn(wait) : c.signUp.resend}
      </Button>
      <button
        type="button"
        className="self-start bg-transparent! border-0! p-0! text-[0.9rem] text-muted underline cursor-pointer"
        onClick={onOtherEmail}
      >
        {c.signUp.otherEmail}
      </button>
    </div>
  );
}
