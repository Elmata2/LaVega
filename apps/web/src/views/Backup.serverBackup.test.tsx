// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CipherBlob, VaultStorage } from "@lavega/adapters";
import Backup from "./Backup";
import type { VaultOwner } from "../vaultKey.js";
import { VaultDestroyError } from "@lavega/adapters";
import { SIGNED_OUT_MESSAGE } from "../api.js";
import { adminCopy } from "../copy/admin.js";

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

beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
  vi.unstubAllGlobals();
});

async function render(storage: Partial<VaultStorage> = {}, owner: VaultOwner = { kind: "device" }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const full = { export: () => blob, ...storage } as VaultStorage;
  await act(async () => {
    root!.render(<Backup storage={full} asOf="2026-08-31" owner={owner} onRestored={() => {}} />);
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

  expect(container!.textContent).toContain("Dit kun je niet terugdraaien");
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

test("an English browser gets English copy, including the erase warning and report", async () => {
  document.cookie = "lavega_locale=en; Path=/";
  const c = adminCopy.en.backup;
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
            { table: "investing.broker_vaults", rows: 0 },
            { table: "personal.vaults", rows: 1 },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await render();

  await act(async () => {
    button("Delete server data")!.click();
  });
  expect(container!.textContent).toContain(c.server.erase.warning);

  await act(async () => {
    button("Yes, delete")!.click();
  });

  expect(container!.textContent).toContain(c.server.erase.success(4, 2));
});

/* ---- reset personal data -------------------------------------------------- */

const ACCOUNT: VaultOwner = { kind: "account", id: "user-a" };
const RESET_URL = "/api/account/personal-data";

/** Backup GET answers normally; the reset DELETE answers with `reset`. */
const routed = (reset: () => Response | Promise<Response>) =>
  vi.fn(async (url: string) =>
    url === RESET_URL ? reset() : new Response(JSON.stringify({ blob: null, updatedAt: null })),
  );
const resetCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((call) => (call[0] as string) === RESET_URL) as unknown as [
    string,
    RequestInit,
  ][];
const alertText = () =>
  (
    container!.querySelector('[data-testid="reset-personal-error"]') ??
    container!.querySelector('[role="alert"]')
  )?.textContent ?? "";

async function openConfirm() {
  await act(async () => {
    button("Persoonlijke gegevens wissen")!.click();
  });
}
const confirm = (label = "Ja, wis mijn persoonlijke gegevens") =>
  act(async () => {
    button(label)!.click();
  });

test("the reset control sits above the full erase and asks inline: closes tabs first, names every effect", async () => {
  vi.stubGlobal(
    "fetch",
    routed(() => new Response(JSON.stringify({ erased: [] }))),
  );
  await render({ destroyVault: vi.fn(async () => {}) }, ACCOUNT);

  const buttons = [...container!.querySelectorAll("button")].map((b) => b.textContent);
  expect(buttons.indexOf("Persoonlijke gegevens wissen")).toBeGreaterThan(-1);
  expect(buttons.indexOf("Persoonlijke gegevens wissen")).toBeLessThan(
    buttons.indexOf("Servergegevens verwijderen"),
  );

  await openConfirm();

  const text = container!.querySelector('[data-testid="reset-personal-confirm"]')!.textContent!;
  expect(text).toContain("Sluit eerst andere LaVega-tabbladen");
  expect(text).toContain("de kopie van je kluis op de server");
  expect(text).toContain("doorstuuradres voor facturen");
  expect(text).toContain("dagelijkse totaal");
  expect(text).toContain("Blijft: je login en je beleggingsgegevens in LaVega Investing");
  expect(text).toContain("doelen, thesissen");
  expect(text).toContain("Dit kun je niet terugdraaien");
  expect(text).toContain("eigen kopie");
  expect(text).toContain("90 dagen");
  expect(button("Ja, wis mijn persoonlijke gegevens")).toBeDefined();
  expect(button("Annuleer")).toBeDefined();
});

test("nothing is requested until confirmed; cancel closes the panel and clears an earlier error", async () => {
  const fetchMock = routed(() => new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);
  const destroyVault = vi.fn(async () => {});
  await render({ destroyVault }, ACCOUNT);

  await openConfirm();
  expect(resetCalls(fetchMock)).toHaveLength(0);
  await confirm();
  expect(alertText()).toContain("Log opnieuw in");

  await act(async () => {
    button("Annuleer")!.click();
  });

  expect(button("Ja, wis mijn persoonlijke gegevens")).toBeUndefined();
  expect(alertText()).not.toContain("Log opnieuw in");
  expect(destroyVault).not.toHaveBeenCalled();
});

test("signed in, confirmed: sends the exact confirm and expectedOwner, then drops this browser's vault", async () => {
  const fetchMock = routed(() => new Response(JSON.stringify({ erased: [] })));
  vi.stubGlobal("fetch", fetchMock);
  const destroyVault = vi.fn(async () => {});
  await render({ destroyVault }, ACCOUNT);

  await openConfirm();
  await confirm();

  const [call] = resetCalls(fetchMock);
  expect(call![1].method).toBe("DELETE");
  expect(JSON.parse(String(call![1].body))).toEqual({
    confirm: "RESET-PERSONAL",
    expectedOwner: "user-a",
  });
  expect(destroyVault).toHaveBeenCalledTimes(1);
});

test("network failure: a plain message in the UI language, nothing local touched, focus on the message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === RESET_URL) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ blob: null, updatedAt: null }));
    }),
  );
  const destroyVault = vi.fn(async () => {});
  await render({ destroyVault }, ACCOUNT);

  await openConfirm();
  await confirm();

  expect(alertText()).toContain("Geen verbinding met de server");
  expect(alertText()).toContain("niets gewijzigd");
  expect(container!.textContent).not.toContain("Failed to fetch");
  expect(destroyVault).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    container!.querySelector('[data-testid="reset-personal-error"]'),
  );
});

