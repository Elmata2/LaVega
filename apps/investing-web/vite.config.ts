import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { fileURLToPath, URL } from "node:url";

/* The Vercel Sentry integration provisions SENTRY_AUTH_TOKEN / SENTRY_ORG /
 * SENTRY_PROJECT for the deploy. Source maps are uploaded only when all three
 * are present, so a local build and the CI test run stay offline and upload
 * nothing. Maps are emitted hidden (no sourceMappingURL comment) and deleted
 * from dist after upload, so the served bundle never exposes original source.
 * `release.inject` attaches the commit SHA to every event, matching the maps. */
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const uploadSourceMaps = Boolean(sentryOrg && sentryProject && sentryAuthToken);

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
  plugins: [
    react(),
    ...(uploadSourceMaps
      ? sentryVitePlugin({
          org: sentryOrg,
          project: sentryProject,
          authToken: sentryAuthToken,
          telemetry: false,
          release: {
            name: process.env.VERCEL_GIT_COMMIT_SHA,
            deploy: false,
            setCommits: false,
          },
          sourcemaps: { filesToDeleteAfterUpload: ["**/*.map"] },
          errorHandler: (error) => console.warn("sentry source map upload failed:", error),
        }).map((plugin) => ({ ...plugin, apply: "build" as const }))
      : []),
  ],
  build: { sourcemap: uploadSourceMaps ? "hidden" : false },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: {
      "/health": "http://localhost:8788",
      "/api": "http://localhost:8788",
    },
  },
});
