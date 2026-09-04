import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getSession, type SessionState } from "../lib/auth-client";

/* Gates the routes nested under it behind a signed-in session.
 *
 * "unconfigured" (no DATABASE_URL / BETTER_AUTH_SECRET) is local/self-hosted
 * dev without an auth backend at all — apps/server answers every /api/auth/*
 * call with 503 there, so this renders through unguarded, matching how the
 * app behaved before sign-up existed. Only a configured backend with no
 * session redirects to /sign-in. */
export function RequireAuth() {
  const [state, setState] = useState<SessionState | "loading">("loading");
  const location = useLocation();

  useEffect(() => {
    let current = true;
    void getSession().then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, []);

  if (state === "loading") return null;
  if (state.status === "anonymous")
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  return <Outlet />;
}
