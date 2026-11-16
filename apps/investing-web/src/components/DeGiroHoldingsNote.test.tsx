// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { DeGiroHoldingsNote } from "./DeGiroHoldingsNote.js";

/* Issue #325, web half: the dashboard must show the import age next to the
 * DeGiro holdings and must not read as a live feed. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(props: Parameters<typeof DeGiroHoldingsNote>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(<DeGiroHoldingsNote {...props} />);
  });
  return container;
}

test("shows the import age, the quantities date and that quantities are not live", () => {
  const view = render({
    degiro: {
      importedAt: "2026-10-01T09:00:00.000Z",
      coversFrom: "2026-09-01",
      coversTo: "2026-10-01",
      positionsAsOf: "2026-10-01",
    },
    today: "2026-11-01",
  });
  const note = view.querySelector('[role="note"]');
  expect(note?.textContent).toContain("DeGiro");
  expect(note?.textContent).toContain("31 days old");
  expect(note?.textContent).toContain("quantities from");
  expect(note?.textContent).toContain("Prices update daily; quantities are not live.");
  expect(note?.getAttribute("data-degiro-age")).toBe("31");
});

test("an absent import renders nothing", () => {
  const view = render({ degiro: undefined });
  expect(view.querySelector('[role="note"]')).toBeNull();
});
