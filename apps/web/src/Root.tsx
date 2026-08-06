import { useEffect, useState } from "react";
import App from "./App";
import Landing from "./views/Landing";

/** Public landing at "/" ; the app lives behind "#app". An Enable Banking
 *  return lands on "/?eb=..." (no hash) — route those straight to the app so
 *  the callback handler in App still runs. */
function routeFor(): "app" | "landing" {
  if (window.location.hash === "#app") return "app";
  const q = window.location.search;
  if (q.includes("eb=") || q.includes("eb_error=")) return "app";
  return "landing";
}

export default function Root() {
  const [route, setRoute] = useState<"app" | "landing">(routeFor);
  useEffect(() => {
    const onChange = () => setRoute(routeFor());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  if (route === "app") return <App />;
  return <Landing onEnter={() => { window.location.hash = "app"; }} />;
}
