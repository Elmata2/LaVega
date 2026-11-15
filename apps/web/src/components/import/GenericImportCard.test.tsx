// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { Account, ImportSession, Tx } from "@lavega/core";
import GenericImportCard, { type GenericImportRequest } from "./GenericImportCard.js";

/* The generic import card (WS3.6, issue #294): a file maps, the dry run shows
 * what will land, the cross-format warning refuses by default, and an earlier
 * session can be reverted. The mapping/dedupe rules themselves are pinned by
 * core's csvImport.test.ts; this is the card's contract. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const account: Account = {
  key: "NL01INGB",
  iban: "NL01INGB00001234",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
};

const CSV = [
  "Datum;Tegenpartij;Omschrijving;Bedrag",
  "2026-10-02;Albert Heijn;Boodschappen;-25,50",
  "2026-10-03;Werkgever;Salaris;2000,00",
  "geen-datum;Onbekend;Zonder datum;-10,00",
].join("\n");

function imports(
  overrides: {
    sessions?: ImportSession[];
    txs?: Tx[];
    onImport?: (request: GenericImportRequest) => void;
    onRevert?: (id: string) => void;
  } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <GenericImportCard
        accounts={[account]}
        existingTxs={overrides.txs ?? []}
        sessions={overrides.sessions ?? []}
        busy={false}
        notice={null}
        onImport={overrides.onImport ?? (() => {})}
        onRevert={overrides.onRevert ?? (() => {})}
      />,
    ),
  );
  return container;
}

async function chooseCsv(file = CSV, name = "export.csv") {
  const input = container!.querySelector<HTMLInputElement>('[data-testid="generic-import-file"]')!;
  const blob = new File([file], name, { type: "text/csv" });
  Object.defineProperty(input, "files", { value: [blob], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const byTestId = (id: string): HTMLElement =>
  container!.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

test("a chosen csv maps its columns and shows the dry run before anything is written", async () => {
  imports();
  await chooseCsv();
  // The header row mapped itself: the mapping selects carry the column indexes.
  expect((byTestId("generic-map-date") as HTMLSelectElement).value).toBe("0");
  expect((byTestId("generic-map-amount") as HTMLSelectElement).value).toBe("3");
  // No account chosen yet: no plan, no import.
  expect(byTestId("generic-import-run")).toBeNull();
  const select = byTestId("generic-import-account") as HTMLSelectElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      select,
      "NL01INGB",
    );
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const counts = byTestId("generic-import-counts")!.textContent ?? "";
  // 3 read, 2 new, 0 duplicate, 1 rejected.
  expect(counts).toContain("3");
  expect(counts).toContain("2");
  expect(counts).toContain("1");
  expect(byTestId("generic-import-preview")!.textContent).toContain("Albert Heijn");
  // The rejected row carries its reason, never a silent drop.
  expect(byTestId("generic-import-rejected")!.textContent).toContain("geen geldige datum");
});

test("importing hands the confirmed plan to the app, never the raw file", async () => {
  let captured: GenericImportRequest | null = null;
  imports({
    onImport: (request) => {
      captured = request;
    },
  });
  await chooseCsv();
  const select = byTestId("generic-import-account") as HTMLSelectElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      select,
      "NL01INGB",
    );
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  act(() => byTestId("generic-import-run").click());
  expect(captured).not.toBeNull();
  const request = captured as GenericImportRequest | null;
  expect(request?.plan.newRows).toHaveLength(2);
  expect(request?.filename).toBe("export.csv");
});

test("a second format for the same account warns and refuses until the owner overrides", async () => {
  imports({
    sessions: [
      {
        id: "s1",
        documentId: null,
        filename: "mt940.sta",
        accountKey: "NL01INGB",
        format: "mt940",
        importedAt: "2026-10-31",
        txIds: [],
        rowsRead: 1,
        rowsImported: 1,
        duplicatesSkipped: 0,
        rowsRejected: 0,
      },
    ],
  });
  await chooseCsv();
  const select = byTestId("generic-import-account") as HTMLSelectElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      select,
      "NL01INGB",
    );
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(byTestId("generic-import-cross-format")!.textContent).toContain("MT940");
  expect((byTestId("generic-import-run") as HTMLButtonElement).disabled).toBe(true);
  const override = byTestId("generic-import-override") as HTMLInputElement;
  act(() => override.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect((byTestId("generic-import-run") as HTMLButtonElement).disabled).toBe(false);
});

test("an earlier import is listed and can be reverted", () => {
  const reverted: string[] = [];
  imports({
    sessions: [
      {
        id: "session-1",
        documentId: "sha",
        filename: "export.csv",
        accountKey: "NL01INGB",
        format: "generic-csv",
        importedAt: "2026-11-11",
        txIds: ["a", "b"],
        rowsRead: 2,
        rowsImported: 2,
        duplicatesSkipped: 0,
        rowsRejected: 0,
      },
    ],
    onRevert: (id) => reverted.push(id),
  });
  expect(byTestId("generic-import-sessions")!.textContent).toContain("export.csv");
  act(() => byTestId("generic-import-revert-session-1").click());
  expect(reverted).toEqual(["session-1"]);
});
