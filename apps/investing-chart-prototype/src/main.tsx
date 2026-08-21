import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Two views, switchable with ?variant=combined|separate.
// See App.tsx for what each answers.
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
