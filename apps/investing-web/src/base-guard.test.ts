import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  assertHtmlMatchesBase,
  collectAssetRefs,
  findBaseViolations,
  normalizeBase,
} from "./base-guard";

/* The exact index.html that shipped to lavega.dev and rendered a blank page:
 * built with base "/" while being served under "/investing/". Kept verbatim,
 * asset hashes and all, so this file is a record of the real defect and not a
 * paraphrase of it. Any change to the guard has to keep rejecting this. */
const SHIPPED_BROKEN = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LaVega Investing</title>
    <script type="module" crossorigin src="/assets/index-DQzV9ttd.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-CLKdSLqH.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

/* The same app built with the base it is actually served under. */
const BUILT_WITH_BASE = SHIPPED_BROKEN.replaceAll('"/assets/', '"/investing/assets/');

test("the HTML that shipped blank is rejected against the base it was served under", () => {
  const violations = findBaseViolations(SHIPPED_BROKEN, "/investing/");
  expect(violations).toEqual([
    { attribute: "src", url: "/assets/index-DQzV9ttd.js" },
    { attribute: "href", url: "/assets/index-CLKdSLqH.css" },
  ]);
  expect(() => assertHtmlMatchesBase(SHIPPED_BROKEN, "/investing/", "dist/index.html")).toThrow(
    /2 of 2 asset URLs do not start with the base "\/investing\/"/,
  );
  // The message has to name the offending URLs — that is what turns a red build
  // into a diagnosis instead of a puzzle.
  expect(() => assertHtmlMatchesBase(SHIPPED_BROKEN, "/investing/")).toThrow(
    /src="\/assets\/index-DQzV9ttd\.js"/,
  );
});

test("that same HTML is correct for the standalone deploy, which serves at the root", () => {
  // Dockerfile.investing builds this app for its own origin with no prefix, so
  // absolute /assets/ URLs are right there. The guard judges against the base
  // it is given, not against /investing/ as a constant.
  expect(findBaseViolations(SHIPPED_BROKEN, "/")).toEqual([]);
  expect(() => assertHtmlMatchesBase(SHIPPED_BROKEN, "/")).not.toThrow();
});

test("a build that honoured the base passes", () => {
  expect(findBaseViolations(BUILT_WITH_BASE, "/investing/")).toEqual([]);
  expect(() => assertHtmlMatchesBase(BUILT_WITH_BASE, "/investing/")).not.toThrow();
  // …and is then wrong for the root deploy, which is the same check in reverse.
  expect(findBaseViolations(BUILT_WITH_BASE, "/")).toEqual([]);
});

test("a sibling path is not accepted as the base", () => {
  const html = `<script src="/investinganders/assets/app.js"></script>`;
  expect(normalizeBase("/investing")).toBe("/investing/");
  expect(findBaseViolations(html, "/investing")).toEqual([
    { attribute: "src", url: "/investinganders/assets/app.js" },
  ]);
});

test("URLs the base does not apply to are left alone", () => {
  const html = [
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`,
    `<script src="//cdn.example.com/x.js"></script>`,
    `<img src="data:image/svg+xml,<svg/>">`,
    `<a href="#hoofdinhoud">Naar de inhoud</a>`,
    `<a href="mailto:info@lavega.dev">Mail</a>`,
    `<script type="module" crossorigin src="/investing/assets/index.js"></script>`,
  ].join("\n");
  expect(collectAssetRefs(html)).toEqual([{ attribute: "src", url: "/investing/assets/index.js" }]);
  expect(() => assertHtmlMatchesBase(html, "/investing/")).not.toThrow();
});

test("an HTML file with nothing to check fails instead of passing vacuously", () => {
  const shell = `<!doctype html><html><head><title>LaVega Investing</title></head><body><div id="root"></div></body></html>`;
  expect(() => assertHtmlMatchesBase(shell, "/investing/", "dist/index.html")).toThrow(
    /found no asset URLs to check/,
  );
});

/* The deploy gate. `pnpm --filter @lavega/investing-web verify:base` runs this
 * file with LAVEGA_EXPECT_INVESTING_BASE set to the path the image serves the
 * app under; the root Dockerfile runs it after the build. The expectation is
 * passed in deliberately rather than read back from VITE_INVESTING_BASE: the
 * original bug WAS that variable going missing, and a check that reads the same
 * missing variable would have agreed with the broken build. */
const distFile = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const expectedBase = process.env.LAVEGA_EXPECT_INVESTING_BASE;

test("the emitted dist/index.html agrees with the base the deploy serves it under", () => {
  if (!existsSync(distFile)) {
    // No build in the tree — fine on a developer machine, never fine in the
    // image, where the expectation is always set.
    expect(
      expectedBase,
      `no build at ${distFile}: build the app before verifying its base`,
    ).toBeUndefined();
    return;
  }
  const base = expectedBase ?? process.env.VITE_INVESTING_BASE ?? "/";
  assertHtmlMatchesBase(readFileSync(distFile, "utf8"), base, "apps/investing-web/dist/index.html");
});
