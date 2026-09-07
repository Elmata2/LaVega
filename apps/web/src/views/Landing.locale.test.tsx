import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import Landing from "./Landing";

/* CardSpiral drives GSAP against a real scroller; it has nothing to say about
 * copy, so it is stubbed out rather than rendered. */
vi.mock("./CardSpiral", () => ({ default: () => null }));

const html = (locale?: "nl" | "en") =>
  renderToStaticMarkup(<Landing onEnter={() => {}} {...(locale ? { locale } : {})} />);

test("the landing page renders in Dutch by default", () => {
  const out = html();
  expect(out).toContain("één helder getal.");
  expect(out).toContain("Inloggen");
  expect(out).toContain("Veelgestelde vragen");
});

test("the same page renders in English at the other locale", () => {
  const out = html("en");
  expect(out).toContain("one clear number.");
  expect(out).toContain("Sign in");
  expect(out).toContain("Frequently asked questions");
});

test("no Dutch copy is left behind on the English page", () => {
  const out = html("en");
  for (const dutch of [
    "Veelgestelde vragen", "Inloggen", "Kom op de wachtlijst", "Hoe het werkt",
    "Jouw data blijft van jou", "Wees er als eerste bij", "Zet me op de lijst",
    "Alleen-lezen bankkoppeling", "Facturen-agent", "Belasting-agent",
    "van student tot ondernemer", "Voorwaarden", "Juridisch",
  ]) {
    expect(out, `English page still contains: ${dutch}`).not.toContain(dutch);
  }
});

test("the Dutch page is untouched by the English one existing", () => {
  const out = html("nl");
  for (const english of ["one clear number.", "Sign in", "Join the waitlist", "Frequently asked questions"]) {
    expect(out, `Dutch page leaked English: ${english}`).not.toContain(english);
  }
});

test("each page offers the other, and marks the link with its language", () => {
  // HTML attribute names are case-insensitive and React's SSR keeps the JSX
  // spelling, so the assertion matches on either.
  expect(html("nl")).toContain('href="/en"');
  expect(html("nl").toLowerCase()).toContain('hreflang="en"');
  expect(html("en").toLowerCase()).toContain('hreflang="nl"');
  expect(html("en")).toContain('>Nederlands<');
  expect(html("nl")).toContain('>English<');
});

test("the agent cards translate, rather than only their headings", () => {
  const out = html("en");
  expect(out).toContain("Invoice agent");
  expect(out).toContain("Drop in a PDF invoice");
});
