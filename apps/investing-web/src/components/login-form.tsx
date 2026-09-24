import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type LoginValues = { email: string; password: string };

export function LoginForm({
  onSubmit,
  pending,
  error,
  verified,
}: {
  onSubmit: (values: LoginValues) => Promise<void>;
  pending: boolean;
  error: string | null;
  verified?: boolean;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSubmit({
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    });
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">LaVega</p>
        <CardTitle as="h1">Sign in</CardTitle>
        <CardDescription>Enter your email and password to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="login-email">Email address</FieldLabel>
              <Input id="login-email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <Link
                  to="/forgot-password"
                  className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            {verified && (
              <p role="status" className="text-sm text-positive">
                Email confirmed. Sign in to continue.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Signing in…" : "Sign in"}
            </Button>
            <FieldDescription className="text-center">
              New to LaVega?{" "}
              <Link
                to="/sign-up"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Create an account
              </Link>
            </FieldDescription>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
