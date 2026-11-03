/* Dev-only plugin for the midnight review harness. Added to vite.config.ts only
 * when LAVEGA_PREVIEW=1, and `apply: "serve"` besides, so `vite build` can never
 * include it. It does three things:
 *   1. serves preview.html for /, /app and /app/* (the real app reads its view
 *      from the pathname, so the harness has to live at those URLs);
 *   2. swaps src/posthog.ts for a stub: the real one throws under `vite dev`
 *      without a key and would send events if it had one;
 *   3. points the API base at the same origin, where src/preview/network.ts
 *      answers or refuses every request. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export function previewPlugin(): Plugin {
  return {
    name: "lavega-midnight-preview",
    apply: "serve",
    enforce: "pre",
    config: () => ({
      define: {
        "import.meta.env.VITE_API_URL": JSON.stringify(""),
        "import.meta.env.VITE_RATES_URL": JSON.stringify("/api/rates"),
      },
    }),
    resolveId(source, importer) {
      if (!importer || importer.includes("/src/preview/")) return null;
      if (/(^|\/)posthog(\.js)?$/.test(source)) return here("./src/preview/posthogStub.ts");
      return null;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        const isPage = path === "/" || path === "/app" || path.startsWith("/app/");
        if (!isPage || path.includes(".")) return next();
        const html = await server.transformIndexHtml(
          req.url ?? "/",
          readFileSync(here("./preview.html"), "utf8"),
        );
        res.setHeader("content-type", "text/html");
        res.end(html);
      });
    },
  };
}
