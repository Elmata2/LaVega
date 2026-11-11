/** Registers the push service worker. Only for a signed-in user; it never asks
 *  for notification permission (that stays an explicit click in settings). */
export async function registerServiceWorker(
  signedIn: boolean,
  nav: Pick<Navigator, "serviceWorker"> | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): Promise<boolean> {
  if (!signedIn || !nav?.serviceWorker) return false;
  try {
    await nav.serviceWorker.register("/sw.js");
    return true;
  } catch {
    return false;
  }
}
