import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { planShellCopy } from "./copy/plan/index.js";
import StatusChip from "./plan/StatusChip";

/* Status shape, not tint: the black-and-white theme makes --warn, --neg and
 * --pos near-identical greys. These pin the shared spots that are CSS or sit
 * outside a component of their own. */

const here = dirname(fileURLToPath(import.meta.url));
const baseCss = readFileSync(resolve(here, "styles/base.css"), "utf8");
const rule = (selector: string) => {
  const m = baseCss.match(new RegExp(`\\n\\s*${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
  expect(m, selector).not.toBeNull();
  return m![1]!;
};

test("an attention chip has a dashed border and keeps its symbol; ok does not", () => {
  const shell = planShellCopy.nl;
  const attention = renderToStaticMarkup(<StatusChip status="attention" shell={shell} />);
  expect(attention).toContain("border-dashed");
  expect(attention).toContain(shell.status.attention.symbol);
  const ok = renderToStaticMarkup(<StatusChip status="on-track" shell={shell} />);
  expect(ok).not.toContain("border-dashed");
});

test("status dots differ by shape: filled circle, hollow ring, filled diamond", () => {
  expect(rule(".dot-pos")).toContain("background: var(--pos)");
  expect(rule(".dot-warn")).toContain("background: transparent");
  expect(rule(".dot-warn")).toContain("solid var(--warn)");
  expect(rule(".dot-neg")).toContain("background: var(--neg)");
  expect(rule(".dot-neg")).toContain("rotate(45deg)");
  expect(rule(".dot-neg")).toContain("border-radius: 1px");
});

test("the duplicate-account banner is a dashed warning", () => {
  expect(rule(".dup-banner")).toContain("border-left: 4px dashed var(--warn)");
});
