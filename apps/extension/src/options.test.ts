// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AMEX_BRON, AMEX_MATCH } from "./amex.js";
import { SITES } from "./sites.js";

const IKEA = SITES[0]!;

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe("options schakelaars", () => {
  let prevChrome: unknown;
  let opslag: Map<string, unknown>;
  let toegestaan: Set<string>;
  let luister: {
    opslagWijziging: ((c: Record<string, { newValue?: unknown }>, a: string) => void)[];
    verwijderd: ((p: { origins?: string[] }) => void)[];
    toegevoegd: ((p: { origins?: string[] }) => void)[];
  };
  let pendingRequest: { resolve: (ok: boolean) => void } | null;
  let requestCalls: number;

  beforeEach(async () => {
    vi.resetModules();
    prevChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
    opslag = new Map();
    toegestaan = new Set();
    luister = { opslagWijziging: [], verwijderd: [], toegevoegd: [] };
    pendingRequest = null;
    requestCalls = 0;

    document.body.innerHTML = `
      <div id="kaartenlijst"></div>
      <input id="zoek" />
      <p id="kaarten-telling"></p>
      <div id="puntenlijst"></div>
      <p id="punten-melding"></p>
      <form id="punten-toevoegen">
        <input id="punten-naam" />
        <input id="punten-aantal" />
      </form>
      <div id="siteslijst"></div>
      <p id="sites-melding"></p>
      <div id="bronnen"></div>
    `;

    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: async (keys: string[] | string | null) => {
            const lijst =
              keys === null ? [...opslag.keys()] : Array.isArray(keys) ? keys : [keys];
            const uit: Record<string, unknown> = {};
            for (const k of lijst) if (opslag.has(k)) uit[k] = opslag.get(k);
            return uit;
          },
          set: async (items: Record<string, unknown>) => {
            const changes: Record<string, { newValue?: unknown }> = {};
            for (const [k, v] of Object.entries(items)) {
              opslag.set(k, v);
              changes[k] = { newValue: v };
            }
            for (const cb of luister.opslagWijziging) cb(changes, "local");
          },
          remove: async (keys: string[] | string) => {
            const changes: Record<string, { newValue?: unknown }> = {};
            for (const k of Array.isArray(keys) ? keys : [keys]) {
              opslag.delete(k);
              changes[k] = { newValue: undefined };
            }
            for (const cb of luister.opslagWijziging) cb(changes, "local");
          },
        },
        onChanged: { addListener: (cb: never) => luister.opslagWijziging.push(cb) },
      },
      permissions: {
        contains: async (p: { origins?: string[] }) =>
          (p.origins ?? []).every((o) => toegestaan.has(o)),
        request: (p: { origins?: string[] }) => {
          requestCalls += 1;
          return new Promise<boolean>((resolve) => {
            pendingRequest = {
              resolve: (ok: boolean) => {
                if (ok) for (const o of p.origins ?? []) toegestaan.add(o);
                pendingRequest = null;
                resolve(ok);
              },
            };
          });
        },
        remove: async (p: { origins?: string[] }) => {
          for (const o of p.origins ?? []) toegestaan.delete(o);
          return true;
        },
        onRemoved: { addListener: (cb: never) => luister.verwijderd.push(cb) },
        onAdded: { addListener: (cb: never) => luister.toegevoegd.push(cb) },
      },
    };

    await import("./options.js");
    await flush();
  });

  afterEach(() => {
    (globalThis as unknown as { chrome?: unknown }).chrome = prevChrome;
  });

  it("vergrendelt de site-schakelaar tijdens een lopende permissions.request", async () => {
    const vink = document.getElementById(`site-${IKEA.id}`) as HTMLInputElement;
    expect(vink.disabled).toBe(false);
    expect(vink.checked).toBe(false);

    vink.checked = true;
    vink.dispatchEvent(new Event("change"));
    expect(vink.disabled).toBe(true);
    expect(requestCalls).toBe(1);

    vink.checked = false;
    vink.dispatchEvent(new Event("change"));
    expect(requestCalls).toBe(1);
    expect(vink.disabled).toBe(true);

    pendingRequest!.resolve(true);
    await flush();

    expect(vink.disabled).toBe(false);
    expect(vink.checked).toBe(true);
    expect(opslag.get("enabledSiteIds")).toEqual([IKEA.id]);
  });

  it("synchroniseert open optiescherm live bij permissions.onRemoved en storage.onChanged", async () => {
    const siteVink = document.getElementById(`site-${IKEA.id}`) as HTMLInputElement;
    const amexVink = document.getElementById(`bron-aan-${AMEX_BRON.id}`) as HTMLInputElement;

    toegestaan.add(IKEA.match);
    toegestaan.add(AMEX_MATCH);
    opslag.set("enabledSiteIds", [IKEA.id]);
    opslag.set(AMEX_BRON.sleutels.aan, true);
    for (const cb of luister.toegevoegd) cb({ origins: [IKEA.match, AMEX_MATCH] });
    await flush();

    expect(siteVink.checked).toBe(true);
    expect(amexVink.checked).toBe(true);

    toegestaan.delete(IKEA.match);
    for (const cb of luister.verwijderd) cb({ origins: [IKEA.match] });
    await flush();
    expect(siteVink.checked).toBe(false);
    expect(amexVink.checked).toBe(true);

    opslag.set(AMEX_BRON.sleutels.aan, false);
    for (const cb of luister.opslagWijziging)
      cb({ [AMEX_BRON.sleutels.aan]: { newValue: false } }, "local");
    await flush();
    expect(amexVink.checked).toBe(false);
  });
});
