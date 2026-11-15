// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Landing from "./Landing";
import { useAuthState } from "../authClient.js";
import type { Locale } from "../locale.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../authClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../authClient.js")>();
  return { ...actual, useAuthState: vi.fn() };
});

let container: HTMLElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(locale: Locale) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Landing onEnter={() => {}} locale={locale} />));
  return container;
}

test.each(["nl", "en"] as const)(
  "%s: every link has a real href and every hash has a target",
  (locale) => {
    const el = render(locale);
    const anchors = [...el.querySelectorAll("a")];
    expect(anchors.length).toBeGreaterThan(5);
    for (const a of anchors) {
      const href = a.getAttribute("href");
      expect(href, `link "${a.textContent}" has no href`).toBeTruthy();
      expect(href, `link "${a.textContent}" points at "#"`).not.toBe("#");
      expect(href, `link "${a.textContent}" leaves the app for lavega.dev`).not.toMatch(
        /lavega\.dev/,
      );
      if (href!.startsWith("#")) {
        expect(el.querySelector(href!), `${href} has no target`).not.toBeNull();
      }
    }
    const hrefs = anchors.map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["#does", "#faq", "/privacy", "/terms"]));
    expect(hrefs.some((h) => h === "mailto:alexander.steunenberg@gmail.com")).toBe(true);
    expect(hrefs).toContain(locale === "nl" ? "/en" : "/");
  },
);
