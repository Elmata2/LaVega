import { expect, test } from "vitest";
import { resolvePersonalUrl } from "./personal";

/* De weg terug naar de persoonlijke kant. Spiegelt `resolveInvestingUrl` in
 * apps/web, en de tests spiegelen die ook: het gaat hier niet om de string maar
 * om de drie gevallen die een dode link opleveren als je ze door elkaar haalt —
 * niet ingesteld, leeg ingesteld, en ingesteld met een slash erachter. */

test("a configured origin or path wins, without its trailing slash", () => {
  expect(resolvePersonalUrl({ VITE_PERSONAL_URL: "https://www.lavega.dev/app/" })).toBe(
    "https://www.lavega.dev/app",
  );
  expect(resolvePersonalUrl({ VITE_PERSONAL_URL: "/prive" })).toBe("/prive");
});

/* Leeg is een KEUZE en niet een ontbrekende waarde: wie de investing-app apart
 * uitrolt, zonder persoonlijke kant ernaast, hoort geen knop te krijgen die
 * nergens heen gaat. */
test("blank means do not offer the link at all", () => {
  expect(resolvePersonalUrl({ VITE_PERSONAL_URL: "" })).toBeNull();
  expect(resolvePersonalUrl({ VITE_PERSONAL_URL: "   " })).toBeNull();
});

test("unset falls back per environment, never to a developer's port in production", () => {
  expect(resolvePersonalUrl({ DEV: true })).toBe("http://127.0.0.1:5173/app");
  expect(resolvePersonalUrl({})).toBe("/app");
  expect(resolvePersonalUrl({ DEV: false })).toBe("/app");
});
