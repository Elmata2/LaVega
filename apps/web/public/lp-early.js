/* Landing page, before the app bundle has loaded. The prerendered page is
 * readable in under 2s on a 3G connection, but its buttons only work once the
 * ~800 KB bundle has arrived (6s+). Without this file a tap in that gap is lost
 * and the visitor sees nothing happen. This records the last sign-in / sign-up
 * tap and marks the button busy; Landing.tsx replays it on mount. Loaded as a
 * separate same-origin file because the CSP forbids inline script. */
(function () {
  document.addEventListener(
    "click",
    function (e) {
      var t = e.target instanceof Element ? e.target.closest("[data-lp-tap]") : null;
      if (!t) return;
      window.__lpTap = t.getAttribute("data-lp-tap");
      t.setAttribute("aria-busy", "true");
    },
    true,
  );
})();
