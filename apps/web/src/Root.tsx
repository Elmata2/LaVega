import { useEffect, useState } from "react";
import App from "./App";
import Landing from "./views/Landing";
import { APP_BASE, isAppPathname, normalizeAppLocation } from "./appRoutes";

/** Public landing at `/`. Vault app at `/app` and `/app/<view>`. Legacy
 *  `/#app` and `/?eb=…` normalise into `/app` so Enable Banking still lands. */
function routeFor(): "app" | "landing" {
  normalizeAppLocation();
  if (isAppPathname(window.location.pathname)) return "app";
  return "landing";
}

export default function Root() {
  const [route, setRoute] = useState<"app" | "landing">(routeFor);
  useEffect(() => {
    const onChange = () => setRoute(routeFor());
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
      onEnter={() => {
        window.history.pushState({}, "", APP_BASE);
        setRoute("app");
      }}
    />
  );
}
