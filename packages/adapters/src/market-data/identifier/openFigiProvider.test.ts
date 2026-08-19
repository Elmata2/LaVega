import { expect, test, vi } from "vitest";
import { createOpenFigiIdentifierProvider } from "./openFigiProvider.js";

test("caches failed OpenFIGI resolutions", async () => {
  const postJson = vi.fn().mockRejectedValue(new Error("rate limited"));
  const provider = createOpenFigiIdentifierProvider({ client: { postJson } });

  await expect(provider.get({ isin: "NL0010273215" })).resolves.toMatchObject({ problems: ["OpenFIGI identifier request failed: rate limited"] });
  await expect(provider.get({ isin: "nl0010273215" })).resolves.toMatchObject({ problems: ["OpenFIGI identifier request failed: rate limited"] });
  expect(postJson).toHaveBeenCalledOnce();
});
