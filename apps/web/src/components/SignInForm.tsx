import { useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "../locale.js";
import { signIn, type SignInFailure } from "../authClient.js";
import { shellCopy } from "../copy/shell.js";
import posthog from "../posthog.js";
import Button from "./ui/Button.js";
import { Field } from "./ui/Field.js";
import PasswordInput from "./ui/PasswordInput.js";

/* Extracted from Profiel's AccountBlock so the same sign-in UI can also render
 * on the public landing page. `locale` is a prop rather than read via
 * `useAppLocale()` in here: the landing page's locale comes from the URL path
 * (`localeForPath`), not from the `lavega_locale` cookie `useAppLocale` reads,
 * and a shared component reading its own locale would let those two silently
 * diverge. `intro` is a prop for the same reason as `onSuccess` — Profiel and
 * Landing each mean something different by "signed in", and by "why you are
 * signing in", and neither wording belongs inside a component both call. */
export type SignInFormProps = {
  locale: Locale;
  intro: string;
  onSuccess: () => void;
  /** Profiel's `cell-sub` (monospace, muted) reads wrong at landing scale; the
   *  landing page passes its own class here instead of every caller open-coding
   *  the intro paragraph. Defaults to `cell-sub` so Profiel's call site is
   *  unchanged. */
  introClassName?: string;
  /** Shown only where a reset flow exists. Receives the typed email so the
   *  reset form does not ask for it twice. */
  onForgotPassword?: (email: string) => void;
  /** A status line above the button, e.g. "your password was changed". */
  notice?: string;
  initialEmail?: string;
};

export default function SignInForm({
  locale,
  intro,
  onSuccess,
  introClassName = "cell-sub",
  onForgotPassword,
  notice,
  initialEmail = "",
}: SignInFormProps) {
  const c = shellCopy[locale];
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SignInFailure | null>(null);

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    const result = await signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setFailure(result.kind);
      return;
    }
    setPassword("");
    posthog.capture("sign_in_succeeded");
    onSuccess();
  }

  return (
    <>
      <p className={introClassName}>{intro}</p>
      <form onSubmit={(e) => void handleSignIn(e)}>
        <Field>
          <label htmlFor="account-email">{c.profiel.account.emailLabel}</label>
          <input
            id="account-email"
            type="email"
            value={email}
            disabled={busy}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <label htmlFor="account-password">{c.profiel.account.passwordLabel}</label>
          <PasswordInput
            id="account-password"
            value={password}
            disabled={busy}
            autoComplete="current-password"
            showLabel={c.profiel.account.showPassword}
            hideLabel={c.profiel.account.hidePassword}
            onChange={(e) => setPassword(e.target.value)}
          />
          {onForgotPassword && (
            <button
              type="button"
              className="self-start bg-transparent! border-0! p-0! text-[0.85rem] text-muted underline cursor-pointer"
              onClick={() => onForgotPassword(email)}
            >
              {c.profiel.account.forgotPassword}
            </button>
          )}
        </Field>
        {notice && failure === null && (
          <p role="status" className={introClassName}>
            {notice}
          </p>
        )}
        {failure !== null && (
          <p role="alert" className="text-warn">
            {c.profiel.account.signInError[failure]}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy || !email || !password}>
          {c.profiel.account.signIn}
        </Button>
      </form>
    </>
  );
}
