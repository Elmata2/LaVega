import { useEffect, useState } from "react";
import App from "./App";
import Landing from "./views/Landing";
import { APP_BASE, isAppPathname, normalizeAppLocation } from "./appRoutes";
import { localeForPath, type Locale } from "./locale";
import { useAuthState } from "./authClient";

/** Public landing at `/`. Vault app at `/app` and `/app/<view>`. Legacy
 *  `/#app` and `/?eb=…` normalise into `/app` so Enable Banking still lands. */
function routeFor(): "app" | "landing" {
  normalizeAppLocation();
  if (isAppPathname(window.location.pathname)) return "app";
  return "landing";
}

export default function Root() {
  const [route, setRoute] = useState<"app" | "landing">(routeFor);
  /* The landing page exists in Dutch at `/` and English at `/en`. The vault app
   * has no locale of its own — it is Dutch throughout — so this only ever
   * changes what the public page reads. */
  const [locale, setLocale] = useState<Locale>(() => localeForPath(window.location.pathname));
  /* The client-side session gate. It is the only layer that sees every way
   * into `/app` — `#app`, `?eb=…`, a pushState from the landing page, a
   * direct load — because a hash never reaches the server and the Vercel
   * edge gate (scripts/vercel-build.mjs) only checks cookie presence, not
   * validity. */
  const { state: authState } = useAuthState();
  useEffect(() => {
    const onChange = () => {
      setRoute(routeFor());
      setLocale(localeForPath(window.location.pathname));
    };
    window.addEventListener("popstate", onChange);
    window.addEventListener("hashchange", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("hashchange", onChange);
    };
  }, []);

  if (route === "app") {
    // The first get-session answer has not arrived yet: render nothing
    // rather than flash the landing page or the vault, same idiom as
    // Profiel.tsx's own indeterminate-first-paint check.
    if (authState.kind === "loading") return null;
    // Self-hosted Docker/Railway with no DATABASE_URL/BETTER_AUTH_SECRET has
    // no accounts at all — LaVega is local-first, so this MUST still mount
    // the app or every self-hoster is locked out of their own vault.
    if (authState.kind === "unconfigured") return <App />;
    if (authState.kind === "signed-in") return <App />;
    // Signed out: fall through to the landing page below. Any `?eb=` params
    // normalizeAppLocation already captured stay in appRoutes' module-level
    // handoff untouched — not consumed here — so a sign-in on the landing
    // page still lets App pick them up once it mounts.
  }
  return (
    <Landing
      locale={locale}
      onEnter={() => {
        window.history.pushState({}, "", APP_BASE);
        setRoute("app");
      }}
    />
  );
}
