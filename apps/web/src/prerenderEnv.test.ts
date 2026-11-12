import { expect, test } from "vitest";
import config from "../vite.config.js";

type ConfigFn = (env: { command: "build"; mode: string; isSsrBuild: boolean }) => {
  envPrefix?: string;
};
const resolve = (isSsrBuild: boolean) =>
  (config as unknown as ConfigFn)({ command: "build", mode: "production", isSsrBuild });

test("the pre-render build sees no VITE_ variables, so PostHog and API urls stay out of it", () => {
  const prefix = resolve(true).envPrefix;
  expect(prefix).toBeDefined();
  expect("VITE_POSTHOG_KEY".startsWith(prefix!)).toBe(false);
  expect("VITE_API_URL".startsWith(prefix!)).toBe(false);
});

test("the browser build still reads VITE_ variables", () => {
  expect(resolve(false).envPrefix ?? "VITE_").toBe("VITE_");
});