test("401 at click: log in again; nothing local touched", async () => {
  vi.stubGlobal(
    "fetch",
    routed(() => new Response(null, { status: 401 })),
  );
  const destroyVault = vi.fn(async () => {});
  await render({ destroyVault }, ACCOUNT);
  await openConfirm();
  await confirm();
  expect(alertText()).toContain("Log opnieuw in en probeer het nog eens");
  expect(destroyVault).not.toHaveBeenCalled();
});

test("404 is an error for an account, not a local-only reset", async () => {
  vi.stubGlobal(
    "fetch",
    routed(() => new Response(null, { status: 404 })),
  );
  const destroyVault = vi.fn(async () => {});
  await render({ destroyVault }, ACCOUNT);
  await openConfirm();
  await confirm();
  expect(alertText()).not.toBe("");
  expect(destroyVault).not.toHaveBeenCalled();
});

test("409: told to reload because the account changed in another tab; nothing local touched", async () => {
  vi.stubGlobal(
    "fetch",
    routed(() => new Response(JSON.stringify({ code: "owner-changed" }), { status: 409 })),
  );
  const destroyVault = vi.fn(async () => {});
  await render({ destroyVault }, ACCOUNT);
  await openConfirm();
  await confirm();
  expect(alertText()).toContain("ander tabblad van account gewisseld");
  expect(alertText()).toContain("Herlaad de pagina");
  expect(destroyVault).not.toHaveBeenCalled();
});

test("a server 500 shows the server's message and leaves this browser alone", async () => {
  vi.stubGlobal(
    "fetch",
    routed(() => new Response(JSON.stringify({ error: "Wissen mislukt." }), { status: 500 })),
  );
  const destroyVault = vi.fn(async () => {});
  await render({ destroyVault }, ACCOUNT);
  await openConfirm();
  await confirm();
  expect(container!.textContent).toContain("Wissen mislukt.");
  expect(destroyVault).not.toHaveBeenCalled();
});

