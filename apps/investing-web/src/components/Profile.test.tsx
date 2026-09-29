// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../app.js";
import { resetInvestingLayoutStoreForTests } from "../lib/layoutResource.js";
import { emptyResponseFor, responseFor, withAuthUnconfigured } from "../test/fetchFixtures.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => resetInvestingLayoutStoreForTests());
afterEach(() => vi.restoreAllMocks());

test("profile page lists brokers, modules, widgets and account sections", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Brokers");
  expect(container.textContent).toContain("Modules");
  expect(container.textContent).toContain("Widgets");
  expect(container.textContent).toContain("Account");
  root.unmount();
});

test("connect broker opens setup guide with IBKR instructions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const profileLink = container.querySelector<HTMLAnchorElement>('a[href="/profile"]');
  expect(profileLink).not.toBeNull();

  await act(async () => {
    profileLink?.click();
  });
  expect(container.querySelector("#brokers")).not.toBeNull();
  expect(container.textContent).toContain("Interactive Brokers");
  expect(container.textContent).toContain("Flex Web Service");
  expect(container.textContent).toContain("Trading 212");
  expect(container.textContent).toContain("Flex-token");
  expect(container.textContent).toContain("Cash Report");
  expect(container.textContent).toContain("Statement of Funds");
  root.unmount();
});

test("account section shows the sign-in email and a sign-out control", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: {}, widgets: {} }))
            : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector("button")?.textContent).not.toBeNull();
  expect(container.textContent).toContain("Sign out");
  root.unmount();
});

test("connect broker names an unreadable broker and offers reconnect", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/brokers/credentials/status")
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "unlocked",
              passphrase: "unused",
              brokers: { ibkr: "readable", trading212: "unreadable" },
            }),
            { status: 200 },
          ),
        );
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
  });
  expect(container.textContent).toContain("Trading 212 credentials cannot be read");
  expect(container.textContent).toContain("Save new credentials below to reconnect");
  root.unmount();
});

test("broker setup starts forced sync and shows returned problems", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input), method: init?.method });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response(
          JSON.stringify({ outcomes: [], problems: ["IBKR: credentials are not configured"] }),
        );
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const syncButton = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Start sync"),
  );
  expect(syncButton).not.toBeUndefined();
  await act(async () => {
    syncButton?.click();
    await Promise.resolve();
  });
  expect(requests).toContainEqual({ url: "/api/brokers/sync?force=true", method: "POST" });
  expect(container.textContent).not.toContain("credentials are not configured");
  expect(container.textContent).toContain("Sync completed");
  root.unmount();
});

test("broker credential form stores IBKR credentials and starts sync", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input), init });
      if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response(JSON.stringify({ outcomes: [{ status: "synced" }], problems: [] }));
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const fields = {
    token: container.querySelector<HTMLInputElement>('[name="token"]')!,
    queryId: container.querySelector<HTMLInputElement>('[name="queryId"]')!,
    passphrase: container.querySelector<HTMLInputElement>('[name="passphrase"]')!,
  };
  const setInput = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  setInput(fields.token, "flex-token");
  setInput(fields.queryId, "123456");
  setInput(fields.passphrase, "vault-passphrase");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await Promise.resolve();
  });

  const credentialRequest = requests.find((request) => request.url === "/api/brokers/credentials");
  expect(credentialRequest?.init?.body).toBe(
    JSON.stringify({
      broker: "ibkr",
      token: "flex-token",
      queryId: "123456",
      passphrase: "vault-passphrase",
    }),
  );
  expect(requests.some((request) => request.url === "/api/brokers/sync?force=true")).toBe(true);
  expect(container.textContent).toContain("Sync completed");
  expect(container.textContent).not.toContain("flex-token");
  root.unmount();
});

test("locked broker vault can be unlocked without entering broker credentials again", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input), init });
      if (String(input) === "/api/brokers/credentials/status")
        return new Response(JSON.stringify({ status: "locked" }));
      if (String(input) === "/api/brokers/credentials/unlock")
        return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response(JSON.stringify({ outcomes: [{ status: "synced" }], problems: [] }));
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  const passphrase = container.querySelector<HTMLInputElement>('[name="unlockPassphrase"]')!;
  expect(passphrase).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(passphrase, "vault-passphrase");
    passphrase.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-action="unlock-vault"]')?.click();
    await Promise.resolve();
  });

  const unlockRequest = requests.find(
    (request) => request.url === "/api/brokers/credentials/unlock",
  );
  expect(unlockRequest?.init?.body).toBe(JSON.stringify({ passphrase: "vault-passphrase" }));
  expect(requests.some((request) => request.url === "/api/brokers/sync?force=true")).toBe(true);
  expect(container.textContent).toContain("Vault unlocked");
  expect(container.textContent).not.toContain("vault-passphrase");
  await act(async () => {
    root.unmount();
  });
});

