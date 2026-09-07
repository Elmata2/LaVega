import { useEffect, useState } from "react";
import App from "./App";
import Landing from "./views/Landing";
import { APP_BASE, isAppPathname, normalizeAppLocation } from "./appRoutes";
import { localeForPath, type Locale } from "./locale";

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

  if (route === "app") return <App />;
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
