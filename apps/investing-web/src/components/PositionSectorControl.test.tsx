// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { PositionSectorControl } from "./PositionSectorControl.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

function selectSector(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

test("shows the resolved sector and an inferred badge with its confidence", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ sector: "Technology", source: "inferred", confidence: 0.7 })),
    ),
  );
  const { container, root } = render();
  act(() => root.render(<PositionSectorControl symbol="MYST" />));
  await act(async () => {});
  expect(container.textContent).toContain("Technology");
  expect(container.textContent).toMatch(/inferred/i);
  expect(container.textContent).toContain("70%");
});

test("shows a your-correction badge instead of inferred when the owner already corrected it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ sector: "Healthcare", source: "correction" }))),
  );
  const { container, root } = render();
  act(() => root.render(<PositionSectorControl symbol="MYST" />));
  await act(async () => {});
  expect(container.textContent).toMatch(/your correction/i);
  expect(container.textContent).not.toMatch(/inferred/i);
});

test("shows no badge for a provider-sourced or unknown sector", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ sector: "Technology", source: "provider" }))),
  );
  const { container, root } = render();
  act(() => root.render(<PositionSectorControl symbol="AAPL" />));
  await act(async () => {});
  expect(container.textContent).not.toMatch(/inferred/i);
  expect(container.textContent).not.toMatch(/your correction/i);
});

test("saving a correction PUTs the chosen sector and shows it with a your-correction badge", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ sector: "Healthcare", source: "correction" }));
  });
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ sector: "Technology", source: "inferred", confidence: 0.7 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { container, root } = render();
  act(() => root.render(<PositionSectorControl symbol="MYST" />));
  await act(async () => {});

  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Correct sector"]')!;
  await act(async () => selectSector(select, "Healthcare"));
  const saveButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Save",
  )!;
  await act(async () => {
    saveButton.click();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Healthcare");
  expect(container.textContent).toMatch(/your correction/i);
  expect(container.textContent).not.toMatch(/inferred/i);
  const put = requests.find((request) => request.init?.method === "PUT");
  expect(put?.url).toBe("/api/investing/positions/MYST/sector");
  expect(put?.init?.body).toBe(JSON.stringify({ sector: "Healthcare" }));
});

test("resetting a correction DELETEs it and reloads the automatic sector", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ sector: "Technology", source: "provider" }));
  });
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ sector: "Healthcare", source: "correction" })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { container, root } = render();
  act(() => root.render(<PositionSectorControl symbol="AAPL" />));
  await act(async () => {});

  const resetButton = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Reset to automatic"),
  )!;
  await act(async () => {
    resetButton.click();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Technology");
  expect(container.textContent).not.toMatch(/your correction/i);
  const del = requests.find((request) => request.init?.method === "DELETE");
  expect(del?.url).toBe("/api/investing/positions/AAPL/sector");
});

test("a fund's 422 hides the correction control and explains why", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT")
      return new Response(
        JSON.stringify({ message: "A fund's sector is its look-through weight vector" }),
        { status: 422 },
      );
    return new Response(JSON.stringify({ sector: "Healthcare", source: "provider" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const { container, root } = render();
  act(() => root.render(<PositionSectorControl symbol="VFEM.L" />));
  await act(async () => {});

  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Correct sector"]')!;
  await act(async () => selectSector(select, "Technology"));
  const saveButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Save",
  )!;
  await act(async () => {
    saveButton.click();
    await Promise.resolve();
  });

  expect(container.querySelector('select[aria-label="Correct sector"]')).toBeNull();
  expect(container.textContent).toMatch(/split across its holdings/i);
});

test("kind fund from GET hides the correction control from the start, with no PUT needed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ kind: "fund", sector: null, source: "provider" }))),
  );
  const { container, root } = render();
  act(() => root.render(<PositionSectorControl symbol="VFEM.L" />));
  await act(async () => {});

  expect(container.querySelector('select[aria-label="Correct sector"]')).toBeNull();
  expect(container.textContent).toMatch(/split across its holdings/i);
});

test("kind stock from GET shows the resolved sector and the correction control", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ kind: "stock", sector: "Technology", source: "provider" }))),
  );
  const { container, root } = render();
  act(() => root.render(<PositionSectorControl symbol="AAPL" />));
  await act(async () => {});

  expect(container.textContent).toContain("Technology");
  expect(container.querySelector('select[aria-label="Correct sector"]')).not.toBeNull();
});

test("a missing kind is treated as a stock, for backward compatibility with an older server", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ sector: "Technology", source: "provider" }))),
  );
  const { container, root } = render();
  act(() => root.render(<PositionSectorControl symbol="AAPL" />));
  await act(async () => {});

  expect(container.textContent).toContain("Technology");
  expect(container.querySelector('select[aria-label="Correct sector"]')).not.toBeNull();
});
