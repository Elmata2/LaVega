import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import NavBar from "./NavBar";
import TopBar from "./TopBar";
import { enabledModules, navModules } from "./moduleRegistry";
import { resolved } from "../test-support/resolveStyle.js";

/* The shell chrome after the UI review: the nav shows the owner's selection,
 * the profile sits top right, the "lokaal & privé" claim is gone, and the
 * floating chat widget is unmounted. */

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

/* This file runs in vitest's default Node environment (no `document` global)
 * so that `readFileSync(new URL(..., import.meta.url))` above keeps resolving
 * a real `file://` URL — switching the whole file to `@vitest-environment
 * jsdom` breaks that resolution. `NavBar`/`TopBar` only need `document.cookie`
 * to exist for `useAppLocale()` to read the locale, so a minimal stub is
 * enough; `renderToStaticMarkup` itself never touches `document`. */
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

test("the active tab is marked by a rule, not by a round-edged tile", () => {
  const html = renderToStaticMarkup(
    <NavBar
      view="valuta"
      modules={navModules(enabledModules(["valuta"]))}
      onNavigate={() => {}}
      onOpenProfile={() => {}}
    />,
  );
  expect(html).toContain('aria-current="page"');
  expect(resolved(["nav-item", "active"], "border-bottom-color")).toBe("var(--ink)");
});

test("the profile entry sits in the app bar's right-hand slot", () => {
  const html = renderToStaticMarkup(
    <NavBar view="overview" modules={[]} onNavigate={() => {}} onOpenProfile={() => {}} />,
  );
  const right = html.slice(html.indexOf('class="appbar-right"'));
  expect(right).toContain("Profiel");
  expect(right).toContain("profile-avatar");
});

test("the investing link is always a real href out of the SPA when configured", () => {
  const html = renderToStaticMarkup(
    <NavBar view="overview" modules={[]} onNavigate={() => {}} onOpenProfile={() => {}} />,
  );
  expect(html).toContain("Investing");
  const nav = readFileSync(new URL("./NavBar.tsx", import.meta.url), "utf8");
  expect(nav).toContain("href={INVESTING_URL}");
  expect(nav).toContain('INVESTING_URL.startsWith("http")');
  expect(nav).toContain("pathForView");
});

test("the chrome no longer asserts 'lokaal & privé', and no longer holds Vergrendel", () => {
  const html = renderToStaticMarkup(
    <NavBar
      view="overview"
      modules={navModules(enabledModules(null))}
      onNavigate={() => {}}
      onOpenProfile={() => {}}
    />,
  );
  expect(html.toLowerCase()).not.toContain("lokaal");
  expect(html).not.toContain("Vergrendel"); // it moved to the profile
  expect(readFileSync(new URL("./NavBar.tsx", import.meta.url), "utf8")).not.toContain(
    "identity-card",
  );
});

test("the floating chat widget is not rendered by the shell (the file stays)", () => {
  expect(app).not.toContain("<ChatWidget");
  expect(app).not.toContain('from "./components/ChatWidget"');
  // Parked, not deleted — it is coming back in some form.
  expect(() => readFileSync(new URL("./ChatWidget.tsx", import.meta.url), "utf8")).not.toThrow();
});

test("'Widget toevoegen' sits in the header and opens the picker", () => {
  const html = renderToStaticMarkup(
    <TopBar view="overview" scope="personal" onScopeChange={() => {}} onAddWidget={() => {}} />,
  );
  expect(html).toContain("Widget toevoegen");
  // App routes that click to the profile page and bumps the picker's focus nonce.
  expect(app).toContain("onAddWidget={handleAddWidget}");
  expect(app).toMatch(/function handleAddWidget\(\) \{\s*setView\("profiel"\);\s*setAddWidget/);
});

test("the header's switcher is Persoonlijk | Zakelijk, split by a vertical rule", () => {
  const html = renderToStaticMarkup(
    <TopBar view="overview" scope="business" onScopeChange={() => {}} onAddWidget={() => {}} />,
  );
  expect(html).toContain("Persoonlijk");
  expect(html).toContain("Zakelijk");
  expect(html).toContain("scope-rule"); // the vertical rule between the two
  // The active half is the pressed one, and it is marked by a rule under the
  // word — the same treatment as the nav's active tab, no new colour.
  // The last "Zakelijk" is the switch's own; the first is the eyebrow's.
  const zakelijk = html.slice(html.lastIndexOf("<button", html.lastIndexOf("Zakelijk")));
  expect(zakelijk).toContain('aria-pressed="true"');
  expect(zakelijk).toContain("scope-on");
  expect(resolved(["scope-option", "scope-on"], "border-bottom-color")).toBe("var(--ink)");
});

test("the per-company pills are gone from the chrome, the entity scope is not", () => {
  const html = renderToStaticMarkup(
    <TopBar view="overview" scope="personal" onScopeChange={() => {}} onAddWidget={() => {}} />,
  );
  expect(html).not.toContain("Alle bedrijven");
  expect(html).not.toContain("Bedrijfsfilter");
  // Still passed down, so Transacties/Forecast/Belasting keep working per BV.
  expect(app).toContain("entityScope={entityScope}");
  expect(app).toContain('const [entityScope, setEntityScope] = useState("")');
});

test("every section header is a title with a rule under it, not a round-edged tile", () => {
  // The shared header classes the views and the blocks already use.
  expect(resolved(["card-header"], "border-bottom")).toBe("1px solid var(--ink)");
  expect(resolved(["module-head"], "border-bottom")).toBe("1px solid var(--ink)");
  // ...and the tiles themselves stopped shouting.
  expect(resolved(["card"], "border-radius")).toBe("var(--r-sm)");
  expect(resolved(["card"], "box-shadow")).toBeUndefined();
  expect(resolved(["module"], "border-radius")).toBe("var(--r-sm)");
  expect(resolved(["module"], "box-shadow")).toBeUndefined();
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
