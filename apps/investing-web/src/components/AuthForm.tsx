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
import { LoginForm, type LoginValues } from "./login-form";
import { SignupForm, type SignupValues } from "./signup-form";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
    <AuthShell>
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
    </AuthShell>
  );
}

export function CheckEmailPage() {
  const location = useLocation();
  const initialEmail = (location.state as AuthLocationState)?.email ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const result = await resendVerificationEmail(email.trim());
      if (result.ok) setMessage("If this address needs confirmation, a new email is on its way.");
      else setError(result.message);
    } catch {
      setError("Connection failed. Check your network and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <Card className="w-full">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">LaVega</p>
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
              {message && (
                <p role="status" className="text-sm text-positive">
                  {message}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-negative">
                  {error}
                </p>
              )}
              <Button type="submit" variant="outline" disabled={pending} className="w-full">
                {pending ? "Sending…" : "Resend confirmation email"}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground">
              <Link
                to="/sign-in"
                className="font-semibold text-primary underline-offset-4 hover:underline"
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
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Request another link
            </Link>
            <Link
              to="/sign-in"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email);
      if (result.ok) setSent(true);
      else setError(result.message);
    } catch {
      setError("Connection failed. Check your network and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <Card className="w-full">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">LaVega</p>
          <CardTitle as="h1">Reset your password</CardTitle>
          <CardDescription>
            Enter your account email. We will send a link to set a new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            {sent ? (
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
                {error && (
                  <p role="alert" className="text-sm text-negative">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={pending} className="w-full">
                  {pending ? "Sending…" : "Send reset link"}
                </Button>
              </form>
            )}
            <p className="text-center text-sm">
              <Link
                to="/sign-in"
                className="font-semibold text-primary underline-offset-4 hover:underline"
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

export function ResetPasswordPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== data.get("confirm-password")) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await resetPassword(token, password);
      if (result.ok) {
        window.history.replaceState(window.history.state, "", window.location.pathname);
        setDone(true);
      } else setError(result.message);
    } catch {
      setError("Connection failed. Check your network and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <Card className="w-full">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">LaVega</p>
          <CardTitle as="h1">{done ? "Password changed" : "Choose a new password"}</CardTitle>
          <CardDescription>
            {done
              ? "You can now sign in with your new password."
              : "Use at least 8 characters. Your other sessions will be signed out."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            {!token || params.has("error") ? (
              <p role="alert" className="text-sm text-negative">
                Reset link is invalid or expired. Request a new link.
              </p>
            ) : done ? null : (
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
                {error && (
                  <p role="alert" className="text-sm text-negative">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={pending} className="w-full">
                  {pending ? "Saving…" : "Save new password"}
                </Button>
              </form>
            )}
            <p className="text-center text-sm">
              <Link
                to={done ? "/sign-in" : "/forgot-password"}
                className="font-semibold text-primary underline-offset-4 hover:underline"
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
