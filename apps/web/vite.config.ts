import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

/* Which build is this tab running? Vercel sets VERCEL_GIT_COMMIT_SHA at build
 * time; a local build says "dev". Shown at the foot of Profiel so a stale
 * cached bundle is a fact you can read, not a guess. */
const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7);
const day = new Date().toISOString().slice(0, 10);

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
  define: { __LAVEGA_BUILD__: JSON.stringify(`${sha} \u00b7 ${day}`) },
  test: { setupFiles: ["./src/testSetup.ts"] },
});
