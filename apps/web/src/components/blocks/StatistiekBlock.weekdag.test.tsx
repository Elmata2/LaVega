// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import StatistiekBlock from "./StatistiekBlock";
import { freshTxs, own, rules, txs } from "./fixtures";

/* The weekday view sits behind a tab, so it needs a click to reach. No testing
 * library is installed in this repo (and none is being added for one file), so
 * this mounts the block with React's own root API and clicks the tab. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Mount the block, click "Weekdagen", return the rendered HTML. */
function renderWeekdayView(list = txs): string {
  host = document.createElement("div");
  document.body.appendChild(host);
  const el = host;
  act(() => {
    root = createRoot(el);
    root.render(<StatistiekBlock txs={list} rules={rules} own={own} onSelectCategory={() => {}} />);
  });
  const tab = [...el.querySelectorAll("button")].find((b) => b.textContent === "Weekdagen");
  expect(tab).toBeDefined();
  act(() => {
    tab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return el.innerHTML;
}

test("the weekday view answers 'which day costs me money' in a sentence", () => {
  const html = renderWeekdayView();
  // Thursday is the fixture's expensive day (1.880 over nine Thursdays).
  expect(html).toContain("Donderdag");
  expect(html).toContain("kost je gemiddeld");
  expect(html).toContain("meer dan een gewone dag");
  // And the reference's bars + trend line are there behind the sentence.
  expect(html).toContain("weekday-bar");
  expect(html).toContain("weekday-peak-chip");
  expect(html).toContain("stroke-dasharray");
  // The average is per occurrence of that weekday, so every weekday counts.
  expect(html).toContain("ook de dagen zonder transactie");
});

test("the weekday view refuses a pattern it cannot support and says why", () => {
  const html = renderWeekdayView(freshTxs);
  expect(html).toContain("2 dagen geschiedenis");
  expect(html).toContain("minstens 14 dagen");
  expect(html).not.toContain("weekday-bar");
  expect(html).not.toContain("kost je gemiddeld");
});
