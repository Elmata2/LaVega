/* Sets the stored theme before first paint. External file because the app runs
 * under CSP `script-src 'self'` (no inline script). Keep in step with
 * src/lib/theme.ts: same key, same dark fallback. */
(function () {
  var theme = "dark";
  try {
    if (window.localStorage.getItem("lavega-investing-theme") === "light") theme = "light";
  } catch {
    /* storage blocked: dark */
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
