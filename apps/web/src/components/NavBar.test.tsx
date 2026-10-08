import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import NavBar from "./NavBar";
import TopBar from "./TopBar";
import { enabledModules, navModules } from "./moduleRegistry";

/* The shell chrome after the UI review: the nav shows the owner's selection,
 * the profile sits top right, the "lokaal & privé" claim is gone, and the
 * floating chat widget is unmounted. */

/* This file runs in vitest's default Node environment (no `document` global).
 * `NavBar`/`TopBar` only need `document.cookie` to exist for `useAppLocale()`
 * to read the locale, so a minimal stub is enough; `renderToStaticMarkup`
 * itself never touches `document`. */
beforeEach(() => {
  (globalThis as unknown as { document: { cookie: string } }).document = {
    cookie: "lavega_locale=nl",
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

test("the nav renders exactly the enabled modules, and nothing else", () => {
  const html = renderToStaticMarkup(
    <NavBar
      view="overview"
      modules={navModules(enabledModules(["overview", "valuta"]))}
      onNavigate={() => {}}
      onOpenProfile={() => {}}
    />,
  );
  expect(html).toContain("Overzicht");
  expect(html).toContain("Valuta");
  expect(html).not.toContain("Facturen");
  expect(html).not.toContain("Belasting");
});

test("the nav tab labels switch to English under the en locale cookie", () => {
  document.cookie = "lavega_locale=en";
  const html = renderToStaticMarkup(
    <NavBar
      view="overview"
      modules={navModules(enabledModules(["overview", "valuta"]))}
      onNavigate={() => {}}
      onOpenProfile={() => {}}
    />,
  );
  expect(html).toContain("Overview");
  expect(html).toContain("Currency");
  expect(html).not.toContain("Overzicht");
  expect(html).not.toContain("Valuta");
});

test("TopBar's title and scope switch are English under the en locale cookie", () => {
  document.cookie = "lavega_locale=en";
  const html = renderToStaticMarkup(
    <TopBar view="overview" scope="personal" onScopeChange={() => {}} onAddWidget={() => {}} />,
  );
  expect(html).toContain("Personal");
  expect(html).toContain("Business");
});
