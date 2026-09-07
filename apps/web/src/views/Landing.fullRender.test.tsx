import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import Landing from "./Landing";

/* Landing.locale.test.tsx stubs out CardSpiral, which is why its hardcoded
 * Dutch aria-label and tagline slipped past that test. This renders the real
 * component tree, GSAP's `useEffect` included — `renderToStaticMarkup` never
 * runs effects, so the dynamic `import("gsap")` inside CardSpiral never
 * fires and the resting-fan markup renders synchronously. */
const html = (locale?: "nl" | "en") =>
  renderToStaticMarkup(<Landing onEnter={() => {}} {...(locale ? { locale } : {})} />);

test("the full page, CardSpiral included, carries no Dutch text on the English page", () => {
  const out = html("en");
  for (const dutch of ["Slimmer met je geld", "Niet méér uitgeven"]) {
    expect(out, `English page still contains: ${dutch}`).not.toContain(dutch);
  }
});

test("the full page, CardSpiral included, keeps its Dutch text on the Dutch page", () => {
  const out = html("nl");
  expect(out).toContain("Slimmer met je geld");
  expect(out).toContain("Niet méér uitgeven");
});
