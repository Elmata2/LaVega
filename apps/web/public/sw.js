/* LaVega service worker: shows a push notification and opens the app when it
 * is clicked. It caches nothing and intercepts no requests. The server sends a generic
 * title and text ("you have a new message") and the feed URL; the worker shows exactly
 * what it is given and never builds text of its own from user data. */
/* Only a same-origin path is ever opened; anything else becomes /app. */
function safeTarget(raw) {
  if (typeof raw !== "string") return "/app";
  try {
    const u = new URL(raw, self.location.origin);
    if (u.origin !== self.location.origin) return "/app";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/app";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "LaVega";
  const body = typeof data.body === "string" ? data.body : "";
  const url = safeTarget(data.url);
  event.waitUntil(self.registration.showNotification(title, { body, data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeTarget(event.notification.data?.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus().then((w) => (w || open).navigate(target));
      return self.clients.openWindow(target);
    }),
  );
});
