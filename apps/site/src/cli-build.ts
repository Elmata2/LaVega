import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, normalize, resolve, sep } from "node:path";
import { Effect, Schema } from "effect";
import { BuildWriteError, buildSite } from "./build";
import { urlFor, type Page } from "./content";
import { esc } from "./render";
import { runCli } from "./run";

class OverridesInsideOutDirError extends Schema.TaggedError<OverridesInsideOutDirError>()(
  "OverridesInsideOutDirError",
  { file: Schema.String, outDir: Schema.String },
) {
  override get message(): string {
    return `--overrides ${this.file} is inside the output directory ${this.outDir}, which would publish it`;
  }
}

const ORIGIN = "https://www.lavega.dev";
const PORT = 4321;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const outDir = resolve(value("out") ?? "dist");
const contentDir = resolve(value("content") ?? "../../content");
const overridesFile = value("overrides") === undefined ? undefined : resolve(value("overrides")!);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function indexPage(pages: Page[]): string {
  const items = pages
    .map(
      (p) =>
        `<li><a href="${esc(urlFor(p))}">${esc(urlFor(p))}</a> ${p.status === "draft" ? "(draft) " : ""}${esc(p.title)}</li>`,
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Preview</title><link rel="stylesheet" href="/site.css"><main><h1>Preview: ${pages.length} pages</h1><ul>${items}</ul></main>`;
}

/** Preview only: serve outDir on loopback, `/x` resolving to `x.html`. */
function serve(pages: Page[]): Effect.Effect<never> {
  const listing = indexPage(pages);
  return Effect.callback<never>(() => {
    const server = createServer((req, res) => {
      let path: string;
      try {
        path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
      } catch {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("bad request");
        return;
      }
      if (path === "/") {
        res.writeHead(200, { "content-type": TYPES[".html"] });
        res.end(listing);
        return;
      }
      const rel = normalize(path).replace(/^([/\\]|\.\.[/\\])+/, "");
      const candidates = [resolve(outDir, rel), resolve(outDir, `${rel}.html`)];
      const file = candidates.find(
        (c) => c.startsWith(outDir + sep) && existsSync(c) && statSync(c).isFile(),
      );
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
    server.listen(PORT, "127.0.0.1", () => console.log(`preview on http://127.0.0.1:${PORT}`));
    return Effect.sync(() => {
      server.close();
    });
  });
}

const program = Effect.gen(function* () {
  if (
    overridesFile !== undefined &&
    (overridesFile === outDir || overridesFile.startsWith(outDir + sep))
  )
    return yield* Effect.fail(new OverridesInsideOutDirError({ file: overridesFile, outDir }));
  const { pages, overrides } = yield* buildSite({
    contentDir,
    outDir,
    drafts: flag("drafts"),
    origin: ORIGIN,
    /* --no-clean: the output dir already holds something that must survive (the
     * web app's static files in the Vercel build). */
    clean: !flag("no-clean"),
  });
  if (overridesFile !== undefined) {
    yield* Effect.try({
      try: () => {
        mkdirSync(dirname(overridesFile), { recursive: true });
        writeFileSync(overridesFile, JSON.stringify(overrides, null, 2) + "\n");
      },
      catch: (e) =>
        new BuildWriteError({
          path: overridesFile,
          reason: e instanceof Error ? e.message : String(e),
        }),
    });
  }
  console.log(`built ${pages.length} pages to ${outDir}`);
  if (flag("serve")) return yield* serve(pages);
  return 0;
});

await runCli(program);
