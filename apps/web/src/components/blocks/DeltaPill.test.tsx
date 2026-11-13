// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import DeltaPill from "./DeltaPill";

/* Read the rendered text through the DOM, not by stripping tags with a regex. */
const text = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.textContent ?? "";
};

test("a rise carries + and a fall carries a real minus, next to the arrow", () => {
  expect(text(renderToStaticMarkup(<DeltaPill pct={3.2} upIsGood={true} />))).toBe("▲ +3%");
  expect(text(renderToStaticMarkup(<DeltaPill pct={-12.4} upIsGood={true} />))).toBe("▼ −12%");
});

test("the sign follows the number, not which direction is good", () => {
  expect(text(renderToStaticMarkup(<DeltaPill pct={5} upIsGood={false} />))).toBe("▲ +5%");
  expect(text(renderToStaticMarkup(<DeltaPill pct={-5} upIsGood={false} />))).toBe("▼ −5%");
});

test("flat shows no sign and a missing comparison renders nothing", () => {
  expect(text(renderToStaticMarkup(<DeltaPill pct={0.2} upIsGood={true} />))).toBe("0%");
  expect(renderToStaticMarkup(<DeltaPill pct={null} upIsGood={true} />)).toBe("");
});
