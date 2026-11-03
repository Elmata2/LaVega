// Saves the bare shell as dist/app-shell.html, then fills dist/index.html (nl) and dist/en/index.html (en) with crawler-readable
// landing markup and head tags. Run after `vite build` and `vite build --ssr`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://www.lavega.dev";
const shell = readFileSync(resolve(root, "dist/index.html"), "utf8");
for (const marker of ["<title>LaVega</title>", '<div id="root"></div>', "<html lang="])
  if (!shell.includes(marker))
    throw new Error(`dist/index.html is missing ${marker}; run "vite build" first (pre-render is not re-runnable)`);

/* index.html is about to become the Dutch landing page. Every other SPA route
 * (/app, /app/*, /reset-password, /app?error) still needs the untouched shell, so
 * keep it: those routes point at app-shell.html (scripts/vercel-build.mjs and
 * apps/server). Without it a signed-in user would see the landing flash and the
 * landing title would stick to the app. */
writeFileSync(resolve(root, "dist/app-shell.html"), shell);

const targets = [
  { locale: "nl", path: "/", out: "dist/index.html" },
  { locale: "en", path: "/en", out: "dist/en/index.html" },
];

const decodeHtml = (x) =>
  x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const h1FirstRun = (html) => decodeHtml(/<h1[^>]*>([^<]*)/.exec(html)?.[1] ?? "");
let mod;
for (const t of targets) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `${ORIGIN}${t.path}`,
  });
  const g = globalThis;
  const saved = {};
  for (const k of ["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage"]) {
    saved[k] = Object.getOwnPropertyDescriptor(g, k);
    Object.defineProperty(g, k, { value: dom.window[k], configurable: true, writable: true });
  }
  try {
    mod ??= await import(pathToFileURL(resolve(root, "dist-ssr/prerender.js")).href);
    const html = shell
      .replace("<title>LaVega</title>", () => mod.landingHead(t.locale, ORIGIN))
      .replace('<div id="root"></div>', () => `<div id="root">${mod.renderLanding(t.locale)}</div>`)
      .replace(/<html lang="[^"]*"/, () => `<html lang="${t.locale}"`);
    const file = resolve(root, t.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    const out = readFileSync(file, "utf8");
    const h1s = (out.match(/<h1[\s>]/g) ?? []).length;
    const checks = [
      [h1s === 1, `exactly one <h1 (found ${h1s})`],
      [out.includes(`<html lang="${t.locale}"`), `<html lang="${t.locale}">`],
      [out.includes('http-equiv="Content-Security-Policy"'), "CSP meta"],
      [h1FirstRun(out) === mod.heroFirstLine(t.locale), `h1 starts with "${mod.heroFirstLine(t.locale)}" (found "${h1FirstRun(out)}")`],
    ];
    for (const [ok, what] of checks) if (!ok) throw new Error(`${t.out}: self-check failed: ${what}`);
    console.log(`prerendered ${t.locale} -> ${t.out} (${html.length} bytes)`);
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(g, k, d);
      else delete g[k];
    }
    dom.window.close();
  }
}
