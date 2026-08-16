import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import Module, { ModuleMenu, ModulePeriod } from "./Module";

/* There is no DOM render lib in this repo, but react-dom is already a
 * dependency — renderToStaticMarkup gives the primitive real render coverage
 * (title, controls, span class) with no new dependency and no jsdom. */

const PERIODS = [
  { value: "week", label: "Week" },
  { value: "maand", label: "Maand" },
];

test("a module renders its title in the header", () => {
  const html = renderToStaticMarkup(<Module title="Gemiddelde uitgaven">inhoud</Module>);
  expect(html).toContain('class="module-title"');
  expect(html).toContain("Gemiddelde uitgaven");
  expect(html).toContain("inhoud");
});

test("a module carries its span and height onto the card element", () => {
  const html = renderToStaticMarkup(
    <Module title="Positie" span={2} height="tall">
      inhoud
    </Module>,
  );
  expect(html).toContain('class="module module-span-2 module-tall"');
});

test("the period control and the … menu render in the controls slot", () => {
  const html = renderToStaticMarkup(
    <Module
      title="Activiteit"
      period={<ModulePeriod value="week" options={PERIODS} onChange={() => {}} />}
      menu={<ModuleMenu label="Meer opties" onClick={() => {}} />}
    >
      inhoud
    </Module>,
  );
  expect(html).toContain('class="module-controls"');
  expect(html).toContain('class="module-period"');
  expect(html).toContain('aria-label="Periode"');
  expect(html).toContain("Maand");
  expect(html).toContain('class="module-menu"');
  expect(html).toContain('aria-label="Meer opties"');
});

test("the controls row is absent when a module has neither slot", () => {
  const html = renderToStaticMarkup(<Module title="Zonder knoppen">inhoud</Module>);
  expect(html).not.toContain("module-controls");
});

test("a footer renders only when given", () => {
  expect(renderToStaticMarkup(<Module title="A">x</Module>)).not.toContain("module-foot");
  const html = renderToStaticMarkup(
    <Module title="A" footer="Bron: ECB">
      x
    </Module>,
  );
  expect(html).toContain('class="module-foot"');
  expect(html).toContain("Bron: ECB");
});

test("the period control reports the selected value to its caller", () => {
  let picked = "";
  const control = ModulePeriod({ value: "week", options: PERIODS, onChange: (v) => (picked = v) });
  // props.onChange is what the <select> fires; call it the way React would.
  control.props.onChange({ target: { value: "maand" } });
  expect(picked).toBe("maand");
});
