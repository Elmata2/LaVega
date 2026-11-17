import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const listeners: Record<string, (e: unknown) => void> = {};
const shown: { title: string; opts: { data: { url: string } } }[] = [];
runInNewContext(source, {
  URL,
  self: {
    location: { origin: "https://www.lavega.dev" },
    registration: {
      showNotification: (title: string, opts: never) => (
        shown.push({ title, opts }),
        Promise.resolve()
      ),
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
  },
});

const urlFor = (url: unknown) => {
  shown.length = 0;
  listeners.push({
    data: { json: () => ({ title: "t", body: "b", url }) },
    waitUntil: () => undefined,
  });
  return shown[0]!.opts.data.url;
};

test.each(["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", 5, undefined])(
  "push url %s falls back to /app",
  (u) => expect(urlFor(u)).toBe("/app"),
);

test("a same-origin path survives", () => {
  expect(urlFor("/app/forecast?x=1#y")).toBe("/app/forecast?x=1#y");
  expect(urlFor("https://www.lavega.dev/app")).toBe("/app");
});
