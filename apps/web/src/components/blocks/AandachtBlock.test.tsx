import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import AandachtBlock from "./AandachtBlock";
import { alerts } from "./fixtures";

test("AandachtBlock renders every alert from props", () => {
  const html = renderToStaticMarkup(
    <AandachtBlock alerts={alerts} bufferCents={250_000} onBufferChange={() => {}} />,
  );
  expect(html).toContain("Aandacht");
  expect(html).toContain("Tekort verwacht in week 6");
  expect(html).toContain("Verwacht saldo € 1.200 onder je buffer.");
  expect(html).toContain("1 rekening zonder saldo");
  // The buffer arrives in cents and is shown in euro.
  expect(html).toContain('value="2500"');
});

test("AandachtBlock says all-clear instead of rendering an empty list", () => {
  const html = renderToStaticMarkup(<AandachtBlock alerts={[]} bufferCents={0} onBufferChange={() => {}} />);
  expect(html).toContain("Geen aandachtspunten");
  expect(html).not.toContain("alert-row");
});
