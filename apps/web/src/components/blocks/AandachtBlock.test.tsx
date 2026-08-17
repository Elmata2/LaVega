// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import type { Alert } from "@lavega/core";
import AandachtBlock from "./AandachtBlock";
import { alerts } from "./fixtures";

test("AandachtBlock renders every alert from props, grouped under its severity", () => {
  const html = renderToStaticMarkup(
    <AandachtBlock alerts={alerts} bufferCents={250_000} onBufferChange={() => {}} />,
  );
  expect(html).toContain("Aandacht");
  expect(html).toContain("Tekort verwacht in week 6");
  expect(html).toContain("Verwacht saldo € 1.200 onder je buffer.");
  expect(html).toContain("1 rekening zonder saldo");
  // The buffer arrives in cents and is shown in euro.
  expect(html).toContain('value="2500"');

  // Severity is a WORD, not only a coloured circle: the circles are
  // aria-hidden, so on their own the ranking core computes never reached a
  // screen reader at all.
  expect(html).toContain("Kritiek");
  expect(html).toContain("Ter info");
  // Hardest tier first, matching core's own sort.
  expect(html.indexOf("Kritiek")).toBeLessThan(html.indexOf("Ter info"));
});

/* --- The empty state. The old copy asserted a fact about the data ("je
 * verwachte saldo blijft boven je buffer en er zijn geen gemiste betalingen"),
 * which `computeAlerts` produces just as readily when there is no data at all:
 * no accounts, no forecast, no streams, nothing that could be missed. --- */

test("AandachtBlock never reports an empty list as a clean bill of health", () => {
  const html = renderToStaticMarkup(<AandachtBlock alerts={[]} bufferCents={500_00} onBufferChange={() => {}} />);
  expect(html).not.toContain("alert-row");

  // No claim about the balance or about payments arriving.
  expect(html).not.toContain("blijft boven je buffer");
  expect(html).not.toContain("geen gemiste betalingen");

  // Instead: what was looked at, and the limit of the answer.
  expect(html).toContain("Niets gevonden om je op te wijzen");
  expect(html).toContain("een verwacht tekort tegenover je buffer");
  expect(html).toContain("BTW- en belastingdeadlines binnen 30 dagen");
  expect(html).toContain("zo compleet als wat je hebt geïmporteerd");
});

test("a buffer of zero says what that silently does to the shortfall alert", () => {
  // The forecast flags a week whose closing falls BELOW the buffer, so a buffer
  // of 0 quietly turns "waarschuw me op tijd" into "waarschuw me bij rood".
  const zero = renderToStaticMarkup(<AandachtBlock alerts={[]} bufferCents={0} onBufferChange={() => {}} />);
  expect(zero).toContain("Je buffer staat op € 0");
  expect(zero).toContain("onder nul zakt");

  const set = renderToStaticMarkup(<AandachtBlock alerts={[]} bufferCents={250_000} onBufferChange={() => {}} />);
  expect(set).not.toContain("Je buffer staat op € 0");
});

/* --- Noise control. Six "saldo bijwerken" reminders standing at the same
 * weight as a forecast shortfall is how a block earns the right to be
 * ignored. --- */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(node: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const info = (n: number): Alert[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    severity: "info" as const,
    title: `Punten ${i} — saldo bijwerken`,
    detail: `Laatst bijgewerkt op 2026-05-0${i + 1}.`,
  }));

test("the info tier folds away behind a count when something real outranks it", () => {
  const critical: Alert = {
    id: "shortfall",
    severity: "critical",
    title: "Verwacht tekort",
    detail: "Rond 2026-09-14 zakt je saldo naar € 800,00 — onder je buffer van € 2.500,00.",
  };
  const c = render(<AandachtBlock alerts={[critical, ...info(4)]} bufferCents={250_000} onBufferChange={() => {}} />);

  // The critical alert is never folded.
  expect(c.textContent).toContain("Verwacht tekort");
  expect(c.textContent).not.toContain("Punten 0");
  expect(c.querySelectorAll(".alert-row")).toHaveLength(1);

  const toggle = [...c.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Toon 4 ter info"))!;
  expect(toggle).toBeTruthy();
  act(() => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));

  expect(c.textContent).toContain("Punten 0");
  expect(c.querySelectorAll(".alert-row")).toHaveLength(5);
});

test("info alerts stay open when they are the only thing there — folding them would hide the block", () => {
  const c = render(<AandachtBlock alerts={info(3)} bufferCents={250_000} onBufferChange={() => {}} />);
  expect(c.querySelectorAll(".alert-row")).toHaveLength(3);
  expect(c.textContent).not.toContain("Toon 3 ter info");
});

test("one or two info alerts are never folded — the toggle would cost the space it saves", () => {
  const critical: Alert = { id: "s", severity: "critical", title: "Verwacht tekort", detail: "…" };
  const c = render(<AandachtBlock alerts={[critical, ...info(2)]} bufferCents={250_000} onBufferChange={() => {}} />);
  expect(c.querySelectorAll(".alert-row")).toHaveLength(3);
  expect(c.querySelector(".alert-tier button")).toBeNull(); // no fold toggle
});