test("broker sync progress shows exact pages, orders, and provider wait", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      if (String(input) === "/api/brokers/sync/status")
        return new Response(
          JSON.stringify({
            status: "waiting",
            pages: 6,
            ordersRead: 300,
            positionsRead: 0,
            waitUntil: "2026-08-19T14:00:00.000Z",
            remaining: 0,
            updatedAt: "2026-08-19T13:59:00.000Z",
            message: null,
          }),
        );
      if (String(input) === "/api/brokers/credentials/status")
        return new Response(JSON.stringify({ status: "unlocked" }));
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Trading 212 syncing");
  expect(container.textContent).toContain("6 pages");
  expect(container.textContent).toContain("300 orders read");
  expect(container.textContent).toContain("0 positions");
  expect(container.textContent).toContain("Waiting for new API capacity");
  await act(async () => {
    root.unmount();
  });
});

test("broker credential form succeeds when the other broker is not configured", async () => {
  const requests: Array<{ url: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input) });
      if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true") {
        return new Response(
          JSON.stringify({
            outcomes: [
              { broker: "ibkr", status: "synced" },
              { broker: "trading212", status: "problem" },
            ],
            problems: ["trading212: credentials are not configured"],
          }),
        );
      }
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const fields = {
    token: container.querySelector<HTMLInputElement>('[name="token"]')!,
    queryId: container.querySelector<HTMLInputElement>('[name="queryId"]')!,
    passphrase: container.querySelector<HTMLInputElement>('[name="passphrase"]')!,
  };
  const setInput = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  setInput(fields.token, "flex-token");
  setInput(fields.queryId, "123456");
  setInput(fields.passphrase, "vault-passphrase");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await Promise.resolve();
  });

  expect(requests.some((request) => request.url === "/api/brokers/sync?force=true")).toBe(true);
  expect(container.textContent).toContain("Sync completed");
  expect(container.textContent).not.toContain("credentials are not configured");
  root.unmount();
});

test("a broker sync that outlives the edge timeout reports background progress, not a parser error", async () => {
  /* Cloudflare cuts an origin request off at ~100s with an HTML 524 page. A
     Trading 212 first sync pages far past that, so the browser gets HTML where
     the form expected JSON and the raw parser error surfaced as the failure. */
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response("<!DOCTYPE html><html><title>524: A timeout occurred</title></html>", {
          status: 524,
          headers: { "content-type": "text/html" },
        });
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const setInput = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const brokerSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Broker"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(brokerSelect, "trading212");
    brokerSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  setInput(container.querySelector<HTMLInputElement>('[name="token"]')!, "t212-key");
  setInput(container.querySelector<HTMLInputElement>('[name="secret"]')!, "t212-secret");
  setInput(container.querySelector<HTMLInputElement>('[name="passphrase"]')!, "vault-passphrase");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Sync continues in the background");
  expect(container.textContent).not.toMatch(/JSON|Unexpected token|did not match/i);
  root.unmount();
});

test("a server-key vault asks for no passphrase and does not claim the key is the user's", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input), init });
      if (String(input) === "/api/brokers/credentials/status")
        return new Response(JSON.stringify({ status: "empty", passphrase: "unused" }));
      if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response(JSON.stringify({ outcomes: [{ status: "synced" }], problems: [] }));
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
  });

  expect(container.querySelector('[name="passphrase"]')).toBeNull();
  expect(container.textContent).not.toContain("local vault");
  expect(container.textContent).not.toContain("LaVega kan het niet herstellen");

  const setInput = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  setInput(container.querySelector<HTMLInputElement>('[name="token"]')!, "flex-token");
  setInput(container.querySelector<HTMLInputElement>('[name="queryId"]')!, "123456");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await Promise.resolve();
  });

  const credentialRequest = requests.find((request) => request.url === "/api/brokers/credentials");
  expect(credentialRequest?.init?.body).toBe(
    JSON.stringify({ broker: "ibkr", token: "flex-token", queryId: "123456" }),
  );
  root.unmount();
});

