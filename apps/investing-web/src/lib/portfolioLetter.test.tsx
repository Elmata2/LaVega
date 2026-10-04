// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  letterToText,
  useLatestLetter,
  type LetterState,
  type PortfolioLetter,
} from "./portfolioLetter";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const letter: PortfolioLetter = {
  id: "11111111-1111-4111-8111-111111111111",
  snapshotHash: "s",
  holdingsHash: "h",
  createdAt: "2026-10-03T04:00:00Z",
  verdict: "Too much in one basket.",
  observations: [{ title: "ASML", body: "It is 42%.", figures: ["42%"] }],
};

async function read(
  response: () => Promise<Response>,
): Promise<{ state: LetterState; calls: string[] }> {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return response();
  });
  function Probe() {
    return <output>{JSON.stringify(useLatestLetter())}</output>;
  }
  const container = document.body.appendChild(document.createElement("div"));
  await act(async () => createRoot(container).render(<Probe />));
  return { state: JSON.parse(container.textContent ?? "null") as LetterState, calls };
}

test("a stored letter loads, and only by a GET read", async () => {
  const { state, calls } = await read(async () => Response.json({ letter }));
  expect(state).toEqual({ status: "ready", letter });
  expect(calls).toEqual(["GET /api/letters/latest"]);
});

test("no letter is the empty state, and a bad payload is an error", async () => {
  expect((await read(async () => Response.json({ letter: null }))).state).toEqual({
    status: "empty",
  });
  document.body.replaceChildren();
  expect((await read(async () => Response.json({ letter: { id: 1 } }))).state.status).toBe("error");
  document.body.replaceChildren();
  expect((await read(async () => new Response("", { status: 503 }))).state).toEqual({
    status: "error",
    message: "Failed to load letter: 503",
  });
});

test("the letter becomes plain text without Markdown", () => {
  const text = letterToText(letter);
  expect(text).toContain("Too much in one basket.");
  expect(text).toContain("1. ASML. It is 42%. (42%)");
  expect(text).not.toMatch(/[*#]/);
});
