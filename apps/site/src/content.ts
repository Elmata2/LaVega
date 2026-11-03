import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { Effect, Schema } from "effect";
import { parse as parseYaml } from "yaml";

export type Locale = "nl" | "en";
export type Family = "vragen" | "gids" | "vs" | "seizoen" | "over" | "onderzoek";
export type Source = { title: string; url: string; accessed: string };
export type Page = {
  file: string;
  locale: Locale;
  family: Family;
  slug: string;
  id: string;
  title: string;
  description: string;
  status: "draft" | "published";
  author: string;
  updated: string;
  sources: Source[];
  faq: { q: string; a: string }[];
  bodyMarkdown: string;
};

const LOCALES: readonly Locale[] = ["nl", "en"];
const FAMILIES: readonly Family[] = ["vragen", "gids", "vs", "seizoen", "over", "onderzoek"];

const FAMILY_SEGMENT: Record<Locale, Record<Family, string>> = {
  nl: {
    vragen: "vragen",
    gids: "gids",
    vs: "vs",
    seizoen: "seizoen",
    over: "over",
    onderzoek: "onderzoek",
  },
  en: {
    vragen: "questions",
    gids: "guides",
    vs: "vs",
    seizoen: "seasonal",
    over: "about",
    onderzoek: "research",
  },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function hubUrl(locale: Locale, family: Family): string {
  const prefix = locale === "en" ? "/en" : "";
  return `${prefix}/${FAMILY_SEGMENT[locale][family]}`;
}

export function urlFor(p: Pick<Page, "locale" | "family" | "slug">): string {
  return `${hubUrl(p.locale, p.family)}/${p.slug}`;
}

/** A content file that cannot become a Page. `file` is the path as given. */
export class ContentParseError extends Schema.TaggedError<ContentParseError>()(
  "ContentParseError",
  { file: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `${this.file}: ${this.reason}`;
  }
}

/** Two files claim the same url or the same (locale, id). */
export class DuplicateContentError extends Schema.TaggedError<DuplicateContentError>()(
  "DuplicateContentError",
  { files: Schema.Array(Schema.String), reason: Schema.String },
) {
  override get message(): string {
    return `${this.reason}: ${this.files.join(" and ")}`;
  }
}

/** The content directory or a file in it could not be read. */
export class ContentReadError extends Schema.TaggedError<ContentReadError>()(
  "ContentReadError",
  { path: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `${this.path}: ${this.reason}`;
  }
}

const Text = Schema.String.check(Schema.isPattern(/\S/));
const IsoDate = Schema.String.check(Schema.isPattern(DATE));
const HttpUrl = Schema.String.check(Schema.isPattern(/^https?:\/\//i));

const SourceSchema = Schema.Struct({ title: Text, url: HttpUrl, accessed: IsoDate });
const FaqSchema = Schema.Struct({ q: Text, a: Text });

/** The YAML front matter of a content file, as decoded. */
export class FrontMatter extends Schema.Class<FrontMatter>("lavega/site/FrontMatter")({
  id: Text,
  title: Text,
  description: Text,
  status: Schema.Literals(["draft", "published"]),
  author: Text,
  updated: IsoDate,
  family: Schema.optionalKey(Schema.Literals(FAMILIES)),
  sources: Schema.optionalKey(Schema.Array(SourceSchema)),
  faq: Schema.optionalKey(Schema.Array(FaqSchema)),
}) {}

const decodeFrontMatter = Schema.decodeUnknownEffect(FrontMatter);

/** YAML 1.1 parsers turn bare dates into Date objects; the schema wants the text. */
function dateToText(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(dateToText);
  if (typeof v === "object" && v !== null)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dateToText(x)]));
  return v;
}

function splitFrontMatter(raw: string): { yaml: string; body: string } | undefined {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  return m ? { yaml: m[1] ?? "", body: m[2] ?? "" } : undefined;
}

function pathParts(file: string): { locale: Locale; family: Family; slug: string } | string {
  const parts = file.split(/[\\/]/);
  const slug = (parts.pop() ?? "").replace(/\.md$/, "");
  const family = parts.pop();
  const locale = parts.pop();
  if (!LOCALES.includes(locale as Locale))
    return `path must be <locale>/<family>/<slug>.md with locale nl or en (got "${locale}")`;
  if (!FAMILIES.includes(family as Family)) return `unknown content family "${family}"`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return `invalid slug "${slug}"`;
  return { locale: locale as Locale, family: family as Family, slug };
}

