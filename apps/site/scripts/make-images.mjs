// Renders brand PNGs with headless Chrome. Run: pnpm --filter @lavega/site exec tsx scripts/make-images.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { landingCopy } from "../../web/src/landingCopy.ts";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const serif = resolve(repo, "apps/site/assets/fonts/libron-regular.woff2");
const logo = resolve(repo, "LaVega_wordmark_hires_white.png");
const outBrand = resolve(here, "../assets/brand");
const outOg = resolve(here, "../assets/og");
mkdirSync(outBrand, { recursive: true });
mkdirSync(outOg, { recursive: true });

const headline = (locale) => {
  const title = landingCopy(locale).meta.title.replace(/^LaVega:\s*/, "");
  return title.charAt(0).toUpperCase() + title.slice(1);
};

const tmp = mkdtempSync(join(tmpdir(), "lavega-og-"));
const url = (p) => pathToFileURL(p).href;

function shot(pageUrl, out, w, h) {
  try {
    execFileSync(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--default-background-color=00000000",
        `--screenshot=${out}`,
        `--window-size=${w},${h}`,
        "--virtual-time-budget=3000",
        pageUrl,
      ],
      { stdio: "ignore" },
    );
  } catch (error) {
    /* Headless Chrome on macOS writes the screenshot and then trips its teardown
     * watchdog, exiting non-zero ("Teardown watchdog expired"). The image is
     * already on disk, so accept a written, non-empty PNG instead of failing the
     * whole run; anything else (no file, empty file) is still an error. */
    if (!isWrittenPng(out)) throw error;
  }
  if (!isWrittenPng(out)) throw new Error(`headless Chrome wrote no screenshot to ${out}`);
}

function isWrittenPng(file) {
  try {
    const head = readFileSync(file).subarray(0, 8);
    return statSync(file).size > 0 && head.equals(PNG_SIGNATURE);
  } catch {
    return false;
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const template = readFileSync(resolve(here, "og-card.html"), "utf8")
  .replace("__LIBRON_400__", url(serif))
  .replace("__LOGO__", url(logo));
const card = join(tmp, "og-card.html");
writeFileSync(card, template);

for (const locale of ["nl", "en"]) {
  const q = new URLSearchParams({ locale, title: headline(locale) });
  shot(`${url(card)}?${q}`, resolve(outOg, `og-${locale}.png`), 1200, 630);
}

const wm = join(tmp, "wordmark.html");
writeFileSync(
  wm,
  `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:400px;height:130px;overflow:hidden;background:#02070a}
img{display:block;position:absolute;left:-100px;top:-20px;width:600px;height:175px;filter:grayscale(1) invert(1) brightness(1.1);mix-blend-mode:screen}
</style><img src="${url(logo)}" alt="">`,
);
shot(url(wm), resolve(outBrand, "wordmark.png"), 400, 130);
console.log("done");
