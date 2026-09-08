// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import BankLink from "./BankLink";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

type FetchCall = { url: string; init?: RequestInit };

function mockFetch(aspsps: { name: string; country: string }[]) {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/api/eb/auth")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ url: "https://bank.example/auth" }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ aspsps }) } as unknown as Response;
  }) as unknown as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<BankLink busy={false} />);
  });
  await flush();
  return container;
}

function byText(selector: string, text: string): HTMLElement {
  const hit = [...container!.querySelectorAll(selector)].find((n) =>
    (n.textContent ?? "").includes(text),
  );
  if (!hit) throw new Error(`no ${selector} containing "${text}"`);
  return hit as HTMLElement;
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

test("initial load fetches the bank list with psu_type=business, the default", async () => {
  const mock = mockFetch([{ name: "ING", country: "NL" }]);
  try {
    await render();
    click(byText("button", "Koppel bank (Enable Banking)"));
    await flush();
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].url).toContain("psu_type=business");
  } finally {
    mock.restore();
  }
});

test("clicking Particulier refetches the bank list with psu_type=personal", async () => {
  const mock = mockFetch([{ name: "ING", country: "NL" }]);
  try {
    await render();
    click(byText("button", "Koppel bank (Enable Banking)"));
    await flush();
    click(byText("button", "Particulier"));
    await flush();
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[1].url).toContain("psu_type=personal");
  } finally {
    mock.restore();
  }
});

test("a failed refetch after switching type clears the stale list instead of leaving it connectable", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ aspsps: [{ name: "ING", country: "NL" }] }),
      } as unknown as Response;
    }
    return { ok: false, status: 500, json: async () => ({ error: "boom" }) } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    await render();
    click(byText("button", "Koppel bank (Enable Banking)"));
    await flush();
    expect(() => byText("button", "Autoriseer")).not.toThrow();
    click(byText("button", "Particulier"));
    await flush();
    expect(() => byText("button", "Autoriseer")).toThrow();
    expect(() => byText("button", "Koppel bank (Enable Banking)")).not.toThrow();
  } finally {
    globalThis.fetch = original;
  }
});

test("connecting a bank after switching to Particulier sends psuType personal", async () => {
  const mock = mockFetch([{ name: "ING", country: "NL" }]);
  try {
    await render();
    click(byText("button", "Koppel bank (Enable Banking)"));
    await flush();
    click(byText("button", "Particulier"));
    await flush();
    click(byText("button", "Autoriseer"));
    await flush();
    const auth = mock.calls.find((c) => c.url.includes("/api/eb/auth"));
    expect(auth).toBeDefined();
    const body = JSON.parse(auth!.init!.body as string);
    expect(body).toEqual({ name: "ING", country: "NL", psuType: "personal" });
  } finally {
    mock.restore();
  }
});
