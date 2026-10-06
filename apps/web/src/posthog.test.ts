import { expect, test } from "vitest";
import posthog, { posthogConfigured } from "./posthog";

test("unset PostHog env does not throw under Vitest", () => {
  expect(import.meta.env.VITE_POSTHOG_KEY).toBeFalsy();
  expect(import.meta.env.VITE_POSTHOG_HOST).toBeFalsy();
  expect(posthogConfigured).toBe(false);
  expect(typeof posthog.capture).toBe("function");
});
