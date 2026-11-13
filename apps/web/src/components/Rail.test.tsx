import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/* Business modules (valuta) are archived in the real module; run with them shown. */
vi.mock("../archive", () => ({
  ARCHIVE_BUSINESS: false,
  ARCHIVED_VIEWS: [],
  ARCHIVED_WIDGETS: [],
  SHOW_SCOPE_SWITCH: true,
  SHOW_INVOICE_FORWARDING: true,
  SHOW_ENTITY_CLASSIFIER: true,
  isArchivedView: () => false,
  isArchivedWidget: () => false,
  initialScope: () => "personal",
}));
import { Rail, investingLinkProps } from "./Rail";
import { enabledModules, navModules } from "./moduleRegistry";
import { INVESTING_URL } from "../investing";
import { shellCopy } from "../copy/shell.js";

/* Rail is the only desktop navigation, so this is where the nav's content
 * contract is pinned: which modules show, in what order, in which language,
 * what the plan lock hides, and that Investing is a link out. Behaviour of the
 * rail inside the frame (one <nav>, click handling, aria-current on the live
 * DOM) is in ShellNav.test.tsx.
 *
 * Node environment: `renderToStaticMarkup` never touches `document`, and
 * `useAppLocale` only needs `document.cookie`, so a stub is enough. */

function setCookie(locale: string) {
  (globalThis as unknown as { document: { cookie: string } }).document = {
    cookie: `lavega_locale=${locale}`,
  };
}

beforeEach(() => setCookie("nl"));
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

function rail(
  ids: Parameters<typeof enabledModules>[0],
  view: "overview" | "profiel" | "plan" = "overview",
) {
  return renderToStaticMarkup(
    <Rail
      view={view}
      modules={navModules(enabledModules(ids))}
      onNavigate={() => {}}
      onOpenProfile={() => {}}
    />,
  );
}

const inOrder = (html: string, labels: string[]) => {
  const at = labels.map((l) => html.indexOf(l));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
};

test("the rail renders exactly the enabled modules, and nothing else", () => {
  const html = rail(["overview", "valuta"]);
  expect(html).toContain("Overzicht");
  expect(html).toContain("Valuta");
  expect(html).not.toContain("Facturen");
  expect(html).not.toContain("Belasting");
});

test("the rail lists the core three in order, then optional modules", () => {
  inOrder(rail(["forecast", "accounts", "optimalisatie"]), [
    "Overzicht",
    "Optimalisatie",
    "Rekeningen",
    "Forecast",
  ]);
});

test("Jouw plan is in no nav list, even when a stored list still names plan", () => {
  const html = rail(["overview", "optimalisatie", "accounts", "plan"]);
  expect(html).not.toContain("Jouw plan");
  expect(html).not.toContain("/app/plan");
});

test("the brand is an LV monogram labelled LaVega, not a bare dot", () => {
  const html = rail(["overview"]);
  const brand = html.match(/<span[^>]*shell2-rail-brand[^>]*>[^<]*<\/span>/)?.[0] ?? "";
  expect(brand).toContain('aria-label="LaVega"');
  expect(brand).toContain(">LV<");
  expect(brand).not.toContain("dot");
});

test("on the plan view the rail marks Profiel as the current item, not a module", () => {
  const html = rail(["overview", "optimalisatie", "accounts"], "plan");
  const current = (html.match(/<a [^>]*>/g) ?? []).filter((t) => t.includes('aria-current="page"'));
  expect(current).toHaveLength(1);
  expect(current[0]).toContain("profiel");
});

test("the active view carries aria-current, and Profiel does when it is the view", () => {
  const current = (html: string) =>
    (html.match(/<a [^>]*>/g) ?? []).filter((tag) => tag.includes('aria-current="page"'));
  const overview = current(rail(["overview", "valuta"]));
  expect(overview).toHaveLength(1);
  expect(overview[0]).toContain('href="/app"');
  const profiel = current(rail(["overview"], "profiel"));
  expect(profiel).toHaveLength(1);
  expect(profiel[0]).toContain("profiel");
});

test("English labels under the en locale cookie, Dutch ones are gone", () => {
  setCookie("en");
  const html = rail(["overview", "valuta"]);
  expect(html).toContain(shellCopy.en.nav.moduleLabels.overview);
  expect(html).toContain(shellCopy.en.nav.moduleLabels.valuta);
  expect(html).not.toContain(shellCopy.nl.nav.moduleLabels.overview);
  expect(html).not.toContain(shellCopy.nl.nav.moduleLabels.valuta);
});

test("the English rail follows the same order: Overview, Optimization, Accounts", () => {
  setCookie("en");
  const l = shellCopy.en.nav.moduleLabels;
  const html = rail(["plan", "accounts", "optimalisatie"]);
  inOrder(html, [l.overview, l.optimalisatie, l.accounts]);
  expect(html).not.toContain(l.plan);
});

test("the investing link is a link out in the bottom group, not a view change", () => {
  expect(INVESTING_URL).toBeTruthy();
  const html = rail(["overview"]);
  const bottom = html.slice(html.indexOf("shell2-rail-bottom"));
  const link = bottom.slice(bottom.indexOf("<a "), bottom.indexOf("</a>"));
  expect(link).toContain("Investing");
  expect(link).toContain(`href="${INVESTING_URL}"`);
  expect(link).not.toContain("aria-current");
  if (INVESTING_URL!.startsWith("http")) {
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  } else {
    expect(link).not.toContain('target="_blank"');
  }
  expect(investingLinkProps()?.href).toBe(INVESTING_URL);
});