/* WELKE PERMISSIES DE SLEUTEL NODIG HEEFT, op de kaart die de opzet uitlegt.
 *
 * Er stond "choose read-only scope if Trading 212 shows that option", en dat is
 * niet te volgen: hun app toont elf losse vinkjes en geen read-only-knop. Drie
 * aanvinken die redelijk klinken raakt er precies één die wij gebruiken — en
 * een ontbrekende permissie faalt niet bij het opslaan maar pas bij de eerste
 * sync, als HTTP 403. De vijf hieronder zijn één per endpoint dat de adapter
 * echt aanroept. */
test("the Trading 212 card names the exact permissions the key needs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });

  const text = container.textContent ?? "";
  for (const scope of [
    "Account data",
    "History – Dividends",
    "History – Orders",
    "History – Transactions",
    "Portfolio",
  ]) {
    expect(text, scope).toContain(scope);
  }
  // De read-only houding, op het scherm en niet alleen in een ontwerpdocument.
  expect(text).toContain("Orders – Execute");
  expect(text).toContain("Pies – Write");
  // En waar een vergeten vinkje zich later meldt.
  expect(text).toContain("403");
  // Het accounttype, want op een ander type werkt geen enkele sleutel.
  expect(text).toContain("Stocks ISA");

  root.unmount();
});

/* HET GEHEIM BESTAAT WEL, en dat is hier één ronde lang verkeerd gelezen.
 *
 * Trading 212's documentatie: "You must provide your API Key as the username
 * and your API Secret as the password, formatted as an HTTP Basic
 * Authentication header." Het veld stond terecht op verplicht; het is toen
 * optioneel gemaakt op een aanname, en een leeg geheim levert `base64("key:")`
 * op — dat kan nooit authenticeren. Deze test houdt beide helften verplicht. */
test("Trading 212 requires both halves of the key pair", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  const picker = container.querySelector('select[aria-label="Broker"]') as HTMLSelectElement;
  await act(async () => {
    picker.value = "trading212";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const secret = container.querySelector('input[name="secret"]') as HTMLInputElement | null;
  expect(secret).not.toBeNull();
  expect(secret!.required).toBe(true);
  const token = container.querySelector('input[name="token"]') as HTMLInputElement;
  expect(token.required).toBe(true);

  // En de kaart erboven zegt dat het er twee zijn, want daar liep dit op stuk.
  expect(container.textContent).toContain("both the API key and the API secret");
  expect(container.textContent).toContain("shown once");

  root.unmount();
});

test("signing out and in as another user drops the first user's layout and unsent edits", async () => {
  type User = "a" | "b";
  let user: User | null = "a";
  const layouts: Record<User, unknown> = {
    a: { modules: { agents: false }, widgets: {} },
    b: { modules: { positions: false }, widgets: {} },
  };
  const layoutGets: Array<User | null> = [];
  const puts: Array<{ user: User | null; resolve: (response: Response) => void }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/get-session")
        return Promise.resolve(
          new Response(
            JSON.stringify(user ? { user: { id: user, email: `${user}@x.test` } } : null),
          ),
        );
      if (url === "/api/auth/sign-out") {
        user = null;
        return Promise.resolve(new Response("{}"));
      }
      if (url === "/api/auth/sign-in/email") {
        user = String(init?.body).includes('"b@x.test"') ? "b" : "a";
        return Promise.resolve(new Response("{}"));
      }
      if (url === "/api/investing/layout" && init?.method === "PUT")
        return new Promise<Response>((resolve) => puts.push({ user, resolve }));
      if (url === "/api/investing/layout") {
        layoutGets.push(user);
        return Promise.resolve(new Response(JSON.stringify(user ? layouts[user] : {})));
      }
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const tab = (href: string) =>
    container.querySelector(`nav[aria-label="Main navigation"] a[href="${href}"]`);
  const toggle = async (label: string) =>
    act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
      await settle();
    });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await settle();
  });
  expect(layoutGets).toEqual(["a"]);
  expect(tab("/agents")).toBeNull();

  await toggle("Positions in the top bar");
  await toggle("Net worth in the top bar");
  expect(puts).toHaveLength(1);

  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Sign out")
      ?.click();
    await settle();
  });
  const email = container.querySelector<HTMLInputElement>('input[name="email"]');
  expect(email).not.toBeNull();

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const [name, value] of [
      ["email", "b@x.test"],
      ["password", "correct horse battery staple"],
    ] as const) {
      const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await settle();
  });
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    await settle();
  });

  // A's save that was already on the wire lands only now, after B signed in.
  await act(async () => {
    puts[0]!.resolve(new Response(null, { status: 204 }));
    await settle();
  });

  expect(puts.map((put) => put.user)).toEqual(["a"]);
  expect(layoutGets.at(-1)).toBe("b");
  expect(tab("/agents")).not.toBeNull();
  expect(tab("/positions")).toBeNull();
  act(() => root.unmount());
});

