import { beforeEach } from "vitest";
import { LOCALE_COOKIE } from "./locale.js";

/* Every test here was written against the Dutch screens. The app now falls
 * back to English for a browser that is not Dutch, and jsdom never is, so
 * without this the suite reads a language none of its assertions were written
 * for. Pinning the cookie once keeps those assertions honest; a test that
 * wants the English screens sets the cookie itself.
 *
 * The guard below is the trap. A test running in vitest's default Node
 * environment has no `document`, so it gets no cookie, so `readAppLocale()`
 * falls through to English and the component renders a language the test
 * never asked for. A test with Dutch assertions fails loudly and you find it.
 * A test with English assertions passes for the wrong reason and you don't.
 * Any test rendering a component that calls `useAppLocale()` therefore needs
 * `// @vitest-environment jsdom` as its first line, or its own cookie stub the
 * way `NavBar.test.tsx` does. Stubbing `document` globally here would be the
 * tidier fix but a bare stub breaks `applyDocumentLocale`, which reaches for
 * `documentElement` and `querySelector`. */
beforeEach(() => {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=nl; Path=/`;
});
