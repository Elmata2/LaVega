import posthog from "posthog-js";

const apiKey = import.meta.env.VITE_POSTHOG_KEY;
const apiHost = import.meta.env.VITE_POSTHOG_HOST;
export const posthogConfigured = Boolean(apiKey && apiHost);

/* Vitest leaves DEV true and sets MODE to "test". A missing key must not fail
 * the suite, and the SDK must not start. `vite dev` still throws. */
const runningTests = import.meta.env.MODE === "test";

if (!runningTests && (!apiKey || !apiHost)) {
  if (import.meta.env.DEV) {
    const missingVariable = apiKey ? "VITE_POSTHOG_HOST" : "VITE_POSTHOG_KEY";
    throw new Error(
      `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
    );
  }
} else if (!runningTests && apiKey && apiHost) {
  posthog.init(apiKey, {
    api_host: apiHost,
    defaults: "2026-05-30",
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    logs: {
      serviceName: "lavega-web",
      environment: import.meta.env.MODE,
    },
  });
}

export default posthog;
