import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type SignupValues = { name: string; email: string; password: string };

export function SignupForm({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (values: SignupValues) => Promise<void>;
  pending: boolean;
  error: string | null;
}) {
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== data.get("confirm-password")) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setPasswordError(null);
    await onSubmit({
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      password,
    });
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">LaVega</p>
        <CardTitle as="h1">Create your account</CardTitle>
        <CardDescription>Start with your name, email address, and a password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="signup-name">Full name</FieldLabel>
              <Input id="signup-name" name="name" autoComplete="name" required maxLength={100} />
            </Field>
            <Field>
              <FieldLabel htmlFor="signup-email">Email address</FieldLabel>
              <Input id="signup-email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="signup-password">Password</FieldLabel>
              <Input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
              <FieldDescription>Use at least 8 characters.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="signup-confirm-password">Confirm password</FieldLabel>
              <Input
                id="signup-confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                aria-invalid={passwordError !== null}
                aria-describedby={passwordError ? "password-error" : undefined}
              />
              {passwordError && (
                <p id="password-error" role="alert" className="text-sm text-negative">
                  {passwordError}
                </p>
              )}
            </Field>
            {error && (
              <div role="alert" className="space-y-1 text-sm text-negative">
                <p>{error}</p>
                <p>
                  Already created your account?{" "}
                  <Link to="/check-email" className="font-semibold underline underline-offset-4">
                    Request a confirmation link
                  </Link>
                </p>
              </div>
            )}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Creating account…" : "Create account"}
            </Button>
            <FieldDescription className="text-center">
              Already have an account?{" "}
              <Link
                to="/sign-in"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </FieldDescription>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
