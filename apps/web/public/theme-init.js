/* Applies the stored theme before first paint. External file because the app
 * runs under CSP `script-src 'self'` (no inline script). Keep in step with
 * src/lib/theme.ts: same key, same midnight fallback. */
(function () {
  var mono = false;
  try {
    mono = window.localStorage.getItem("lavega.theme") === "mono";
  } catch {
    /* storage blocked: midnight */
  }
  var root = document.documentElement;
  if (mono) root.dataset.theme = "mono";
  else delete root.dataset.theme;
  root.style.colorScheme = mono ? "light" : "dark";
})();
