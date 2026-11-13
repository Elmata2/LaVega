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

test("status dots differ by shape: filled positive, hollow negative, dashed warning", () => {
  expect(rule(".dot-pos")).toContain("background: var(--pos)");
  expect(rule(".dot-neg")).toContain("background: transparent");
  expect(rule(".dot-neg")).toContain("inset");
  expect(rule(".dot-warn")).toContain("dashed");
});

test("the duplicate-account banner is a dashed warning", () => {
  expect(rule(".dup-banner")).toContain("border-left: 4px dashed var(--warn)");
});
