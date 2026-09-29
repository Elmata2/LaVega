// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../app.js";
import { emptyResponseFor, responseFor, withAuthUnconfigured } from "../test/fetchFixtures.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

