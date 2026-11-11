/* The browser half of push: permission and subscription. Notification
 * permission is only ever asked from here, from a click handler in settings,
 * never on load (swRegistration.ts only registers the worker). */

export type PushPermission = "granted" | "denied" | "default";

export type PushBrowser = {
  supported(): boolean;
  permission(): PushPermission;
  request(): Promise<PushPermission>;
  subscribe(vapidPublicKey: string): Promise<PushSubscriptionJSON | null>;
  unsubscribe(): Promise<string | null>;
};

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const browserPush: PushBrowser = {
  supported: () =>
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window,
  permission: () => (typeof Notification === "undefined" ? "denied" : Notification.permission),
  request: async () => (await Notification.requestPermission()) as PushPermission,
  async subscribe(vapidPublicKey) {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(vapidPublicKey),
      }));
    return subscription.toJSON();
  },
  async unsubscribe() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return null;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    return endpoint;
  },
};
