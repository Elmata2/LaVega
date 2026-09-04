import { expect, test } from "vitest";
import { LocalKeySource } from "./localKeySource.js";

test("local key source reads existing environment names and reports missing key plainly", () => {
  const source = new LocalKeySource({
    ANTHROPIC_API_KEY: " anthropic-secret ",
    MARKET_DATA_API_KEY: "",
  });

  expect(source.getKey("llm")).toBe("anthropic-secret");
  expect(source.getStatus("llm")).toMatchObject({
    configured: true,
    envVar: "ANTHROPIC_API_KEY",
    missingMessage: null,
  });
  expect(source.getKey("market-data")).toBeNull();
  expect(source.getStatus("market-data")).toMatchObject({
    configured: false,
    envVar: "MARKET_DATA_API_KEY",
    missingMessage: "Required key MARKET_DATA_API_KEY is missing.",
  });
});
