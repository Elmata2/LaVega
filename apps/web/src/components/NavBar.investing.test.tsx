// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import NavBar from "./NavBar";
import { INVESTING_URL } from "../investing";

/* Investing link is always rendered when a URL resolves (dev → local
 * container, prod → /investing or VITE_INVESTING_URL). It leaves the SPA. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

test("the investing link is a link out, not a nav-item that changes view", async () => {
  expect(INVESTING_URL).toBeTruthy();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  await act(async () => {
    root.render(<NavBar view="overview" modules={[]} onNavigate={() => {}} onOpenProfile={() => {}} />);
  });
  const html = container.innerHTML;
  const right = html.slice(html.indexOf('class="appbar-right"'));
  const link = right.slice(right.indexOf("<a "), right.indexOf("</a>"));
  expect(link).toContain('target="_blank"');
  expect(link).toContain('rel="noopener noreferrer"');
  expect(link).toContain("Investing");
  expect(link).toContain(`href="${INVESTING_URL}"`);
});
