/* Nothing in the preview may leave the machine. Same-origin /api/* is answered
 * here with fixed fixtures; same-origin non-API requests (Vite's own modules)
 * pass through; everything else is refused and counted. */
export const PREVIEW_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

const refused: string[] = [];
export const refusedRequests = (): readonly string[] => refused;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function installNetworkStub(): void {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) {
      refused.push(url.href);
      return json({ error: "preview: network blocked" }, 503);
    }
    if (url.pathname === "/api/vault/key") return json({ key: PREVIEW_KEY_B64 });
    if (url.pathname === "/api/agent/status") return json({ configured: false });
    if (url.pathname.startsWith("/api/")) return json({ error: "preview: stubbed" }, 404);
    return real(input, init);
  };
  navigator.sendBeacon = () => {
    refused.push("sendBeacon");
    return false;
  };
}
