import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const tokensFile = fileURLToPath(new URL("./tokens.css", import.meta.url));
const tokens = readFileSync(tokensFile, "utf8");

test("tokens.css carries no reference to Google's font CDN", () => {
  expect(tokens).not.toMatch(/googleapis|gstatic/i);
});

test("tokens.css self-hosts EB Garamond and Inter via @fontsource", () => {
  expect(tokens).toMatch(/@import\s+["']@fontsource\/eb-garamond\/500\.css["'];/);
  expect(tokens).toMatch(/@import\s+["']@fontsource\/eb-garamond\/600\.css["'];/);
  expect(tokens).toMatch(/@import\s+["']@fontsource\/eb-garamond\/700\.css["'];/);
  expect(tokens).toMatch(/@import\s+["']@fontsource\/inter\/400\.css["'];/);
  expect(tokens).toMatch(/@import\s+["']@fontsource\/inter\/500\.css["'];/);
  expect(tokens).toMatch(/@import\s+["']@fontsource\/inter\/600\.css["'];/);
  expect(tokens).toMatch(/@import\s+["']@fontsource\/inter\/700\.css["'];/);
});
