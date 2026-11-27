import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  getSession,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  signIn,
  signUp,
  verificationCallbackUrl,
} from "../lib/auth-client";
import { AuthLayout } from "./auth-layout";
import { LoginForm, type LoginValues } from "./login-form";
import { SignupForm, type SignupValues } from "./signup-form";
import { Button } from "@lavega/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lavega/ui";
import { Input } from "@lavega/ui";
import { Label } from "@lavega/ui";

type AuthLocationState = { from?: { pathname: string }; email?: string } | null;

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md items-center px-5 py-10">
      {children}
    </main>
  );
}

export function AuthForm({ mode }: { mode: "sign-up" | "sign-in" }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as AuthLocationState;

  async function createAccount(values: SignupValues) {
    setPending(true);
    setError(null);
    try {
      const result = await signUp({ ...values, callbackURL: verificationCallbackUrl() });
      if (!result.ok) {
        setError(result.message);
      } else if (result.pendingVerification) {
        navigate("/check-email", { replace: true, state: { email: values.email } });
      } else {
        navigate(state?.from?.pathname ?? "/", { replace: true });
      }
    } catch {
      setError("Connection failed. Check your network and try again.");
    } finally {
      setPending(false);
    }
  }

  async function login(values: LoginValues) {
    setPending(true);
    setError(null);
    try {
      const result = await signIn(values);
      if (!result.ok) setError(result.message);
      else navigate(state?.from?.pathname ?? "/", { replace: true });
    } catch {
      setError("Connection failed. Check your network and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout>
      {mode === "sign-up" ? (
        <SignupForm onSubmit={createAccount} pending={pending} error={error} />
      ) : (
        <LoginForm
          onSubmit={login}
          pending={pending}
          error={error}
          verified={new URLSearchParams(location.search).get("verified") === "1"}
        />
      )}
    </AuthLayout>
  );
}

type CheckEmailPhase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent"; message: string }
  | { kind: "error"; message: string };

export function CheckEmailPage() {
  const location = useLocation();
  const initialEmail = (location.state as AuthLocationState)?.email ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [phase, setPhase] = useState<CheckEmailPhase>({ kind: "idle" });

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase.kind === "submitting") return;
    setPhase({ kind: "submitting" });
    try {
      const result = await resendVerificationEmail(email.trim());
      if (result.ok)
        setPhase({
          kind: "sent",
          message: "If this address needs confirmation, a new email is on its way.",
        });
      else setPhase({ kind: "error", message: result.message });
    } catch {
      setPhase({
        kind: "error",
        message: "Connection failed. Check your network and try again.",
      });
    }
  }

  return (
    <AuthShell>
      <Card className="w-full">
        <CardHeader>
          <p className="font-display text-3xl">LaVega</p>
          <CardTitle as="h1">Check your email</CardTitle>
          <CardDescription>
            If this address is new to LaVega, a confirmation link is on its way
            {initialEmail && (
              <>
                {" "}
                to <strong className="text-foreground">{initialEmail}</strong>
              </>
            )}
            . Open it to finish creating your account. Link expires in one hour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              No email? Check spam, or request another link below.
            </p>
            <form onSubmit={resend} className="space-y-3">
              <Label htmlFor="resend-email">Email address</Label>
              <Input
                id="resend-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              {phase.kind === "sent" && (
                <p role="status" className="text-sm text-positive">
                  {phase.message}
                </p>
              )}
              {phase.kind === "error" && (
                <p role="alert" className="text-sm text-negative">
                  {phase.message}
                </p>
              )}
              <Button
                type="submit"
                variant="outline"
                disabled={phase.kind === "submitting"}
                className="w-full"
              >
                {phase.kind === "submitting" ? "Sending…" : "Resend confirmation email"}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground">
              <Link
                to="/sign-in"
                className="font-semibold text-accent underline-offset-4 hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  );
}

