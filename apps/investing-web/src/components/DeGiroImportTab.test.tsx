// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { DeGiroImportTab } from "./DeGiroImportTab.js";
import { todayIso } from "../lib/degiroImport.js";

/* Issue #324, web half: the DeGiro tab previews every file, asks for the
 * portfolio export date, commits, and then shows what changed. The server owns
 * parsing and the write; this test only drives the tab against a routing fake. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

type Call = { url: string; init?: RequestInit };

const noRows = { trades: [], cashFlows: [], dividends: [], positions: [], cashBalances: [] };

const accountReport = {
  filename: "Account.csv",
  sha256: "a".repeat(64),
  profile: "account",
  period: { from: "2026-01-05", to: "2026-03-06" },
  rows: {
    ...noRows,
    trades: [{ id: "t1" }],
    cashFlows: [{ id: "c1" }, { id: "c2" }],
    cashBalances: [{ id: "b1" }],
  },
  problems: [],
};

const portfolioReport = {
  filename: "portfolio.csv",
  sha256: "b".repeat(64),
  profile: "portfolio",
  rows: { ...noRows, positions: [{ id: "p1" }], cashBalances: [{ id: "b1" }] },
  problems: [],
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function stubRoutes(bodies: { status: unknown; preview: unknown; commit: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("mode=commit")) return response(bodies.commit);
      if (url.includes("mode=preview")) return response(bodies.preview);
      return response(bodies.status);
    }),
  );
  return calls;
}

function emptyStatus(): unknown {
  return {
    mode: "status",
    importedAt: null,
    files: [],
    coverage: null,
    positionsAsOf: null,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <DeGiroImportTab />
      </MemoryRouter>,
    );
  });
  await settle();
  return container;
}

function findButton(view: HTMLElement, label: string): HTMLButtonElement {
  const button = [...view.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`No button labelled ${label}`);
  return button;
}

function fileInput(view: HTMLElement): HTMLInputElement {
  return view.querySelector("input[type=file]")!;
}

async function choose(view: HTMLElement, file: File): Promise<void> {
  const input = fileInput(view);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

test("the stored import renders as a status line", async () => {
  stubRoutes({
    status: {
      mode: "status",
      importedAt: "2026-11-13T12:00:00.000Z",
      files: [{ filename: "Account.csv", sha256: "a".repeat(64) }],
      coverage: {
        entity: "personal",
        broker: "degiro",
        tradeCash: "cash-flows",
        status: "complete",
        from: "2026-01-05",
        to: "2026-03-06",
      },
      positionsAsOf: "2026-03-06",
    },
    preview: { mode: "preview", files: [] },
    commit: { mode: "commit", committed: false, files: [], totals: noRows, problems: [] },
  });

  const view = await render();
  expect(view.textContent).toContain("Last imported 13 Nov 2026, covers 5 Jan 2026–6 Mar 2026");
});

test("an unknown CSV shows its problem and blocks the import", async () => {
  stubRoutes({
    status: emptyStatus(),
    preview: {
      mode: "preview",
      files: [
        {
          filename: "notes.csv",
          sha256: "c".repeat(64),
          rows: noRows,
          problems: ["Unknown DeGiro format: Naam,Waarde"],
        },
      ],
    },
    commit: { mode: "commit", committed: false, files: [], totals: noRows, problems: [] },
  });

  const view = await render();
  await choose(view, new File(["Naam,Waarde\n"], "notes.csv", { type: "text/csv" }));

  expect(view.textContent).toContain("Unknown DeGiro format: Naam,Waarde");
  expect(view.textContent).toContain("Unknown file");
  expect(view.textContent).toContain("Fix the file problems before importing.");
  expect(findButton(view, "Confirm import").disabled).toBe(true);
});

test("a valid account preview commits and names the totals", async () => {
  const calls = stubRoutes({
    status: emptyStatus(),
    preview: { mode: "preview", files: [accountReport] },
    commit: {
      mode: "commit",
      committed: true,
      importedAt: "2026-11-13T12:00:00.000Z",
      files: [accountReport],
      coverage: {
        entity: "personal",
        broker: "degiro",
        tradeCash: "cash-flows",
        status: "complete",
        from: "2026-01-05",
        to: "2026-03-06",
      },
      totals: { trades: 1, cashFlows: 2, dividends: 0, positions: 1, cashBalances: 1 },
      problems: [],
    },
  });

  const view = await render();
  await choose(view, new File(["Datum\n"], "Account.csv", { type: "text/csv" }));

  expect(view.textContent).toContain("Account statement");
  expect(view.textContent).toContain("1 trade · 2 cash flows · 1 cash balance");
  const commit = findButton(view, "Confirm import");
  expect(commit.disabled).toBe(false);

  await act(async () => commit.click());
  await settle();
  await settle();

  expect(calls.some((call) => call.url.includes("mode=commit"))).toBe(true);
  expect(view.textContent).toContain("Import complete.");
  expect(view.textContent).toContain(
    "Your DeGiro account now holds 1 trade, 2 cash flows, 1 position and 1 cash balance.",
  );
  const overview = [...view.querySelectorAll("a")].find(
    (link) => link.textContent === "View overview",
  );
  expect(overview?.getAttribute("href")).toBe("/");
});

test("a portfolio preview asks for the export date and sends it", async () => {
  const calls = stubRoutes({
    status: emptyStatus(),
    preview: { mode: "preview", files: [portfolioReport] },
    commit: {
      mode: "commit",
      committed: true,
      importedAt: "2026-11-13T12:00:00.000Z",
      files: [portfolioReport],
      totals: { trades: 0, cashFlows: 0, dividends: 0, positions: 1, cashBalances: 1 },
      problems: [],
    },
  });

  const view = await render();
  await choose(view, new File(["Product\n"], "portfolio.csv", { type: "text/csv" }));

  const date = view.querySelector("input[type=date]") as HTMLInputElement;
  expect(date).not.toBeNull();
  expect(date.value).toBe(todayIso());
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(date, "2026-11-12");
    date.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const commit = findButton(view, "Confirm import");
  expect(commit.disabled).toBe(false);
  await act(async () => commit.click());
  await settle();

  const posted = calls.find((call) => call.url.includes("mode=commit"));
  expect(posted).toBeDefined();
  const form = posted!.init!.body as FormData;
  expect(form.get("asOf")).toBe("2026-11-12");
  expect(form.getAll("files")).toHaveLength(1);
});

test("a refused commit can be retried without picking the files again", async () => {
  let commits = 0;
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("mode=commit")) {
        commits += 1;
        if (commits === 1)
          return response({ problems: ["A DeGiro import or sync is already running"] }, 409);
        return response({
          mode: "commit",
          committed: true,
          importedAt: "2026-11-13T12:00:00.000Z",
          files: [accountReport],
          totals: { trades: 1, cashFlows: 2, dividends: 0, positions: 0, cashBalances: 1 },
          problems: [],
        });
      }
      if (url.includes("mode=preview"))
        return response({ mode: "preview", files: [accountReport] });
      return response(emptyStatus());
    }),
  );

  const view = await render();
  await choose(view, new File(["Datum\n"], "Account.csv", { type: "text/csv" }));

  await act(async () => findButton(view, "Confirm import").click());
  await settle();
  expect(view.textContent).toContain("Import failed");
  expect(view.textContent).toContain("A DeGiro import or sync is already running");
  const retry = findButton(view, "Confirm import");
  expect(retry.disabled).toBe(false);

  await act(async () => retry.click());
  await settle();
  expect(view.textContent).toContain("Import complete.");
  expect(calls.filter((call) => call.url.includes("mode=commit"))).toHaveLength(2);
});
