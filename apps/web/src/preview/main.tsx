/* Entry of the owner-review harness; see harness.tsx. */
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/modules.css";
import "../styles/charts.css";
import "../styles/blocks.css";
import "../styles/worldmap.css";
import "../styles/wizard.css";
import "./preview.css";
import { installNetworkStub } from "./network";
import { applyPreviewTheme, boot, Preview, readPreviewTheme } from "./harness";
import { setAppLocale } from "../appLocale.js";

installNetworkStub();
if (!document.cookie.includes("lavega_locale")) setAppLocale("en");
applyPreviewTheme(readPreviewTheme());

void boot().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
});
