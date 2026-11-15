import { describe, expect, test } from "vitest";
import {
  CORS_ENV_VARS,
  GMAIL_NODE_NAME,
  WORKFLOW_NAME,
  describeProvision,
  normalizeBaseUrl,
  productionWebhookUrl,
  provisionN8n,
  randomToken,
} from "./n8n-provision";

/* Provisioning his n8n from the browser, against a stubbed fetch.
 *
 * What these tests are actually protecting:
 *   - the four API calls happen, in order, with the API-key header;
 *   - the webhook node comes back BOUND (credential + headerAuth) and reachable
 *     from this page (allowedOrigins);
 *   - an EXISTING workflow is rebound, not replaced — the Gmail credential he
 *     attached by hand is the one thing this flow can never restore;
 *   - every failure names the thing that is wrong. CORS names both variables. */

const BASE = "https://n8n.example";
const ORIGIN = "https://lavega.dev";

type Recorded = {
  url: string;
  method: string;
  apiKey: string;
  body: Record<string, unknown> | undefined;
};

type StubOptions = {
  /** Workflows the stub's n8n already has, as the list endpoint returns them. */
  existing?: Array<Record<string, unknown>>;
  /** Status to fail every call with (401/404/500 …). */
  failStatus?: number;
  /** Status the activate call fails with; everything else succeeds. */
  failActivateStatus?: number;
  /** Throw a TypeError instead of answering — what a CORS block looks like. */
  throwOn?: "first" | "none";
};

function stubN8n(options: StubOptions = {}) {
  const calls: Recorded[] = [];
  const store = new Map<string, Record<string, unknown>>();
  for (const wf of options.existing ?? []) store.set(String(wf.id), wf);

  const fetchImpl = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, method, apiKey: headers["X-N8N-API-KEY"] ?? "", body });

    if (options.throwOn === "first") throw new TypeError("Failed to fetch");
    if (options.failStatus) {
      return { ok: false, status: options.failStatus, json: async () => ({ message: "nope" }) };
    }

    const path = url.slice(`${BASE}/api/v1`.length);
    const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b });

    if (path.startsWith("/workflows?")) return ok({ data: [...store.values()] });
    if (path === "/credentials" && method === "POST")
      return ok({ id: "cred-77", name: body?.name, type: body?.type });
    if (path === "/workflows" && method === "POST") {
      const wf = { id: "wf-1", ...body, active: false };
      store.set("wf-1", wf);
      return ok(wf);
    }
    const activate = path.match(/^\/workflows\/([^/]+)\/activate$/);
    if (activate && method === "POST") {
      if (options.failActivateStatus) {
        return {
          ok: false,
          status: options.failActivateStatus,
          json: async () => ({ message: "Gmail node has issues" }),
        };
      }
      const wf = { ...store.get(activate[1]), active: true };
      store.set(activate[1], wf);
      return ok(wf);
    }
    const one = path.match(/^\/workflows\/([^/]+)$/);
    if (one && method === "PUT") {
      const wf = { ...store.get(one[1]), ...body, id: one[1] };
      store.set(one[1], wf);
      return ok(wf);
    }
    if (one && method === "GET") return ok(store.get(one[1]) ?? {});
    return {
      ok: false,
      status: 404,
      json: async () => ({ message: `stub has no route for ${method} ${path}` }),
    };
  }) as unknown as typeof fetch;

  return { calls, fetchImpl, store };
}

function nodesOf(body: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  return (body?.nodes ?? []) as Array<Record<string, unknown>>;
}

/** The GET webhook — the one LaVega polls. The workflow also has a POST one for
 *  the Cloudflare Email Worker, and picking that by accident would leave
 *  Facturen polling an endpoint that answers nothing. */
function queueWebhookOf(nodes: Array<Record<string, unknown>>): Record<string, unknown> {
  const hit = nodes.find(
    (n) =>
      n.type === "n8n-nodes-base.webhook" &&
      String(
        ((n.parameters ?? {}) as Record<string, unknown>).httpMethod ?? "GET",
      ).toUpperCase() === "GET",
  );
  if (!hit) throw new Error("no GET webhook node");
  return hit;
}

