import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import NavBar from "./NavBar";
import { enabledModules, navModules } from "./moduleRegistry";
import { shellCopy } from "../copy/shell.js";

/* Every other suite is pinned to Dutch by `testSetup.ts`, because that is the
 * language its assertions were written in. That leaves the English screens
 * proven only by the type system, which cannot tell whether the cookie
 * actually reaches a component. This file is the one place that flips the
 * cookie and reads the rendered output, so "English works" is a measured
 * fact rather than an inference.
 *
 * Node environment, like NavBar.test.tsx: `renderToStaticMarkup` never
 * touches `document`, and `useAppLocale` only needs `document.cookie`. */

function setCookie(locale: string) {
  (globalThis as unknown as { document: { cookie: string } }).document = {
    cookie: `lavega_locale=${locale}`,
  };
}

beforeEach(() => setCookie("en"));
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

function nav() {
  return renderToStaticMarkup(
    <NavBar
      view="overview"
      modules={navModules(enabledModules(["overview", "valuta"]))}
      onNavigate={() => {}}
      onOpenProfile={() => {}}
    />,
  );
}

test("the cookie reaches the component and the nav renders English", () => {
  const html = nav();
  expect(html).toContain(shellCopy.en.nav.moduleLabels.overview);
  expect(html).not.toContain(shellCopy.nl.nav.moduleLabels.overview);
});

test("the same component renders Dutch when the cookie says so", () => {
  setCookie("nl");
  const html = nav();
  expect(html).toContain(shellCopy.nl.nav.moduleLabels.overview);
});

test("the two languages do not render the same nav", () => {
  const en = nav();
  setCookie("nl");
  expect(nav()).not.toBe(en);
});