test("double click: one request, one vault delete", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fetchMock = routed(async () => {
    await gate;
    return new Response(JSON.stringify({ erased: [] }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const destroyVault = vi.fn(async () => {});
  await render({ destroyVault }, ACCOUNT);
  await openConfirm();

  const confirmButton = button("Ja, wis mijn persoonlijke gegevens")!;
  await act(async () => {
    confirmButton.click();
    confirmButton.click();
  });
  await act(async () => {
    release();
  });

  expect(resetCalls(fetchMock)).toHaveLength(1);
  expect(destroyVault).toHaveBeenCalledTimes(1);
});

test("account state still unknown at click time: the confirm button stays disabled and nothing is sent", async () => {
  const pending = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", pending);
  await render({ destroyVault: vi.fn(async () => {}) }, ACCOUNT);

  await openConfirm();

  const confirmButton = button("Ja, wis mijn persoonlijke gegevens") as HTMLButtonElement;
  expect(confirmButton.disabled).toBe(true);
  expect(container!.textContent).toContain("Je account wordt gecontroleerd");
  await act(async () => {
    confirmButton.click();
  });
  expect(pending.mock.calls.every((call) => (call as unknown as [string])[0] !== RESET_URL)).toBe(
    true,
  );
});

test("local-only install (device owner): offered, local-only copy, never calls the server route", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);
  const destroyVault = vi.fn(async () => {});
  await render({ destroyVault });

  await openConfirm();
  const text = container!.querySelector('[data-testid="reset-personal-confirm"]')!.textContent!;
  expect(text).toContain("zonder account");
  expect(text).not.toContain("je login");
  expect(text).toContain("Blijft: je instellingen in deze browser");
  expect(text).not.toContain("geen kopie");
  expect(text).not.toContain("90 dagen");
  await confirm();

  expect(resetCalls(fetchMock)).toHaveLength(0);
  expect(destroyVault).toHaveBeenCalledTimes(1);
});

test("a blocked local delete, in Dutch: server side cleared, close the other tabs", async () => {
  vi.stubGlobal(
    "fetch",
    routed(() => new Response(JSON.stringify({ erased: [] }))),
  );
  const destroyVault = vi.fn(async () => {
    throw new VaultDestroyError("blocked", "x");
  });
  await render({ destroyVault }, ACCOUNT);
  await openConfirm();
  await confirm();
  const text = alertText();
  expect(text).toContain("De serverkant is gewist.");
  expect(text).toContain("ander LaVega-tabblad open staat");
  expect(text).toContain("bij een nieuwe poging");
});

test("a blocked local delete, in English: no Dutch inside the sentence", async () => {
  document.cookie = "lavega_locale=en; Path=/";
  vi.stubGlobal(
    "fetch",
    routed(() => new Response(JSON.stringify({ erased: [] }))),
  );
  const destroyVault = vi.fn(async () => {
    throw new VaultDestroyError("blocked", "x");
  });
  await render({ destroyVault }, ACCOUNT);
  await act(async () => {
    button("Clear personal data")!.click();
  });
  await confirm("Yes, clear my personal data");
  const text = alertText();
  expect(text).toContain("The server side is cleared.");
  expect(text).toContain("another LaVega tab is open");
  expect(text).not.toMatch(/kluis|tabblad|serverkant/);
});

test("an English browser gets the English reset copy", async () => {
  document.cookie = "lavega_locale=en; Path=/";
  vi.stubGlobal(
    "fetch",
    routed(() => new Response(JSON.stringify({ erased: [] }))),
  );
  await render({ destroyVault: vi.fn(async () => {}) }, ACCOUNT);

  await act(async () => {
    button("Clear personal data")!.click();
  });

  const text = container!.querySelector('[data-testid="reset-personal-confirm"]')!.textContent!;
  expect(text).toContain("Close other LaVega tabs first.");
  expect(text).toContain(adminCopy.en.backup.resetPersonal.stays);
  expect(text).toContain("invoice forwarding address");
  expect(button("Yes, clear my personal data")).toBeDefined();
});

test("a server copy that was cleared elsewhere: the conflict says so and offers to put this device's copy back", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT" && String(url).includes("overwrite=true"))
      return new Response(JSON.stringify({ updatedAt: "2026-08-31T13:00:00.000Z" }));
    if (init?.method === "PUT")
      return new Response(JSON.stringify({ problems: ["x"], updatedAt: null }), { status: 409 });
    return new Response(JSON.stringify({ blob, updatedAt: "2026-08-30T00:00:00.000Z" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  await render({}, ACCOUNT);

  await act(async () => {
    button("Nu back-uppen")!.click();
  });

  expect(alertText()).toContain("staat niet meer op de server");
  expect(button("Toch overschrijven")).toBeDefined();
  await act(async () => {
    button("Toch overschrijven")!.click();
  });
  expect(container!.textContent).toContain("Back-up opgeslagen");
});
