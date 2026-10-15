// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  letterToText,
  requestLetter,
  useLatestLetter,
  type LetterState,
  type LetterWriteState,
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

async function read(response: (method: string) => Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${String(input)}`);
    return response(method);
  });
  function Probe() {
    const { state, writeState, write } = useLatestLetter();
    return (
      <>
        <output>{JSON.stringify({ state, writeState })}</output>
        <button type="button" onClick={write}>
          write
        </button>
      </>
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  await act(async () => createRoot(container).render(<Probe />));
  const snapshot = () =>
    JSON.parse(container.querySelector("output")!.textContent ?? "null") as {
      state: LetterState;
      writeState: LetterWriteState;
    };
  const write = async () => {
    await act(async () => {
      container.querySelector("button")!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return { snapshot, write, calls };
}

test("a stored letter loads, and only by a GET read", async () => {
  const { snapshot, calls } = await read(async () => Response.json({ letter }));
  expect(snapshot().state).toEqual({ status: "ready", letter });
  expect(snapshot().writeState).toEqual({ status: "idle" });
  expect(calls).toEqual(["GET /api/letters/latest"]);
});

test("no letter is the empty state, and a bad payload is an error", async () => {
  expect((await read(async () => Response.json({ letter: null }))).snapshot().state).toEqual({
    status: "empty",
  });
  document.body.replaceChildren();
  expect(
    (await read(async () => Response.json({ letter: { id: 1 } }))).snapshot().state.status,
  ).toBe("error");
  document.body.replaceChildren();
  expect((await read(async () => new Response("", { status: 503 }))).snapshot().state).toEqual({
    status: "error",
    message: "Failed to load letter: 503",
  });
});

test("write letter now posts once and shows the written letter", async () => {
  const { snapshot, write, calls } = await read(async (method) =>
    method === "POST"
      ? Response.json({ letter, generated: true })
      : Response.json({ letter: null }),
  );
  expect(snapshot().state).toEqual({ status: "empty" });

  await write();

  expect(calls).toEqual(["GET /api/letters/latest", "POST /api/letters/ensure"]);
  expect(snapshot().state).toEqual({ status: "ready", letter });
  expect(snapshot().writeState).toEqual({ status: "idle" });
});

test("a refused write says nothing changed and keeps the stored letter", async () => {
  const { snapshot, write } = await read(async (method) =>
    method === "POST"
      ? Response.json({ letter, generated: false })
      : Response.json({ letter: null }),
  );
  await write();
  expect(snapshot().state).toEqual({ status: "ready", letter });
  expect(snapshot().writeState).toEqual({ status: "unchanged" });
});

test("a failed write surfaces the server problem and keeps the read state", async () => {
  const { snapshot, write } = await read(async (method) =>
    method === "POST"
      ? Response.json({ problems: ["Portfolio letters need a database"] }, { status: 503 })
      : Response.json({ letter }),
  );
  await write();
  expect(snapshot().state).toEqual({ status: "ready", letter });
  expect(snapshot().writeState).toEqual({
    status: "error",
    message: "Portfolio letters need a database",
  });
});

test("requestLetter returns the letter and the generated flag", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ letter, generated: true }));
  await expect(requestLetter()).resolves.toEqual({ letter, generated: true });
});

test("requestLetter rejects a payload without a letter", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ generated: true }));
  await expect(requestLetter()).rejects.toThrow("Letter has an invalid format.");
});

test("the letter becomes plain text without Markdown", () => {
  const text = letterToText(letter);
  expect(text).toContain("Too much in one basket.");
  expect(text).toContain("1. ASML. It is 42%. (42%)");
  expect(text).not.toMatch(/[*#]/);
});
