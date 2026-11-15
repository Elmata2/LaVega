// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { emptyProfile, type AdvisorProfileStore } from "@lavega/core";
import { applyBuffer, applyHousehold } from "./state";
import { useProfileCommit, type ProfileCommit } from "./useProfileCommit";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-23";
const NOW = "2026-10-23T10:00:00Z";
let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mountHook(onSave: (s: AdvisorProfileStore) => Promise<void>) {
  const ref: { current: ProfileCommit | null } = { current: null };
  const initial: AdvisorProfileStore = {
    current: emptyProfile(),
    versions: [],
    updatedAt: "2026-10-01T00:00:00Z",
  } as AdvisorProfileStore;
  function Probe() {
    const h = useProfileCommit(initial, onSave, () => NOW);
    useEffect(() => {
      ref.current = h;
    });
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Probe />));
  return ref;
}

test("overlapping saves are serialised: a failing first save does not discard the second edit", async () => {
  const persisted: AdvisorProfileStore[] = [];
  let calls = 0;
  const onSave = vi.fn(async (st: AdvisorProfileStore): Promise<void> => {
    calls += 1;
    if (calls === 1) {
      await new Promise((r) => setTimeout(r, 20));
      throw new Error("flaky");
    }
    persisted.push(st);
  });
  const hook = mountHook(onSave);
  let first = true;
  let second = true;
  await act(async () => {
    const a = hook.current!.update((p) =>
      applyHousehold(p, { kind: "together" }, AS_OF),
    );
    const b = hook.current!.update((p) => applyBuffer(p, 6, AS_OF));
    first = await a;
    second = await b;
    await new Promise((r) => setTimeout(r, 40));
  });
  expect(first).toBe(false);
  expect(second).toBe(true);
  expect(persisted.at(-1)!.current.buffer?.value.months).toBe(6);
  expect(hook.current!.store.current.buffer?.value.months).toBe(6);

  await act(async () => {
    await hook.current!.update((p) =>
      applyHousehold(p, { kind: "alone" }, AS_OF),
    );
  });
  const after = persisted.at(-1)!;
  expect(after.current.buffer?.value.months).toBe(6);
  expect(after.current.household?.value.kind).toBe("alone");
});
