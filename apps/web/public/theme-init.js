/* Applies the stored theme before first paint. External file because the app
 * runs under CSP `script-src 'self'` (no inline script). Keep in step with
 * src/lib/theme.ts: same key, same midnight fallback. Mono applies only on
 * /app and /app/*: every other path renders the landing page (Root.tsx), which
 * is midnight in every theme, so mono must never paint there. Same test as
 * appRoutes.isAppPathname. The script cannot know the session, so a signed-out
 * /app starts mono and MidnightScope (Root.tsx) corrects it before paint. */
(function () {
  var mono = false;
  try {
    var path = window.location.pathname.replace(/\/+$/, "") || "/";
    var inApp = path === "/app" || path.indexOf("/app/") === 0;
    mono = inApp && window.localStorage.getItem("lavega.theme") === "mono";
  } catch {
    /* storage blocked: midnight */
  }
  var root = document.documentElement;
  if (mono) root.dataset.theme = "mono";
  else delete root.dataset.theme;
  root.style.colorScheme = mono ? "light" : "dark";
})();
