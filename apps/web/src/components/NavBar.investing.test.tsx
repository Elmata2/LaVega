// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import NavBar from "./NavBar";
import { INVESTING_URL } from "../investing";

/* The link to the investing app, which his second review found "opens a
 * localhost which refused to connect" — it was hardcoded to 127.0.0.1:8790,
 * the port a docker container publishes on one developer machine. So the link
 * now waits for an answer from the investing app before it renders at all.
 *
 * These tests live apart from NavBar.test.tsx because they need a DOM (the
 * probe runs in an effect) while that file reads its own source off disk, which
 * jsdom's import.meta.url cannot do. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realFetch = globalThis.fetch;
let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  globalThis.fetch = realFetch;
});

/** Mount the real NavBar with a stubbed investing app, and hand back its
 *  markup once the reachability probe has settled. */
async function mountNavBar(investing: "answers" | "refused"): Promise<string> {
  globalThis.fetch = (async () => {
    if (investing === "refused") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ ok: true, service: "investing-server" }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
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
  return container.innerHTML;
}

test("no link to the investing app while nothing answers there", async () => {
  const html = await mountNavBar("refused");
  expect(html).toContain("Profiel"); // the rest of the bar is untouched
  expect(html).not.toContain("Investing");
  expect(html).not.toContain("investing");
});

test("once the investing app answers, the link is a link out, not a nav-item that changes view", async () => {
  const html = await mountNavBar("answers");
  const right = html.slice(html.indexOf('class="appbar-right"'));
  const link = right.slice(right.indexOf("<a "), right.indexOf("</a>"));
  expect(link).toContain('target="_blank"');
  expect(link).toContain('rel="noopener noreferrer"');
  expect(link).toContain("Investing");
  // It leaves the SPA entirely: a real href, not an onClick that flips `view`.
  expect(INVESTING_URL).toBeTruthy();
  expect(link).toContain(`href="${INVESTING_URL}"`);
});
