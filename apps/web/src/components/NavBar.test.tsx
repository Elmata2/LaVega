import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import NavBar from "./NavBar";
import TopBar from "./TopBar";
import { enabledModules, navModules } from "./moduleRegistry";

/* The shell chrome after the UI review: the nav shows the owner's selection,
 * the profile sits top right, the "lokaal & privé" claim is gone, and the
 * floating chat widget is unmounted. */

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("the nav renders exactly the enabled modules, and nothing else", () => {
  const html = renderToStaticMarkup(
    <NavBar view="overview" modules={navModules(enabledModules(["overview", "valuta"]))} onNavigate={() => {}} onOpenProfile={() => {}} />,
  );
  expect(html).toContain("Overzicht");
  expect(html).toContain("Valuta");
  expect(html).not.toContain("Facturen");
  expect(html).not.toContain("Belasting");
});

test("the active tab is marked by a rule, not by a round-edged tile", () => {
  const html = renderToStaticMarkup(
    <NavBar view="valuta" modules={navModules(enabledModules(["valuta"]))} onNavigate={() => {}} onOpenProfile={() => {}} />,
  );
  expect(html).toContain('aria-current="page"');
  const base = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8").replace(/\s+/g, " ");
  const active = base.slice(base.indexOf(".nav-item.active"), base.indexOf(".nav-item:disabled"));
  expect(active).toContain("border-bottom-color: var(--ink)");
});

test("the profile entry sits in the app bar's right-hand slot", () => {
  const html = renderToStaticMarkup(
    <NavBar view="overview" modules={[]} onNavigate={() => {}} onOpenProfile={() => {}} />,
  );
  const right = html.slice(html.indexOf('class="appbar-right"'));
  expect(right).toContain("Profiel");
  expect(right).toContain("profile-avatar");
});

test("the investing link is not rendered on a first paint — it waits for the app to answer", () => {
  // The static render has run no effects, so the reachability probe has not
  // answered yet, and the link is absent. This is the same assertion as
  // before, inverted on purpose: the link used to be unconditional and
  // pointed at 127.0.0.1:8790, which on lavega.dev opened a browser error
  // page. What the link looks like once it IS shown is asserted in
  // NavBar.investing.test.tsx, which has the DOM the probe needs.
  const html = renderToStaticMarkup(
    <NavBar view="overview" modules={[]} onNavigate={() => {}} onOpenProfile={() => {}} />,
  );
  expect(html).not.toContain("Investing");
  // And it is a link out when it appears, never a nav-item that flips `view`.
  const nav = readFileSync(new URL("./NavBar.tsx", import.meta.url), "utf8");
  expect(nav).toContain('<a href={investingHref} target="_blank" rel="noopener noreferrer"');
});

test("the chrome no longer asserts 'lokaal & privé', and no longer holds Vergrendel", () => {
  const html = renderToStaticMarkup(
    <NavBar view="overview" modules={navModules(enabledModules(null))} onNavigate={() => {}} onOpenProfile={() => {}} />,
  );
  expect(html.toLowerCase()).not.toContain("lokaal");
  expect(html).not.toContain("Vergrendel"); // it moved to the profile
  expect(readFileSync(new URL("./NavBar.tsx", import.meta.url), "utf8")).not.toContain("identity-card");
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
  const base = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8").replace(/\s+/g, " ");
  expect(base.slice(base.indexOf(".scope-option.scope-on"))).toContain("border-bottom-color: var(--ink)");
});

test("the per-company pills are gone from the chrome, the entity scope is not", () => {
  const html = renderToStaticMarkup(
    <TopBar view="overview" scope="personal" onScopeChange={() => {}} onAddWidget={() => {}} />,
  );
  expect(html).not.toContain("Alle bedrijven");
  expect(html).not.toContain("Bedrijfsfilter");
  // Still passed down, so Transacties/Forecast/Belasting keep working per BV.
  expect(app).toContain("entityScope={entityScope}");
  expect(app).toContain("const [entityScope, setEntityScope] = useState(\"\")");
});

test("every section header is a title with a rule under it, not a round-edged tile", () => {
  const base = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8").replace(/\s+/g, " ");
  const modules = readFileSync(new URL("../styles/modules.css", import.meta.url), "utf8").replace(/\s+/g, " ");
  // The shared header classes the views and the blocks already use.
  expect(base.slice(base.indexOf(".card-header, .card > h2"))).toContain("border-bottom: 1px solid var(--ink)");
  expect(modules.slice(modules.indexOf(".module-head {"), modules.indexOf(".module-title"))).toContain(
    "border-bottom: 1px solid var(--ink)",
  );
  // ...and the tiles themselves stopped shouting.
  const card = base.slice(base.indexOf(".card {"), base.indexOf(".kpi-row"));
  expect(card).toContain("border-radius: var(--r-sm)");
  expect(card).not.toContain("box-shadow");
  const module = modules.slice(modules.indexOf(".module {"), modules.indexOf(".module-head"));
  expect(module).toContain("border-radius: var(--r-sm)");
  expect(module).not.toContain("box-shadow");
});
