import { expect, test } from "vitest";
import { createOpenFigiIdentifierProvider } from "./openFigiProvider.js";

type Post = (url: string, body: unknown) => Promise<unknown>;
function countingPost(impl: (call: number) => Promise<unknown>) {
  let calls = 0;
  const post: Post = async (url, body) => { calls += 1; return impl(calls); };
  return { post, calls: () => calls };
}

const instant = { now: () => 0, sleep: async () => undefined };

test("caches successful OpenFIGI resolutions", async () => {
  const { post, calls } = countingPost(async () => [{ data: [{ ticker: "ASML", exchCode: "AMS", name: "ASML" }] }]);
  const provider = createOpenFigiIdentifierProvider({ client: { postJson: post }, ...instant });

  await expect(provider.get({ isin: "NL0010273215" })).resolves.toMatchObject({ match: { ticker: "ASML" } });
  await expect(provider.get({ isin: "nl0010273215" })).resolves.toMatchObject({ match: { ticker: "ASML" } });
  expect(calls()).toBe(1);
});

test("retries rate-limited requests and does not cache the failure", async () => {
  const { post, calls } = countingPost(async (call) => call === 1
    ? Promise.reject(Object.assign(new Error("OpenFIGI HTTP 429"), { status: 429, retryAfterMs: 1 }))
    : Promise.resolve([{ data: [{ ticker: "ASML" }] }]));
  const provider = createOpenFigiIdentifierProvider({ client: { postJson: post }, now: () => 0, sleep: async () => undefined });

  await expect(provider.get({ isin: "NL0010273215" })).resolves.toMatchObject({ match: { ticker: "ASML" }, problems: [] });
  expect(calls()).toBe(2);
});

test("non-retryable errors surface as problems without retry", async () => {
  const { post, calls } = countingPost(async () => Promise.reject(Object.assign(new Error("OpenFIGI HTTP 404"), { status: 404 })));
  const provider = createOpenFigiIdentifierProvider({ client: { postJson: post }, ...instant });

  const result = await provider.get({ isin: "NL0000" });
  if (!result) throw new Error("openfigi provider unexpectedly returned null");
  expect(result.problems).toHaveLength(1);
  expect(calls()).toBe(1);
});
