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

/* jsdom 30.0.1 has no `showModal`/`close` on HTMLDialogElement at all — not a
 * broken stub, the properties are simply undefined, so calling either throws
 * "is not a function". `.open` already reflects the `open` attribute in both
 * directions in this jsdom version (verified with a throwaway script), so the
 * polyfill only needs to own the attribute; it does not need to redefine
 * `.open` itself.
 *
 * `close()` does NOT dispatch a `close` event here, matching the real browser:
 * measured against the built app with a plain native listener and no React
 * involved (showModal()+close() on one dialog, 600ms observed), the real
 * browser fired zero `close` events. A polyfill that synthesized one — as
 * this used to — asserts a mechanism production doesn't have; Landing.tsx no
 * longer depends on `close` for anything, so the polyfill shouldn't either. */
if (typeof document !== "undefined" && typeof HTMLDialogElement !== "undefined") {
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== "function") {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
}