export function EmailConfirmedPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const error = new URLSearchParams(location.search).get("error");

  useEffect(() => {
    if (error) return;
    let active = true;
    getSession()
      .then((session) => {
        if (!active) return;
        navigate(session.status === "authenticated" ? "/" : "/sign-in?verified=1", {
          replace: true,
        });
      })
      .catch(() => {
        if (active) navigate("/sign-in?verified=1", { replace: true });
      });
    return () => {
      active = false;
    };
  }, [error, navigate]);

  if (!error)
    return (
      <AuthShell>
        <p role="status">Confirming your email…</p>
      </AuthShell>
    );
  return (
    <AuthShell>
      <Card className="w-full">
        <CardHeader>
          <CardTitle as="h1">Confirmation link did not work</CardTitle>
          <CardDescription>
            Link may have expired or already been used. Request a new one and try again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 text-sm">
            <Link
              to="/check-email"
              className="font-semibold text-accent underline-offset-4 hover:underline"
            >
              Request another link
            </Link>
            <Link
              to="/sign-in"
              className="font-semibold text-accent underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  );
}

type ForgotPhase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function ForgotPasswordPage() {
  const [phase, setPhase] = useState<ForgotPhase>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase.kind === "submitting") return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPhase({ kind: "submitting" });
    try {
      const result = await requestPasswordReset(email);
      if (result.ok) setPhase({ kind: "sent" });
      else setPhase({ kind: "error", message: result.message });
    } catch {
      setPhase({
        kind: "error",
        message: "Connection failed. Check your network and try again.",
      });
    }
  }

  return (
    <AuthShell>
      <Card className="w-full">
        <CardHeader>
          <p className="font-display text-3xl">LaVega</p>
          <CardTitle as="h1">Reset your password</CardTitle>
          <CardDescription>
            Enter your account email. We will send a link to set a new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            {phase.kind === "sent" ? (
              <p role="status" className="text-sm">
                If an account uses that address, a reset link is on its way. Check your inbox and
                spam folder.
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <Label htmlFor="recovery-email">Email address</Label>
                <Input
                  id="recovery-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
                {phase.kind === "error" && (
                  <p role="alert" className="text-sm text-negative">
                    {phase.message}
                  </p>
                )}
                <Button type="submit" disabled={phase.kind === "submitting"} className="w-full">
                  {phase.kind === "submitting" ? "Sending…" : "Send reset link"}
                </Button>
              </form>
            )}
            <p className="text-center text-sm">
              <Link
                to="/sign-in"
                className="font-semibold text-accent underline-offset-4 hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  );
}

type ResetPhase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "done" };

export function ResetPasswordPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  const [phase, setPhase] = useState<ResetPhase>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || phase.kind === "submitting") return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== data.get("confirm-password")) {
      setPhase({ kind: "error", message: "Passwords do not match." });
      return;
    }
    setPhase({ kind: "submitting" });
    try {
      const result = await resetPassword(token, password);
      if (result.ok) {
        setPhase({ kind: "done" });
        window.history.replaceState(window.history.state, "", window.location.pathname);
      } else setPhase({ kind: "error", message: result.message });
    } catch {
      setPhase({
        kind: "error",
        message: "Connection failed. Check your network and try again.",
      });
    }
  }

  const done = phase.kind === "done";

  return (
    <AuthShell>
      <Card className="w-full">
        <CardHeader>
          <p className="font-display text-3xl">LaVega</p>
          <CardTitle as="h1">{done ? "Password changed" : "Choose a new password"}</CardTitle>
          <CardDescription>
            {done
              ? "You can now sign in with your new password."
              : "Use at least 8 characters. Your other sessions will be signed out."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            {done ? null : !token || params.has("error") ? (
              <p role="alert" className="text-sm text-negative">
                Reset link is invalid or expired. Request a new link.
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
                <Label htmlFor="confirm-new-password">Confirm new password</Label>
                <Input
                  id="confirm-new-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                {phase.kind === "error" && (
                  <p role="alert" className="text-sm text-negative">
                    {phase.message}
                  </p>
                )}
                <Button type="submit" disabled={phase.kind === "submitting"} className="w-full">
                  {phase.kind === "submitting" ? "Saving…" : "Save new password"}
                </Button>
              </form>
            )}
            <p className="text-center text-sm">
              <Link
                to={done ? "/sign-in" : "/forgot-password"}
                className="font-semibold text-accent underline-offset-4 hover:underline"
              >
                {done ? "Sign in" : "Request another link"}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
