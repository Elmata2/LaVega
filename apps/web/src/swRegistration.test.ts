import { expect, test, vi } from "vitest";
import { registerServiceWorker } from "./swRegistration";

const nav = () => {
  const register = vi.fn(async () => ({}));
  return { register, nav: { serviceWorker: { register } } as unknown as Navigator };
};

test("signed out: nothing is registered", async () => {
  const n = nav();
  expect(await registerServiceWorker(false, n.nav)).toBe(false);
  expect(n.register).not.toHaveBeenCalled();
});

test("signed in: registers /sw.js and never requests notification permission", async () => {
  const request = vi.fn();
  vi.stubGlobal("Notification", { requestPermission: request });
  const n = nav();
  expect(await registerServiceWorker(true, n.nav)).toBe(true);
  expect(n.register).toHaveBeenCalledWith("/sw.js");
  expect(request).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("a browser without service workers, or a failed register, returns false", async () => {
  expect(await registerServiceWorker(true, {} as Navigator)).toBe(false);
  const register = vi.fn(async () => {
    throw new Error("x");
  });
  expect(
    await registerServiceWorker(true, { serviceWorker: { register } } as unknown as Navigator),
  ).toBe(false);
});
