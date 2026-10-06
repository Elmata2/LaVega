import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/modules.css";
import "./styles/charts.css";
import "./styles/blocks.css";
import "./styles/worldmap.css";
import "./styles/landing.css";
import Root from "./Root";
import { initWebSentry } from "./observability";
import posthog, { posthogConfigured } from "./posthog";

initWebSentry();

if (posthogConfigured) {
  posthog.logger.info("web client started", { event: "web_client_started", render_mode: "spa" });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
    <Analytics />
    <SpeedInsights />
  </StrictMode>,
);