/** Parse one content file. Fails with ContentParseError naming the file. */
export const parsePage = Effect.fn("parsePage")(function* (
  file: string,
  raw: string,
): Effect.fn.Return<Page, ContentParseError> {
  const fail = (reason: string) => new ContentParseError({ file, reason });

  const where = pathParts(file);
  if (typeof where === "string") return yield* fail(where);
  const { locale, family, slug } = where;

  const parts = splitFrontMatter(raw);
  if (!parts) return yield* fail("missing front matter block (--- ... ---)");

  const data = yield* Effect.try({
    try: (): unknown => parseYaml(parts.yaml),
    catch: (e) => fail(`invalid YAML front matter: ${e instanceof Error ? e.message : String(e)}`),
  });
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return yield* fail("front matter must be a YAML mapping");

  const fm = yield* decodeFrontMatter(dateToText(data)).pipe(
    Effect.mapError((e) => fail(`invalid front matter: ${e.message}`)),
  );
  if (fm.family !== undefined && fm.family !== family)
    return yield* fail(
      `front matter family "${fm.family}" disagrees with the path ("${family}")`,
    );

  return {
    file,
    locale,
    family,
    slug,
    id: fm.id,
    title: fm.title,
    description: fm.description,
    status: fm.status,
    author: fm.author,
    updated: fm.updated,
    sources: (fm.sources ?? []).map((s) => ({ ...s })),
    faq: (fm.faq ?? []).map((f) => ({ ...f })),
    bodyMarkdown: parts.body.replace(/^\s*\n/, ""),
  };
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

const io = <A>(path: string, f: () => A) =>
  Effect.try({
    try: f,
    catch: (e) =>
      new ContentReadError({ path, reason: e instanceof Error ? e.message : String(e) }),
  });

/** Read and parse every .md under contentDir. The Node fs calls live here, at the one read boundary. */
export const loadPages = Effect.fn("loadPages")(function* (
  contentDir: string,
  opts: { drafts: boolean },
): Effect.fn.Return<Page[], ContentReadError | ContentParseError | DuplicateContentError> {
  const files = yield* Effect.try({
    try: () => walk(contentDir),
    catch: (e) =>
      new ContentReadError({
        path: contentDir,
        reason:
          e instanceof Error && "code" in e && e.code === "ENOENT"
            ? "content directory not found; the site build reads its pages from here, so it must exist (an empty directory builds a site with no pages)"
            : e instanceof Error
              ? e.message
              : String(e),
      }),
  });
  const pages: Page[] = [];
  for (const f of files) {
    const raw = yield* io(f, () => readFileSync(f, "utf8"));
    pages.push(yield* parsePage(f.split(sep).join("/"), raw));
  }

  const byUrl = new Map<string, Page>();
  const byId = new Map<string, Page>();
  for (const p of pages) {
    const url = urlFor(p);
    const sameUrl = byUrl.get(url);
    if (sameUrl)
      return yield* new DuplicateContentError({
        files: [sameUrl.file, p.file],
        reason: `duplicate url ${url}`,
      });
    byUrl.set(url, p);
    const key = `${p.locale}:${p.id}`;
    const sameId = byId.get(key);
    if (sameId)
      return yield* new DuplicateContentError({
        files: [sameId.file, p.file],
        reason: `duplicate id "${p.id}" in locale ${p.locale}`,
      });
    byId.set(key, p);
  }

  return pages
    .filter((p) => opts.drafts || p.status === "published")
    .sort((a, b) => urlFor(a).localeCompare(urlFor(b)));
});

export function counterpart(p: Page, all: Page[]): Page | undefined {
  return all.find((o) => o.id === p.id && o.locale !== p.locale);
}

/** hreflang pairs for a family hub: only when both locales have a hub, nl first, x-default is nl. Same list for the hub's HTML and the sitemap. */
export function hubAlternates(pages: Page[], family: Family): { hreflang: string; path: string }[] {
  const has = (locale: Locale) => pages.some((p) => p.locale === locale && p.family === family);
  if (!has("nl") || !has("en")) return [];
  return [
    { hreflang: "nl", path: hubUrl("nl", family) },
    { hreflang: "en", path: hubUrl("en", family) },
    { hreflang: "x-default", path: hubUrl("nl", family) },
  ];
}

/** Hubs that get built: one per (locale, family) with at least one page in `pages`. */
export function builtHubs(pages: Page[]): Set<string> {
  return new Set(pages.map((p) => hubUrl(p.locale, p.family)));
}
