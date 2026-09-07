import { expect, test } from "vitest";
import { LANDING_COPY, landingCopy } from "./landingCopy.js";
import type { Locale } from "./locale.js";

const LOCALES: Locale[] = ["nl", "en"];

/** Every leaf string in a copy tree, with its path — so a gap is nameable. */
function leaves(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

test("both languages carry exactly the same keys", () => {
  const [nl, en] = LOCALES.map((l) => leaves(landingCopy(l)).map(([k]) => k).sort());
  expect(en).toEqual(nl);
});

test("no string is empty or left as a placeholder", () => {
  for (const locale of LOCALES) {
    for (const [path, text] of leaves(landingCopy(locale))) {
      expect(text.trim(), `${locale}.${path} is empty`).not.toBe("");
      expect(text, `${locale}.${path} looks like a placeholder`).not.toMatch(/TODO|TRANSLATE|XXX|\[.*\]/i);
    }
  }
});

test("the English copy is not just the Dutch copy", () => {
  const nl = new Map(leaves(landingCopy("nl")));
  const en = new Map(leaves(landingCopy("en")));
  // Some strings are legitimately identical across both — brand and loanwords.
  const SHARED = new Set(["nav.agents", "nav.privacy", "nav.investing", "faq.eyebrow", "footer.product", "footer.privacy"]);
  const untranslated = [...nl.entries()].filter(([k, v]) => !SHARED.has(k) && en.get(k) === v);
  expect(untranslated.map(([k]) => k)).toEqual([]);
});

test("the English hero does not inherit the Dutch market segment", () => {
  // "van student tot ondernemer" is a Dutch positioning line; the English page
  // is read by investors and partners, for whom it means nothing.
  expect(landingCopy("en").footer.note).not.toMatch(/student/i);
  expect(landingCopy("en").faq.items.map((i) => i.a).join(" ")).not.toMatch(/student/i);
});

test("the waitlist email placeholder is not a .nl address on the English page", () => {
  expect(landingCopy("nl").waitlist.emailPlaceholder).toContain(".nl");
  expect(landingCopy("en").waitlist.emailPlaceholder).not.toContain(".nl");
});

test("LANDING_COPY covers every locale the app can route to", () => {
  expect(Object.keys(LANDING_COPY).sort()).toEqual([...LOCALES].sort());
});
