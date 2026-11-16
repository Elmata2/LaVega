/* Applies the stored theme before first paint. External file because the app
 * runs under CSP `script-src 'self'` (no inline script). Keep in step with
 * src/lib/theme.ts: same key, same midnight fallback; the retired "mono" value reads as light. Light applies only on
 * /app and /app/*: every other path renders the landing page (Root.tsx), which
 * is midnight in every theme, so light must never paint there. Same test as
 * appRoutes.isAppPathname. The script cannot know the session, so a signed-out
 * /app starts light and MidnightScope (Root.tsx) corrects it before paint. */
(function () {
  var light = false;
  try {
    var path = window.location.pathname.replace(/\/+$/, "") || "/";
    var inApp = path === "/app" || path.indexOf("/app/") === 0;
    var stored = window.localStorage.getItem("lavega.theme");
    light = inApp && (stored === "light" || stored === "mono");
  } catch {
    /* storage blocked: midnight */
  }
  var root = document.documentElement;
  if (light) root.dataset.theme = "light";
  else delete root.dataset.theme;
  root.style.colorScheme = light ? "light" : "dark";
})();
