import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import Badge from "./Badge";
import StatusLine, { StatusIcon } from "./StatusLine";

/* The shape, not the colour, carries the meaning: in the black-and-white
 * theme --warn, --neg and --pos are near-identical greys. */

describe("StatusLine", () => {
  test("warning: dashed border and the triangle icon", () => {
    const html = renderToStaticMarkup(<StatusLine tone="warning">Let op</StatusLine>);
    expect(html).toContain("border-dashed");
    expect(html).toContain("border-warn");
    expect(html).toContain('data-status-icon="warning"');
    expect(html).toContain("Let op");
  });

  test("problem: solid border and the cross icon", () => {
    const html = renderToStaticMarkup(<StatusLine tone="problem">Mislukt</StatusLine>);
    expect(html).toContain("border-solid");
    expect(html).toContain("border-neg");
    expect(html).toContain('data-status-icon="problem"');
  });

  test("success: icon with a check", () => {
    const html = renderToStaticMarkup(<StatusLine tone="success">Gelukt</StatusLine>);
    expect(html).toContain('data-status-icon="success"');
    expect(html).toContain("border-pos");
  });

  test("icon is decoration: aria-hidden, currentColor", () => {
    const html = renderToStaticMarkup(<StatusLine tone="warning">x</StatusLine>);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('stroke="currentColor"');
  });

  test("passes role, id, className and data attributes through", () => {
    const html = renderToStaticMarkup(
      <StatusLine tone="problem" role="alert" id="err-1" className="mt-2" data-testid="x">
        boom
      </StatusLine>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="err-1"');
    expect(html).toContain("mt-2");
    expect(html).toContain('data-testid="x"');
    expect(html.startsWith("<p ")).toBe(true);
  });

  test("an empty slot keeps its element but draws no box and no icon", () => {
    const html = renderToStaticMarkup(
      <StatusLine tone="problem" id="e-err" data-testid="slot">
        {null}
      </StatusLine>,
    );
    expect(html).toContain('id="e-err"');
    expect(html).not.toContain("data-status-icon");
    expect(html).not.toContain("border");
  });

  test("renders another element when asked", () => {
    const html = renderToStaticMarkup(
      <StatusLine tone="warning" as="div">
        x
      </StatusLine>,
    );
    expect(html.startsWith("<div ")).toBe(true);
  });

  test("the three icons differ in shape", () => {
    const shape = (tone: "warning" | "problem" | "success") =>
      renderToStaticMarkup(<StatusIcon tone={tone} />);
    expect(new Set([shape("warning"), shape("problem"), shape("success")]).size).toBe(3);
  });
});

describe("Badge status tones", () => {
  test("warning badge: dashed border and icon", () => {
    const html = renderToStaticMarkup(<Badge tone="warning">achterstallig</Badge>);
    expect(html).toContain("border-dashed");
    expect(html).toContain("border-warn");
    expect(html).toContain('data-status-icon="warning"');
  });

  test("problem badge: solid border and icon", () => {
    const html = renderToStaticMarkup(<Badge tone="problem">gemist</Badge>);
    expect(html).toContain("border-neg");
    expect(html).not.toContain("border-dashed");
    expect(html).toContain('data-status-icon="problem"');
  });

  test("success badge: check icon", () => {
    const html = renderToStaticMarkup(<Badge tone="success">betaald</Badge>);
    expect(html).toContain('data-status-icon="success"');
    expect(html).toContain("border-pos");
  });

  test("badge without a tone stays plain", () => {
    const html = renderToStaticMarkup(<Badge>nieuw</Badge>);
    expect(html).not.toContain("data-status-icon");
    expect(html).not.toContain("border-dashed");
  });
});