function paramsOf(node: Record<string, unknown>): Record<string, unknown> {
  return (node.parameters ?? {}) as Record<string, unknown>;
}

function allowedOriginsOf(node: Record<string, unknown>): string {
  return String((paramsOf(node).options as Record<string, unknown>).allowedOrigins ?? "");
}

describe("provisionN8n — de gelukkige weg", () => {
  test("creates the workflow, the credential, activates it and stores the webhook URL", async () => {
    const { calls, fetchImpl } = stubN8n();
    const outcome = await provisionN8n({
      baseUrl: `${BASE}/`,
      apiKey: "key-abc",
      origin: ORIGIN,
      fetchImpl,
      makeToken: () => "tok-123",
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.created).toBe(true);
    expect(outcome.active).toBe(true);
    expect(outcome.token).toBe("tok-123");

    // The four calls, in order, each carrying the API key in the header n8n
    // reads. No call goes anywhere near the LaVega server.
    expect(calls.map((c) => `${c.method} ${c.url.replace(`${BASE}/api/v1`, "")}`)).toEqual([
      "GET /workflows?limit=250",
      "POST /credentials",
      "POST /workflows",
      "POST /workflows/wf-1/activate",
      "GET /workflows/wf-1",
    ]);
    expect(calls.every((c) => c.apiKey === "key-abc")).toBe(true);
    expect(calls.every((c) => c.url.startsWith(BASE))).toBe(true);

    // The credential is the Header Auth one the queue fetch authenticates with.
    const cred = calls[1].body!;
    expect(cred.type).toBe("httpHeaderAuth");
    expect(cred.data).toEqual({ name: "x-lavega-token", value: "tok-123" });

    // The workflow that was pushed is the bundled one, with the webhook bound.
    const created = calls[2].body!;
    expect(created.name).toBe(WORKFLOW_NAME);
    const nodes = nodesOf(created);
    expect(nodes.some((n) => n.name === GMAIL_NODE_NAME)).toBe(true);
    const hook = queueWebhookOf(nodes);
    expect(paramsOf(hook).authentication).toBe("headerAuth");
    expect(hook.credentials).toMatchObject({ httpHeaderAuth: { id: "cred-77" } });
    // And this page's origin is allowed, or the queue fetch we just enabled
    // would be blocked by the browser the moment he opens Facturen.
    expect(allowedOriginsOf(hook)).toContain(ORIGIN);

    // The URL is composed from the base he gave and the path READ BACK out of
    // n8n — asserted against the path that was actually pushed, so this stays
    // true when the shared workflow JSON is edited.
    expect(outcome.webhookUrl).toBe(`${BASE}/webhook/${String(paramsOf(hook).path)}`);
    expect(String(paramsOf(hook).path)).not.toBe("");
  });

  test("EVERY webhook node gets the credential — an unbound one blocks activation", async () => {
    const { calls, fetchImpl } = stubN8n();
    await provisionN8n({
      baseUrl: BASE,
      apiKey: "k",
      origin: ORIGIN,
      fetchImpl,
      makeToken: () => "t",
    });
    const webhooks = nodesOf(calls[2].body).filter((n) => n.type === "n8n-nodes-base.webhook");
    // The bundled workflow has two: the GET queue reader and the POST the
    // Cloudflare Email Worker delivers to. The POST one declares headerAuth, and
    // n8n will not activate a workflow whose node lacks a credential it needs.
    expect(webhooks.length).toBeGreaterThan(1);
    for (const w of webhooks) {
      expect(paramsOf(w).authentication).toBe("headerAuth");
      expect(w.credentials).toMatchObject({ httpHeaderAuth: { id: "cred-77" } });
    }
  });

  test("an unusual origin is ADDED to allowedOrigins, keeping the ones already there", async () => {
    const { calls, fetchImpl } = stubN8n();
    await provisionN8n({
      baseUrl: BASE,
      apiKey: "k",
      origin: "http://localhost:5174",
      fetchImpl,
      makeToken: () => "t",
    });
    const list = allowedOriginsOf(queueWebhookOf(nodesOf(calls[2].body)));
    expect(list).toContain("http://localhost:5174");
    expect(list).toContain("https://lavega.dev"); // uit de gebundelde JSON
  });

  test("an EXISTING workflow is rebound, not overwritten — his Gmail credential survives", async () => {
    const existing = {
      id: "wf-9",
      name: WORKFLOW_NAME,
      nodes: [
        {
          name: GMAIL_NODE_NAME,
          type: "n8n-nodes-base.gmail",
          parameters: {},
          credentials: { gmailOAuth2: { id: "his-gmail", name: "Gmail account" } },
        },
        {
          name: "LaVega vraagt de rij op",
          type: "n8n-nodes-base.webhook",
          parameters: { path: "lavega-facturen", options: {} },
        },
      ],
      connections: { a: 1 },
      settings: { executionOrder: "v1" },
    };
    const { calls, fetchImpl } = stubN8n({ existing: [existing] });
    const outcome = await provisionN8n({
      baseUrl: BASE,
      apiKey: "k",
      origin: ORIGIN,
      fetchImpl,
      makeToken: () => "t2",
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.created).toBe(false);
    expect(outcome.workflowId).toBe("wf-9");

    // No POST /workflows: a second workflow with the same name is exactly the
    // duplicate this find-or-create exists to prevent.
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/v1/workflows"))).toBe(
      false,
    );
    const put = calls.find((c) => c.method === "PUT")!;
    const nodes = nodesOf(put.body);
    // THE point of this test: the Gmail credential he attached by hand is still
    // attached. Pushing the bundled JSON over it would have wiped it, and this
    // flow cannot put it back — n8n's API cannot list credentials.
    expect(nodes.find((n) => n.name === GMAIL_NODE_NAME)!.credentials).toEqual({
      gmailOAuth2: { id: "his-gmail", name: "Gmail account" },
    });
    expect(queueWebhookOf(nodes).credentials).toMatchObject({ httpHeaderAuth: { id: "cred-77" } });
    expect(describeProvision(outcome)).toContain("stond er al");
  });
});

describe("provisionN8n — elke fout noemt zijn eigen oorzaak", () => {
  test("a CORS block names BOTH environment variables, and does not claim a network is down", async () => {
    const { fetchImpl, calls } = stubN8n({ throwOn: "first" });
    const outcome = await provisionN8n({
      baseUrl: BASE,
      apiKey: "k",
      origin: "http://localhost:5174",
      fetchImpl,
    });

    expect(outcome.kind).toBe("cors");
    const message = describeProvision(outcome);
    expect(message).toContain("N8N_DEFAULT_CORS=true");
    expect(message).toContain("N8N_CORS_ALLOW_ORIGIN=https://lavega.dev,http://localhost:5174");
    expect(message).toContain("CORS");
    // Namen, geen categorie: beide variabelen staan er letterlijk in.
    expect(CORS_ENV_VARS.every((v) => message.includes(v))).toBe(true);
    // En het stopt bij de eerste call: er is niets aangemaakt om op te ruimen.
    expect(calls).toHaveLength(1);
    expect(message).toContain("niets in n8n aangemaakt");
  });

  test("the CORS message adds the origin this page actually runs on", async () => {
    const { fetchImpl } = stubN8n({ throwOn: "first" });
    const outcome = await provisionN8n({
      baseUrl: BASE,
      apiKey: "k",
      origin: "http://localhost:5173",
      fetchImpl,
    });
    // 5173 staat NIET in de aanbevolen waarde. Advies dat niet kan werken in de
    // toestand waarin het verschijnt is precies wat hier niet mag, dus het
    // echte adres wordt erbij genoemd.
    expect(describeProvision(outcome)).toContain("http://localhost:5173");
  });

  test("a refused API key blames the key, not the network", async () => {
    const { fetchImpl } = stubN8n({ failStatus: 401 });
    const outcome = await provisionN8n({
      baseUrl: BASE,
      apiKey: "wrong",
      origin: ORIGIN,
      fetchImpl,
    });
    expect(outcome.kind).toBe("unauthorized");
    const message = describeProvision(outcome);
    expect(message).toContain("API-sleutel");
    expect(message).toContain("401");
    expect(message).toContain("niets aangemaakt");
  });

  test("a 404 on the first call names the variable that switches the public API off", async () => {
    const { fetchImpl } = stubN8n({ failStatus: 404 });
    const outcome = await provisionN8n({ baseUrl: BASE, apiKey: "k", origin: ORIGIN, fetchImpl });
    expect(outcome.kind).toBe("no-public-api");
    expect(describeProvision(outcome)).toContain("N8N_PUBLIC_API_DISABLED");
  });

  test("a failed activation is NOT reported as a working connection", async () => {
    const { fetchImpl } = stubN8n({ failActivateStatus: 400 });
    const outcome = await provisionN8n({
      baseUrl: BASE,
      apiKey: "k",
      origin: ORIGIN,
      fetchImpl,
      makeToken: () => "t",
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.active).toBe(false);
    const message = describeProvision(outcome);
    expect(message).toContain("NIET geactiveerd");
    expect(message).toContain("luistert de webhook niet");
  });

  test("an empty field is refused before anything is sent", async () => {
    const { fetchImpl, calls } = stubN8n();
    const outcome = await provisionN8n({ baseUrl: "", apiKey: "k", origin: ORIGIN, fetchImpl });
    expect(outcome.kind).toBe("not-configured");
    expect(calls).toHaveLength(0);
    expect(describeProvision(outcome)).toContain("niets verstuurd");
  });

  test("a host without a scheme is refused instead of being resolved against lavega.dev", async () => {
    const { fetchImpl, calls } = stubN8n();
    const outcome = await provisionN8n({
      baseUrl: "n8n.example",
      apiKey: "k",
      origin: ORIGIN,
      fetchImpl,
    });
    expect(outcome.kind).toBe("bad-url");
    expect(calls).toHaveLength(0);
    expect(describeProvision(outcome)).toContain("http://");
  });

  test("every success message names the one step that stays manual, and the node", async () => {
    const { fetchImpl } = stubN8n();
    const outcome = await provisionN8n({
      baseUrl: BASE,
      apiKey: "k",
      origin: ORIGIN,
      fetchImpl,
      makeToken: () => "t",
    });
    const message = describeProvision(outcome);
    expect(message).toContain(GMAIL_NODE_NAME);
    expect(message).toContain("Gmail-credential");
  });
});

describe("kleine onderdelen", () => {
  test("normalizeBaseUrl accepts what he is likely to paste", () => {
    expect(normalizeBaseUrl("https://n8n.example")).toBe("https://n8n.example");
    expect(normalizeBaseUrl("https://n8n.example/")).toBe("https://n8n.example");
    expect(normalizeBaseUrl("  https://n8n.example/api/v1  ")).toBe("https://n8n.example");
    expect(normalizeBaseUrl("https://host/n8n/")).toBe("https://host/n8n");
    expect(normalizeBaseUrl("n8n.example")).toBe("");
    expect(normalizeBaseUrl("")).toBe("");
  });

  test("productionWebhookUrl falls back to the webhookId when the path is empty", () => {
    expect(
      productionWebhookUrl("https://n8n.example", {
        name: "w",
        type: "n8n-nodes-base.webhook",
        parameters: { path: "lavega-facturen" },
      }),
    ).toBe("https://n8n.example/webhook/lavega-facturen");
    expect(
      productionWebhookUrl("https://n8n.example", {
        name: "w",
        type: "n8n-nodes-base.webhook",
        parameters: {},
        webhookId: "abc",
      }),
    ).toBe("https://n8n.example/webhook/abc");
    expect(
      productionWebhookUrl("https://n8n.example", {
        name: "w",
        type: "n8n-nodes-base.webhook",
        parameters: {},
      }),
    ).toBe("");
  });

  test("randomToken is hex, the requested length, and different every time", () => {
    const a = randomToken(24);
    const b = randomToken(24);
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });
});