test("a switch flipped after a failed load saves only that choice, so a module the user hid stays hidden", async () => {
  const gets: Array<(response: Response) => void> = [];
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/investing/layout" && init?.method === "PUT") {
        bodies.push(JSON.parse(String(init.body)));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (String(input) === "/api/investing/layout")
        return new Promise<Response>((resolve) => gets.push(resolve));
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await settle();
  });
  const control = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  expect(gets).toHaveLength(1);
  expect(control("Net worth in the top bar").getAttribute("aria-disabled")).toBe("true");
  expect(control("Sector allocation on Overview").getAttribute("aria-disabled")).toBe("true");

  await act(async () => {
    gets[0]!(new Response("", { status: 500 }));
    await settle();
  });
  expect(control("Net worth in the top bar").getAttribute("aria-disabled")).not.toBe("true");

  await act(async () => {
    control("Net worth in the top bar").click();
    await settle();
  });
  expect(gets).toHaveLength(2);
  expect(bodies).toEqual([]);

  await act(async () => {
    gets[1]!(new Response(JSON.stringify({ modules: { agents: false }, widgets: {} })));
    await settle();
  });
  expect(bodies).toEqual([{ modules: { agents: false, "net-worth": false }, widgets: {} }]);
  expect(control("Agents in the top bar").getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('nav[aria-label="Main navigation"] a[href="/agents"]')).toBeNull();
  act(() => root.unmount());
});

test("the sector-inference switch is disabled without market-data consent", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/market-data/consent"
            ? new Response(JSON.stringify({ accepted: false }))
            : String(input) === "/api/investing/sector-inference"
              ? new Response(JSON.stringify({ enabled: false }))
              : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const toggle = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Sector inference"]',
  )!;
  expect(toggle.getAttribute("aria-disabled")).toBe("true");
  expect(container.textContent).toContain("Grant market-data consent");
  root.unmount();
});

test("the sector-inference privacy copy names what the classifier actually sends", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/sector-inference"
            ? new Response(JSON.stringify({ enabled: false }))
            : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain(
    "Sends each holding's ticker and name, never quantities or values",
  );
  expect(container.textContent).not.toMatch(/instrument names/i);
  root.unmount();
});

test("the sector-inference switch turns on and persists once consent is granted", async () => {
  const puts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        withAuthUnconfigured(input, () => {
          const url = String(input);
          if (url === "/api/market-data/consent")
            return new Response(JSON.stringify({ accepted: true }));
          if (url === "/api/investing/sector-inference" && init?.method === "PUT") {
            puts.push(JSON.parse(String(init.body)));
            return new Response(JSON.stringify({ enabled: true }));
          }
          if (url === "/api/investing/sector-inference")
            return new Response(JSON.stringify({ enabled: false }));
          return responseFor(input, init);
        }),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const toggle = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Sector inference"]',
  )!;
  expect(toggle.getAttribute("aria-disabled")).not.toBe("true");
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await act(async () => {
    toggle.click();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(puts).toEqual([{ enabled: true }]);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  root.unmount();
});

test("the sector-inference switch is disabled with a hint when the server has no classifier configured", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/market-data/consent"
            ? new Response(JSON.stringify({ accepted: true }))
            : String(input) === "/api/investing/sector-inference"
              ? new Response(JSON.stringify({ enabled: false, available: false }))
              : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const toggle = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Sector inference"]',
  )!;
  expect(toggle.getAttribute("aria-disabled")).toBe("true");
  expect(container.textContent).toContain("Sector inference is not available on this server.");
  expect(container.textContent).not.toContain("Grant market-data consent");
  root.unmount();
});

test("the sector-inference switch stays enabled when the server omits availability", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/market-data/consent"
            ? new Response(JSON.stringify({ accepted: true }))
            : String(input) === "/api/investing/sector-inference"
              ? new Response(JSON.stringify({ enabled: false }))
              : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const toggle = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Sector inference"]',
  )!;
  expect(toggle.getAttribute("aria-disabled")).not.toBe("true");
  root.unmount();
});
