// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import ModulePicker, { WidgetPicker } from "./components/ModulePicker";
import TopBar from "./components/TopBar";
import { MODULES, WIDGETS } from "./components/moduleRegistry";
import { shellCopy } from "./copy/shell";

/* The switch is ON here (no mock): the business-only UI must be absent. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(node: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => createRoot(container).render(node));
  return container;
}

test("TopBar renders no scope switch", () => {
  const html = renderToStaticMarkup(
    <TopBar view="overview" scope="personal" onScopeChange={() => {}} onAddWidget={() => {}} />,
  );
  expect(html).not.toContain("scope-switch");
  expect(html).not.toContain(shellCopy.nl.topBar.scopeGroupLabel);
});

test("the module picker and widget picker do not offer archived entries", () => {
  const el = mount(
    <>
      <ModulePicker enabled={MODULES.map((m) => m.id)} onChange={() => {}} />
      <WidgetPicker enabled={WIDGETS.map((w) => w.id)} onChange={() => {}} />
    </>,
  );
  const text = el.textContent ?? "";
  for (const label of ["Valuta", "Belasting", "Facturen", "Positie", "BTW"]) {
    expect(text).not.toContain(label);
  }
});
