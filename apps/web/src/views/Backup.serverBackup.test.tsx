// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { CipherBlob, VaultStorage } from "@lavega/adapters";
import Backup from "./Backup";
import { SIGNED_OUT_MESSAGE } from "../api.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const blob: CipherBlob = {
  v: 1,
  kdf: "PBKDF2-SHA256",
  iterations: 210_000,
  salt: "c2FsdA==",
  iv: "aXY=",
  ct: "Y2lwaGVy",
};

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

async function render(storage: Partial<VaultStorage> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const full = { export: () => blob, ...storage } as VaultStorage;
  await act(async () => {
    root!.render(<Backup storage={full} asOf="2026-08-31" onRestored={() => {}} />);
  });
  return container;
}

const button = (label: string) =>
  [...container!.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(label),
  );

test("a signed-out user is invited to log in, not shown a broken backup", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 401 })),
  );

  await render();

  expect(container!.textContent).toContain("Log in om je versleutelde kluis");
  expect(button("Nu back-uppen")).toBeUndefined();
  expect(button("Servergegevens verwijderen")).toBeUndefined();
});

test("an account with no backup yet says so and can make one", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "PUT"
      ? new Response(JSON.stringify({ updatedAt: "2026-08-31T12:00:00.000Z" }))
      : new Response(JSON.stringify({ blob: null, updatedAt: null })),
  );
  vi.stubGlobal("fetch", fetchMock);

  await render();
  expect(container!.textContent).toContain("Nog geen back-up op de server");

  await act(async () => {
    button("Nu back-uppen")!.click();
  });

  expect(container!.textContent).toContain("Back-up opgeslagen");
  const body = JSON.parse(
    String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body),
  );
  expect(body).toEqual({ blob, baseUpdatedAt: null });
});

test("the server's copy is never overwritten without the user seeing the other date first", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method !== "PUT")
      return new Response(JSON.stringify({ blob, updatedAt: "2026-08-31T00:00:00.000Z" }));
    if (String(url).includes("overwrite=true"))
      return new Response(JSON.stringify({ updatedAt: "2026-08-31T13:00:00.000Z" }));
    return new Response(
      JSON.stringify({ problems: ["nieuwer"], updatedAt: "2026-08-31T09:00:00.000Z" }),
      { status: 409 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);

  await render();
  await act(async () => {
    button("Nu back-uppen")!.click();
  });

  expect(container!.querySelector('[role="alert"]')?.textContent).toContain("nieuwere back-up");
  expect(container!.textContent).not.toContain("Back-up opgeslagen");

  await act(async () => {
    button("Toch overschrijven")!.click();
  });

  expect(container!.textContent).toContain("Back-up opgeslagen");
  expect(String((fetchMock.mock.calls.at(-1) as unknown as [string])[0])).toContain(
    "overwrite=true",
  );
});

test("a locked vault is told to unlock rather than uploading nothing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ blob: null, updatedAt: null }))),
  );

  await render({ export: () => null });
  await act(async () => {
    button("Nu back-uppen")!.click();
  });

  expect(container!.querySelector('[role="alert"]')?.textContent).toContain("Ontgrendel de kluis");
});

const withEraseRouting = (erase: (init?: RequestInit) => Response) =>
  vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return erase(init);
    return new Response(JSON.stringify({ blob: null, updatedAt: null }));
  });

test("a signed-in user sees the erase control", async () => {
  vi.stubGlobal(
    "fetch",
    withEraseRouting(() => new Response(JSON.stringify({ erased: [] }))),
  );

  await render();

  expect(button("Servergegevens verwijderen")).toBeDefined();
});

test("clicking the erase control reveals an inline confirmation, not a browser dialog", async () => {
  vi.stubGlobal(
    "fetch",
    withEraseRouting(() => new Response(JSON.stringify({ erased: [] }))),
  );
  await render();

  await act(async () => {
    button("Servergegevens verwijderen")!.click();
  });

  expect(container!.textContent).toContain("blijft staan");
  expect(button("Ja, verwijder")).toBeDefined();
  expect(button("Annuleer")).toBeDefined();
});

test("erasure is not requested until the confirmation is accepted", async () => {
  const fetchMock = withEraseRouting(() => new Response(JSON.stringify({ erased: [] })));
  vi.stubGlobal("fetch", fetchMock);
  await render();

  await act(async () => {
    button("Servergegevens verwijderen")!.click();
  });
  expect(
    fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "DELETE"),
  ).toBe(false);

  await act(async () => {
    button("Annuleer")!.click();
  });
  expect(button("Ja, verwijder")).toBeUndefined();
  expect(
    fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "DELETE"),
  ).toBe(false);
});

test("confirming erasure sends the DELETE and renders what was reported deleted", async () => {
  const fetchMock = withEraseRouting(
    () =>
      new Response(
        JSON.stringify({
          erased: [
            { table: "personal.eb_sessions", rows: 0 },
            { table: "personal.eb_pending_auth", rows: 0 },
            { table: "investing.agent_runs", rows: 0 },
            { table: "investing.sync_state", rows: 3 },
            { table: "investing.preferences", rows: 0 },
            { table: "investing.price_bars", rows: 0 },
            { table: "investing.broker_vaults", rows: 0 },
            { table: "personal.vaults", rows: 1 },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await render();

  await act(async () => {
    button("Servergegevens verwijderen")!.click();
  });
  await act(async () => {
    button("Ja, verwijder")!.click();
  });

  expect(container!.textContent).toContain("Verwijderd: 4 rijen over 2 tabellen.");
  expect(container!.textContent).not.toContain("Ja, verwijder");
  const deleteCall = fetchMock.mock.calls.find(
    (call) => (call[1] as RequestInit | undefined)?.method === "DELETE",
  ) as unknown as [string, RequestInit];
  expect(deleteCall[0]).toBe("/api/account/data");
  expect(JSON.parse(String(deleteCall[1].body))).toEqual({ confirm: "ERASE" });
});

test("a session that lapsed mid-erasure is reported with the shared signed-out message", async () => {
  vi.stubGlobal(
    "fetch",
    withEraseRouting(() => new Response(null, { status: 401 })),
  );
  await render();

  await act(async () => {
    button("Servergegevens verwijderen")!.click();
  });
  await act(async () => {
    button("Ja, verwijder")!.click();
  });

  expect(container!.querySelector('[role="alert"]')?.textContent).toContain(SIGNED_OUT_MESSAGE);
});
