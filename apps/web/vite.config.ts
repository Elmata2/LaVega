import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Which build is this tab running? Vercel sets VERCEL_GIT_COMMIT_SHA at build
 * time; a local build says "dev". Shown at the foot of Profiel so a stale
 * cached bundle is a fact you can read, not a guess. */
const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7);
const day = new Date().toISOString().slice(0, 10);

export default defineConfig({
  plugins: [react()],
  define: { __LAVEGA_BUILD__: JSON.stringify(`${sha} \u00b7 ${day}`) },
});
