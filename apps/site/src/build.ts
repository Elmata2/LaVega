import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { checkPages, type Finding } from "./check";
import {
  hubUrl,
  loadPages,
  urlFor,
  type ContentParseError,
  type ContentReadError,
  type DuplicateContentError,
  type Family,
  type Locale,
  type Page,
} from "./content";
import { SITE_FACTS } from "./facts";
import { renderHub, renderPage } from "./render";
import { llmsTxt, robotsTxt, sitemapXml } from "./seoFiles";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(HERE, "..");
const HTML = "text/html; charset=utf-8";
const FAMILIES: readonly Family[] = ["vragen", "gids", "vs", "seizoen", "over", "onderzoek"];
const LOCALES: readonly Locale[] = ["nl", "en"];

export type BuildOptions = {
  contentDir: string;
  outDir: string;
  drafts: boolean;
  origin: string;
  /** Remove outDir before writing. Off when outDir already holds other files (Vercel's static output). */
  clean: boolean;
};
export type Override = { path: string; contentType: string };
export type BuildResult = {
  overrides: Record<string, Override>;
  /** Every page that was rendered, for the preview index. */
  pages: Page[];
};

/** A published page broke a content rule; nothing was written. */
export class PublishedFindingsError extends Schema.TaggedError<PublishedFindingsError>()(
  "PublishedFindingsError",
  { findings: Schema.Array(Schema.Struct({ file: Schema.String, rule: Schema.String, detail: Schema.String })) },
) {
  override get message(): string {
    return this.findings.map((f) => `${f.file} [${f.rule}] ${f.detail}`).join("\n");
  }
}

/** Writing the build output failed. */
export class BuildWriteError extends Schema.TaggedError<BuildWriteError>()("BuildWriteError", {
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `${this.path}: ${this.reason}`;
  }
}

/** `clean` was asked for on a directory that must never be deleted. */
export class UnsafeCleanError extends Schema.TaggedError<UnsafeCleanError>()("UnsafeCleanError", {
  outDir: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `refusing to clean ${this.outDir}: ${this.reason}`;
  }
}

export type BuildError =
  | UnsafeCleanError
  | ContentReadError
  | ContentParseError
  | DuplicateContentError
  | PublishedFindingsError
  | BuildWriteError;

const REPO_ROOT = resolve(SITE_ROOT, "../..");

const isWithin = (inner: string, outer: string) =>
  inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);

/** Why outDir may not be deleted, or undefined when it may. */
function unsafeToClean(outDir: string, contentDir: string): string | undefined {
  const out = resolve(outDir);
  const content = resolve(contentDir);
  if (out === resolve(process.cwd())) return "it is the working directory";
  if (out === REPO_ROOT) return "it is the repo root";
  if (isWithin(content, out)) return "it is, or contains, the content directory";
  if (isWithin(REPO_ROOT, out)) return "it contains the repo root";
  return undefined;
}

const write = <A>(path: string, f: () => A) =>
  Effect.try({
    try: f,
    catch: (e) =>
      new BuildWriteError({ path, reason: e instanceof Error ? e.message : String(e) }),
  });

/**
 * Render the content tree to static files in outDir. Production (drafts false)
 * writes published pages only. `overrides` maps each written .html file to its
 * clean url path, in the shape Vercel's build output wants.
 */
export const buildSite = Effect.fn("buildSite")(function* (
  opts: BuildOptions,
): Effect.fn.Return<BuildResult, BuildError> {
  const unsafe = opts.clean ? unsafeToClean(opts.outDir, opts.contentDir) : undefined;
  if (unsafe !== undefined) return yield* new UnsafeCleanError({ outDir: opts.outDir, reason: unsafe });

  const everything = yield* loadPages(opts.contentDir, { drafts: true });

  const status = new Map(everything.map((p) => [p.file, p.status]));
  const blocking = checkPages(everything).filter((f: Finding) => status.get(f.file) === "published");
  if (blocking.length) return yield* new PublishedFindingsError({ findings: blocking });

  const pages = opts.drafts ? everything : everything.filter((p) => p.status === "published");
  const overrides: Record<string, Override> = {};

  const emit = (urlPath: string, html: string) => {
    const rel = `${urlPath.replace(/^\//, "")}.html`;
    const target = join(opts.outDir, rel);
    return write(target, () => {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, html);
      overrides[rel] = { path: rel.slice(0, -".html".length), contentType: HTML };
    });
  };

  yield* write(opts.outDir, () => {
    if (opts.clean) rmSync(opts.outDir, { recursive: true, force: true });
    mkdirSync(opts.outDir, { recursive: true });
  });

  const renderOpts = { origin: opts.origin, draft: opts.drafts };
  for (const p of pages) yield* emit(urlFor(p), renderPage(p, pages, renderOpts));

  for (const locale of LOCALES) {
    for (const family of FAMILIES) {
      if (!pages.some((p) => p.locale === locale && p.family === family)) continue;
      yield* emit(hubUrl(locale, family), renderHub(locale, family, pages, { origin: opts.origin }));
    }
  }

  yield* write(opts.outDir, () => {
    writeFileSync(join(opts.outDir, "robots.txt"), robotsTxt(opts.origin));
    writeFileSync(join(opts.outDir, "sitemap.xml"), sitemapXml(pages, opts.origin));
    writeFileSync(join(opts.outDir, "llms.txt"), llmsTxt(pages, SITE_FACTS, opts.origin));
    cpSync(join(HERE, "site.css"), join(opts.outDir, "site.css"));
    const assets = join(SITE_ROOT, "assets");
    if (existsSync(assets)) cpSync(assets, opts.outDir, { recursive: true });
  });

  return { overrides, pages };
});
