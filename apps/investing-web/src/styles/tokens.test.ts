import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const tokensFile = fileURLToPath(new URL("./tokens.css", import.meta.url));
const tokens = readFileSync(tokensFile, "utf8");

test("tokens.css carries no reference to Google's font CDN", () => {
  expect(tokens).not.toMatch(/googleapis|gstatic/i);
});
