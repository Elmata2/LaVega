import { useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "../locale.js";
import { signUp, verificationCallbackUrl, type SignUpFailure } from "../authClient.js";
import { shellCopy } from "../copy/shell.js";
import posthog from "../posthog.js";
import Button from "./ui/Button.js";
import { Field } from "./ui/Field.js";

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
      <div role="status">
        <p className={introClassName}>
          <strong>{c.signUp.doneTitle}</strong>
        </p>
        <p className={introClassName}>{c.signUp.doneBody(sentTo)}</p>
      </div>
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
          <input
            id="signup-password"
            type="password"
            value={password}
            disabled={busy}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            onChange={(e) => setPassword(e.target.value)}
          />
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
