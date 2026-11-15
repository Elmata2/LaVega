import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/* The scope switch is archived but stays in the code; this suite runs with it
 * shown. archive-ui.test.tsx covers it hidden. */
vi.mock("../archive", () => ({
  ARCHIVE_BUSINESS: false,
  ARCHIVED_VIEWS: [],
  ARCHIVED_WIDGETS: [],
  SHOW_SCOPE_SWITCH: true,
  SHOW_INVOICE_FORWARDING: true,
  SHOW_ENTITY_CLASSIFIER: true,
  isArchivedView: () => false,
  isArchivedWidget: () => false,
  initialScope: () =>
    localStorage.getItem("lavega.defaultScope") === "business" ? "business" : "personal",
}));
import { TopBarActions } from "./TopBar";

/* Node environment: only `document.cookie` is needed, for `useAppLocale()`. */
beforeEach(() => {
  (globalThis as unknown as { document: { cookie: string } }).document = {
    cookie: "lavega_locale=nl",
  };
});
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

const render = (showAddWidget = true) =>
  renderToStaticMarkup(
    <TopBarActions
      scope="personal"
      onScopeChange={() => {}}
      onAddWidget={() => {}}
      showAddWidget={showAddWidget}
    />,
  );

test("the scope switch and the add-widget pill are Dutch by default", () => {
  const html = render();
  expect(html).toContain("Persoonlijk");
  expect(html).toContain("Zakelijk");
  expect(html).toContain("Widget toevoegen");
});

test("the scope switch is English under the en locale cookie", () => {
  document.cookie = "lavega_locale=en";
  const html = render();
  expect(html).toContain("Personal");
  expect(html).toContain("Business");
  expect(html).not.toContain("Persoonlijk");
});

test("the add-widget pill is absent when the view is not Overzicht", () => {
  const html = render(false);
  expect(html).not.toContain("Widget toevoegen");
  expect(html).not.toContain("topbar-add");
  expect(html).toContain("Persoonlijk");
});
