import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Production all-in-one deploy serves this app under `/investing/` on lavega.dev.
  //
  // The name has to keep the `VITE_` prefix, and that is not cosmetic. The root
  // Dockerfile builds through `pnpm build` -> `turbo run build`, and turbo 2.x
  // defaults to envMode "strict": a task only sees the variables turbo.json
  // declares. This repo's turbo.json declares none, so an unprefixed variable
  // (this used to be `INVESTING_WEB_BASE`) was silently removed from the build's
  // environment — no error, just `undefined` here, the `?? "/"` fallback, and a
  // dist that asked for `/assets/...` instead of `/investing/assets/...`.
  // Turbo's Vite framework inference allowlists `VITE_*` automatically, so a
  // prefixed name both reaches the build and is folded into turbo's cache key
  // (verified with `turbo run build --dry=json`: it appears under `inferred`).
  base: process.env.VITE_INVESTING_BASE ?? "/",
  plugins: [react()],
  server: {
    proxy: {
      "/health": "http://localhost:8788",
      "/api": "http://localhost:8788",
    },
  },
});
