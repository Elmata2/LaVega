/* Stands in for src/posthog.ts in the preview, which would otherwise throw in
 * `vite dev` for want of a PostHog key and would phone home if it had one. */
const noop = () => undefined;
const posthog = new Proxy(
  {},
  { get: (_t, prop) => (prop === "logger" ? { info: noop, warn: noop, error: noop } : noop) },
) as unknown as typeof import("posthog-js").default;
export const posthogConfigured = false;
export default posthog;
