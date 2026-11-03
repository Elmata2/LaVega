/*
 * Checks a Build Output API directory for crawler-readability.
 *
 *   node scripts/verify-seo-output.mjs .vercel/output
 *
 * Exits 0 only when every check passes; otherwise prints every failure. It reads
 * the files a crawler would get, not the sources, so it catches a build step
 * that silently did not run (an un-pre-rendered shell, a missing sitemap).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? ".vercel/output");
const staticDir = join(outDir, "static");
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};
const read = (rel) => readFileSync(join(staticDir, rel), "utf8");
const has = (rel) => existsSync(join(staticDir, rel));

/* The hero line comes from the module the pre-render self-check uses (the SSR
 * bundle `pnpm --filter @lavega/web prerender` leaves in dist-ssr), so the
 * expected text cannot drift from landingCopy.ts. */
const { heroFirstLine, faqQuestions } = await import(
  new URL("../apps/web/dist-ssr/prerender.js", import.meta.url).href
);
const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(staticDir)) {
  failures.push(`${staticDir} does not exist`);
} else {
  for (const f of ["robots.txt", "sitemap.xml", "llms.txt"])
    check(has(f), `static/${f} is missing`);

  for (const [locale, rel] of [
    ["nl", "index.html"],
    ["en", "en/index.html"],
  ]) {
    if (!has(rel)) {
      failures.push(`static/${rel} is missing`);
      continue;
    }
    const html = read(rel);
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
    check(
      title !== undefined && title.trim() !== "" && title !== "LaVega",
      `static/${rel}: title is "${title}" (empty or the bare shell title)`,
    );
    check(
      decode(html).includes(heroFirstLine(locale)),
      `static/${rel}: ${locale} hero text "${heroFirstLine(locale)}" not found`,
    );
    for (const q of faqQuestions(locale))
      check(decode(html).includes(q), `static/${rel}: faq question "${q}" not found`);
    check(html.includes(`<html lang="${locale}"`), `static/${rel}: not <html lang="${locale}">`);
  }
  if (has("robots.txt"))
    check(/^Disallow: \/app\s*$/m.test(read("robots.txt")), "robots.txt has no `Disallow: /app`");

  if (has("sitemap.xml")) {
    const xml = read("sitemap.xml");
    const open = (xml.match(/<url>/g) ?? []).length;
    const close = (xml.match(/<\/url>/g) ?? []).length;
    const wellFormed =
      xml.startsWith("<?xml") &&
      /<urlset[\s>]/.test(xml) &&
      /<\/urlset>\s*$/.test(xml) &&
      open === close &&
      open > 0;
    let parsed = wellFormed;
    if (wellFormed) {
      /* A real parser, not a regex: jsdom is a dependency of apps/web. */
      try {
        const { createRequire } = await import("node:module");
        const { JSDOM } = createRequire(new URL("../apps/web/package.json", import.meta.url))(
          "jsdom",
        );
        const doc = new JSDOM(xml, { contentType: "application/xml" }).window.document;
        parsed =
          doc.getElementsByTagName("parsererror").length === 0 &&
          doc.getElementsByTagName("loc").length === open;
      } catch (e) {
        failures.push(`sitemap.xml: parser failed: ${e instanceof Error ? e.message : e}`);
        parsed = true;
      }
    }
    check(parsed, "sitemap.xml is not well-formed XML");
  }

  /* The bare SPA shell that /app and /reset-password are served. */
  if (!has("app-shell.html")) failures.push("static/app-shell.html is missing");
  else
    check(
      read("app-shell.html").includes('<div id="root"></div>'),
      'static/app-shell.html lacks the bare <div id="root"></div> (it must not be pre-rendered)',
    );

  /* config.json: /en routes and overrides. */
  const configPath = join(outDir, "config.json");
  if (!existsSync(configPath)) failures.push("config.json is missing");
  else {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    for (const src of ["/en", "/en/"]) {
      const route = (config.routes ?? []).find((r) => r.src === src && r.dest !== undefined);
      check(
        route?.dest === "/en/index.html",
        `config.json: route ${src} dest is ${route?.dest ?? "absent"}, expected /en/index.html`,
      );
    }
    const spaRoutes = (config.routes ?? []).filter((r) => r.dest === "/index.html");
    check(
      spaRoutes.length === 0,
      `config.json: routes still serve the pre-rendered landing: ${spaRoutes.map((r) => r.src).join(", ")} (want /app-shell.html)`,
    );
    const shellHeader = (config.routes ?? []).find(
      (r) => r.src === "/app-shell.html" && r.headers?.["X-Robots-Tag"] === "noindex",
    );
    check(
      shellHeader !== undefined,
      "config.json: no X-Robots-Tag noindex route for /app-shell.html",
    );
    for (const [file, o] of Object.entries(config.overrides ?? {})) {
      check(has(file), `config.json: override target static/${file} does not exist`);
      check(
        typeof o?.path === "string" && o.path.length > 0,
        `config.json: override for ${file} has no path`,
      );
    }
  }

  /* Every html file in the output. The investing app is an SPA shell by design
   * and not content, so it is only held to the DRAFT/TODO rules; app-shell.html is checked above. */
  for (const file of walk(staticDir).filter((f) => f.endsWith(".html"))) {
    const rel = file.slice(staticDir.length + 1);
    const html = readFileSync(file, "utf8");
    check(!html.includes("DRAFT"), `${rel}: contains DRAFT`);
    check(!html.includes("[[TODO"), `${rel}: contains [[TODO`);
    if (rel.startsWith("investing/") || rel === "app-shell.html") continue;
    {
      const h1s = (html.match(/<h1[\s>]/g) ?? []).length;
      check(h1s === 1, `${rel}: ${h1s} <h1> (expected exactly 1)`);
      check(/<link[^>]+rel="canonical"[^>]*>/.test(html), `${rel}: no canonical link`);
      const blocks = [
        ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
      ];
      for (const [, body] of blocks) {
        try {
          JSON.parse(body);
        } catch {
          failures.push(`${rel}: JSON-LD does not parse`);
        }
      }
      if (rel !== "index.html" && rel !== "en/index.html")
        check(blocks.length > 0, `${rel}: no JSON-LD`);
    }
  }
}

if (failures.length) {
  console.error(`verify-seo-output: ${failures.length} failure(s) in ${outDir}`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`verify-seo-output: OK (${outDir})`);
