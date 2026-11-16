// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import Import from "./Import";
import { CardFileContext } from "../components/import/CardFileContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

test("Importeren opens the file dialog from a button, not a bare file input", () => {
  const open = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <CardFileContext.Provider value={open}>
        <Import
          entity="Prive"
          onEntityChange={() => {}}
          busy={false}
          problems={[]}
          onRefreshBank={() => {}}
        />
      </CardFileContext.Provider>,
    ),
  );
  expect(host.querySelector('input[type="file"]')).toBeNull();
  act(() => host!.querySelector<HTMLButtonElement>("button.import-file")!.click());
  expect(open).toHaveBeenCalledWith(null);
  expect(host.textContent).toContain("Koppel je bank");
  expect(host.textContent).not.toContain("Enable Banking)");
});
