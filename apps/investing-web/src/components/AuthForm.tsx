import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { signIn, signUp } from "../lib/auth-client";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Mode = "sign-up" | "sign-in";

export function AuthForm() {
  const [mode, setMode] = useState<Mode>("sign-up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string } } };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage(null);
    const result =
      mode === "sign-up"
        ? await signUp({ name, email, password })
        : await signIn({ email, password });
    if (!result.ok) {
      setStatus("error");
      setMessage(result.message);
      return;
    }
    navigate(location.state?.from?.pathname ?? "/", { replace: true });
  }

  function switchMode() {
    setMode((current) => (current === "sign-up" ? "sign-in" : "sign-up"));
    setMessage(null);
    setStatus("idle");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">LaVega</p>
          <CardTitle>{mode === "sign-up" ? "Account aanmaken" : "Inloggen"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {mode === "sign-up" && (
              <Label className="block">
                Naam
                <Input
                  required
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-2"
                />
              </Label>
            )}
            <Label className="block">
              E-mailadres
              <Input
                required
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2"
              />
            </Label>
            <Label className="block">
              Wachtwoord
              <Input
                required
                name="password"
                type="password"
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2"
              />
            </Label>
            {message && (
              <p role="alert" className="text-sm text-negative">
                {message}
              </p>
            )}
            <Button type="submit" disabled={status === "loading"} className="w-full">
              {status === "loading"
                ? "Bezig…"
                : mode === "sign-up"
                  ? "Account aanmaken"
                  : "Inloggen"}
            </Button>
          </form>
          <button
            type="button"
            data-action="switch-mode"
            onClick={switchMode}
            className="pressable mt-4 rounded-sm text-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            {mode === "sign-up" ? "Al een account? Inloggen" : "Nog geen account? Registreren"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
