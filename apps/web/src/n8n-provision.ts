/* Provisioning HIS n8n from the browser (docs/BACKLOG.md, "Decided 2026-08-17").
 *
 * What this replaces: exporting docs/n8n/lavega-invoices.json, importing it in
 * n8n, inventing a token, making a Header Auth credential, activating the
 * workflow, and copying the Production URL into Koppelingen. He now pastes his
 * n8n base URL and an n8n API key, and this module does those five things.
 *
 * TWO RULES SHAPE EVERYTHING BELOW.
 *
 * 1. THE CALL STAYS IN THE BROWSER. An n8n API key can create and modify
 *    workflows. Proxying it through the LaVega server would park that key on a
 *    shared host — a worse trade than the paste it replaces. So the key lives in
 *    localStorage, next to the buffer and the home country, and travels straight
 *    to his own n8n. The price is CORS, which n8n does not send by default; when
 *    that blocks us the message NAMES the two variables (see corsHelp).
 *
 * 2. THE WORKFLOW JSON IS NOT COPIED. It is imported from
 *    docs/n8n/lavega-invoices.json at build time, so the repo stays the single
 *    source of what gets pushed and the other agent's sync script keeps working
 *    against one file instead of two.
 *
 * What this CANNOT do, by design of Google and of n8n: attach the Gmail
 * credential. Google's consent is interactive, and n8n's public API has no
 * endpoint that LISTS credentials, so LaVega cannot find the one he already
 * made and bind it. That step is reported, precisely, instead of being hidden.
 */

import workflowTemplate from "../../../docs/n8n/lavega-invoices.json";

/** The name we find-or-create by. Must match the JSON's own `name`, otherwise a
 *  second press would create a second workflow every time. */
export const WORKFLOW_NAME: string = workflowTemplate.name;

/** The node he has to bind the Gmail credential to, by its exact n8n name. */
export const GMAIL_NODE_NAME = "Gmail: recente mail";

/** The header the webhook authenticates on — same value as docs/n8n/FACTUREN.md
 *  and as the `x-lavega-token` header fetchQueue() sends. */
export const TOKEN_HEADER = "x-lavega-token";

/** The n8n credential we create. Named so it is recognisable in his n8n. */
export const CREDENTIAL_NAME = "LaVega factuurtoken";

/** The two environment variables his n8n needs before a browser may call its
 *  REST API. Quoted verbatim in every CORS message — a generic "kon geen
 *  verbinding maken" is exactly the failure this feature must not produce. */
export const CORS_ENV_VARS = [
  "N8N_DEFAULT_CORS=true",
  "N8N_CORS_ALLOW_ORIGIN=https://lavega.dev,http://localhost:5174",
] as const;

type N8nNode = {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  webhookId?: string;
  [k: string]: unknown;
};

type N8nWorkflow = {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  id?: string;
  active?: boolean;
};

const TEMPLATE = workflowTemplate as unknown as N8nWorkflow;

/** Every step, so a failure can say which call died rather than "er ging iets
 *  mis". The strings are Dutch because they end up on his screen. */
export type ProvisionStep =
  | "workflows opvragen"
  | "credential aanmaken"
  | "workflow aanmaken"
  | "workflow bijwerken"
  | "workflow activeren"
  | "webhook-URL teruglezen";

export type ProvisionOutcome =
  | {
      kind: "ok";
      /** true = LaVega made the workflow; false = it was already there and only
       *  the webhook node was rebound (his Gmail credential is kept). */
      created: boolean;
      workflowId: string;
      webhookUrl: string;
      token: string;
      /** false = everything was written but n8n refused to activate. The webhook
       *  does NOT listen then, and the message says so. */
      active: boolean;
      activationProblem: string;
    }
  | { kind: "not-configured"; missing: "url" | "key" | "both" }
  | { kind: "bad-url"; value: string }
  | { kind: "cors"; base: string; origin: string }
  | { kind: "unauthorized"; status: number }
  | { kind: "no-public-api"; status: number; base: string }
  | { kind: "http-error"; step: ProvisionStep; status: number; detail: string }
  | { kind: "bad-response"; step: ProvisionStep; detail: string }
  | { kind: "no-webhook-node"; workflowId: string };

/* ── kleine hulpjes ─────────────────────────────────────────────────────── */

/** Accepts what he is likely to paste: with or without a trailing slash, and
 *  with or without `/api/v1` already on the end. Returns "" for anything that
 *  isn't an http(s) origin — a bare host would otherwise be resolved against
 *  lavega.dev and we'd silently call ourselves. */
export function normalizeBaseUrl(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/i, "");
  return `${url.origin}${path}`;
}

/** A token he never has to see or type. 32 bytes of real randomness — the same
 *  strength `openssl rand -hex 24` gave him by hand, generated here so the step
 *  disappears. */
export function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    // No CSPRNG = no token. Guessing with Math.random would produce a value that
    // LOOKS like a secret and is not one, which is worse than refusing.
    throw new Error(
      "Deze browser heeft geen crypto.getRandomValues — LaVega weigert een zwak token te verzinnen.",
    );
  }
  c.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isWebhook(node: N8nNode): boolean {
  return node.type === "n8n-nodes-base.webhook";
}

/**
 * The webhook LaVega READS the queue from — not just "a webhook node".
 *
 * The workflow has two of them: the GET one this browser polls, and the POST one
 * the Cloudflare Email Worker delivers forwarded mail to. Picking the first
 * webhook by type would hand back the mail-in URL, and Facturen would then poll
 * an endpoint that answers nothing. So it is chosen by what it IS: the GET one.
 * (n8n leaves `httpMethod` unset for its default, which is GET.)
 */
export function findQueueWebhookNode(wf: N8nWorkflow): N8nNode | null {
  const webhooks = wf.nodes.filter(isWebhook);
  return (
    webhooks.find((n) => {
      const method = String(
        (n.parameters as Record<string, unknown> | undefined)?.httpMethod ?? "GET",
      ).toUpperCase();
      return method === "GET";
    }) ?? null
  );
}

/**
 * Bind the webhook node to the Header Auth credential and let THIS page's origin
 * through.
 *
 * The origin matters as much as the credential. The shipped JSON allows
 * `https://lavega.dev, http://localhost:5173`; provisioning from any other
 * origin (a different dev port, a preview host) would produce a workflow that is
 * correct in n8n and unreachable from the page that just made it. Rather than
 * printing advice that cannot work, we add the origin we are actually running
 * on and keep the ones already there.
 */
export function bindWebhookNode(
  node: N8nNode,
  credentialId: string,
  origin: string,
  isQueue: boolean,
): N8nNode {
  const params = { ...node.parameters } as Record<string, unknown>;
  if (isQueue) {
    const options = { ...(params.options as Record<string, unknown>) };
    const existing = String(options.allowedOrigins ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (origin && !existing.includes(origin)) existing.push(origin);
    options.allowedOrigins = existing.join(", ");
    params.options = options;
  }
  params.authentication = "headerAuth";
  return {
    ...node,
    parameters: params,
    credentials: {
      ...node.credentials,
      httpHeaderAuth: { id: credentialId, name: CREDENTIAL_NAME },
    },
  };
}

/**
 * Bind EVERY webhook node to the one credential.
 *
 * Not tidiness — a requirement. The mail-in node already declares
 * `authentication: "headerAuth"` in the bundled JSON, and n8n refuses to
 * activate a workflow whose node is missing a credential it says it needs. Bind
 * only the queue node and provisioning would end on "written but NOT activated"
 * every single time, which is a truthful message about a broken result.
 *
 * One token for both entry points is also the simpler thing to explain: the
 * Email Worker sends the same `x-lavega-token` header this browser does.
 */
function bindWebhookNodes(
  nodes: N8nNode[],
  queue: N8nNode,
  credentialId: string,
  origin: string,
): N8nNode[] {
  return nodes.map((n) =>
    isWebhook(n) ? bindWebhookNode(n, credentialId, origin, n === queue) : n,
  );
}

/** The production URL n8n will serve this webhook on. n8n's public API does not
 *  return it, so it is composed from the base he gave us and the path we read
 *  BACK out of the saved workflow — not out of our own copy. */
export function productionWebhookUrl(base: string, node: N8nNode): string {
  const params = (node.parameters ?? {}) as Record<string, unknown>;
  const path = String(params.path ?? "").trim() || String(node.webhookId ?? "").trim();
  if (!path) return "";
  return `${base}/webhook/${path.replace(/^\/+/, "")}`;
}

/* ── de HTTP-laag ───────────────────────────────────────────────────────── */

type ApiResult =
  | { ok: true; body: unknown; status: number }
  | {
      ok: false;
      failure: Extract<
        ProvisionOutcome,
        { kind: "cors" | "unauthorized" | "http-error" | "bad-response" }
      >;
    };

async function call(
  base: string,
  apiKey: string,
  path: string,
  init: RequestInit,
  step: ProvisionStep,
  fetchImpl: typeof fetch,
  origin: string,
): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/v1${path}`, {
      ...init,
      headers: {
        "X-N8N-API-KEY": apiKey,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    // A cross-origin call that the browser blocks and a host that isn't there
    // both arrive here as one TypeError — the browser deliberately tells the
    // page nothing more. So the message covers both and leads with the one that
    // is nearly always the cause the first time.
    return { ok: false, failure: { kind: "cors", base, origin } };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, failure: { kind: "unauthorized", status: res.status } };
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: unknown; hint?: unknown };
      detail = [body?.message, body?.hint].filter((v) => typeof v === "string").join(" — ");
    } catch {
      /* a non-JSON error body just leaves the status to speak */
    }
    return { ok: false, failure: { kind: "http-error", step, status: res.status, detail } };
  }
  let body: unknown;
  try {
    body = res.status === 204 ? {} : await res.json();
  } catch {
    return {
      ok: false,
      failure: { kind: "bad-response", step, detail: "het antwoord was geen JSON" },
    };
  }
  return { ok: true, body, status: res.status };
}

function asWorkflow(body: unknown): N8nWorkflow | null {
  if (!body || typeof body !== "object") return null;
  const w = body as Record<string, unknown>;
  // n8n wraps some responses in { data: ... }; both shapes are accepted, neither
  // is guessed at.
  const inner =
    w.data && typeof w.data === "object" && !Array.isArray(w.data)
      ? (w.data as Record<string, unknown>)
      : w;
  if (typeof inner.id !== "string" && typeof inner.id !== "number") return null;
  if (!Array.isArray(inner.nodes)) return null;
  return {
    id: String(inner.id),
    name: String(inner.name ?? ""),
    nodes: inner.nodes as N8nNode[],
    connections: (inner.connections as Record<string, unknown>) ?? {},
    settings: (inner.settings as Record<string, unknown>) ?? undefined,
    active: inner.active === true,
  };
}

export type ProvisionInput = {
  baseUrl: string;
  apiKey: string;
  /** This page's origin — it must end up in the webhook's allowedOrigins or the
   *  queue fetch we just enabled would be blocked by the browser. */
  origin: string;
  fetchImpl?: typeof fetch;
  /** Injectable so a test asserts the exact token that was stored. */
  makeToken?: () => string;
};

/**
 * Find-or-create → credential → bind → activate → read the URL back.
 *
 * On an EXISTING workflow only the webhook node is rewritten. The rest of the
 * nodes are the ones already in his n8n, deliberately: overwriting them with the
 * bundled copy would throw away the Gmail credential he attached by hand — the
 * one thing this whole flow cannot restore.
 */
export async function provisionN8n(input: ProvisionInput): Promise<ProvisionOutcome> {
  const rawBase = String(input.baseUrl ?? "").trim();
  const apiKey = String(input.apiKey ?? "").trim();
  if (!rawBase || !apiKey) {
    return {
      kind: "not-configured",
      missing: !rawBase && !apiKey ? "both" : !rawBase ? "url" : "key",
    };
  }
  const base = normalizeBaseUrl(rawBase);
  if (!base) return { kind: "bad-url", value: rawBase };

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const origin = String(input.origin ?? "").trim();
  const token = (input.makeToken ?? randomToken)();

  // 1 — is it already there?
  const list = await call(
    base,
    apiKey,
    "/workflows?limit=250",
    { method: "GET" },
    "workflows opvragen",
    fetchImpl,
    origin,
  );
  if (!list.ok) {
    // A 404 on the very first call is not "no workflows": it is n8n telling us
    // the public API isn't there at all. Reported as its own cause, because the
    // fix is an environment variable and not a retry.
    if (list.failure.kind === "http-error" && list.failure.status === 404) {
      return { kind: "no-public-api", status: 404, base };
    }
    return list.failure;
  }
  const listBody = list.body as { data?: unknown };
  if (!Array.isArray(listBody?.data)) {
    return {
      kind: "bad-response",
      step: "workflows opvragen",
      detail: "n8n stuurde geen lijst met workflows terug",
    };
  }
  const existing = (listBody.data as Array<Record<string, unknown>>).find(
    (w) => w?.name === WORKFLOW_NAME,
  );

  // 2 — the credential, always fresh. n8n's API has no way to LIST credentials,
  // so LaVega cannot find the one it made last time and reuse it. A new one each
  // time is the honest consequence; the UI says the old one stays behind.
  const credRes = await call(
    base,
    apiKey,
    "/credentials",
    {
      method: "POST",
      body: JSON.stringify({
        name: CREDENTIAL_NAME,
        type: "httpHeaderAuth",
        data: { name: TOKEN_HEADER, value: token },
      }),
    },
    "credential aanmaken",
    fetchImpl,
    origin,
  );
  if (!credRes.ok) return credRes.failure;
  const credBody = credRes.body as { id?: unknown; data?: { id?: unknown } };
  const credentialId = String(credBody?.id ?? credBody?.data?.id ?? "");
  if (!credentialId) {
    return {
      kind: "bad-response",
      step: "credential aanmaken",
      detail: "n8n gaf geen credential-id terug",
    };
  }

  // 3 — write the workflow.
  let saved: N8nWorkflow | null;
  let created: boolean;
  if (!existing) {
    const node = findQueueWebhookNode(TEMPLATE);
    if (!node) return { kind: "no-webhook-node", workflowId: "" };
    const nodes = bindWebhookNodes(TEMPLATE.nodes, node, credentialId, origin);
    const res = await call(
      base,
      apiKey,
      "/workflows",
      {
        method: "POST",
        body: JSON.stringify({
          name: WORKFLOW_NAME,
          nodes,
          connections: TEMPLATE.connections,
          settings: TEMPLATE.settings ?? { executionOrder: "v1" },
        }),
      },
      "workflow aanmaken",
      fetchImpl,
      origin,
    );
    if (!res.ok) return res.failure;
    saved = asWorkflow(res.body);
    created = true;
    if (!saved)
      return {
        kind: "bad-response",
        step: "workflow aanmaken",
        detail: "n8n gaf geen workflow met id en nodes terug",
      };
  } else {
    const id = String(existing.id ?? "");
    const full = await call(
      base,
      apiKey,
      `/workflows/${encodeURIComponent(id)}`,
      { method: "GET" },
      "workflows opvragen",
      fetchImpl,
      origin,
    );
    if (!full.ok) return full.failure;
    const current = asWorkflow(full.body);
    if (!current)
      return {
        kind: "bad-response",
        step: "workflows opvragen",
        detail: "n8n gaf geen workflow met id en nodes terug",
      };
    const node = findQueueWebhookNode(current);
    if (!node) return { kind: "no-webhook-node", workflowId: id };
    const nodes = bindWebhookNodes(current.nodes, node, credentialId, origin);
    const res = await call(
      base,
      apiKey,
      `/workflows/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: current.name || WORKFLOW_NAME,
          nodes,
          connections: current.connections,
          settings: current.settings ?? { executionOrder: "v1" },
        }),
      },
      "workflow bijwerken",
      fetchImpl,
      origin,
    );
    if (!res.ok) return res.failure;
    saved = asWorkflow(res.body) ?? { ...current, nodes };
    saved.id = id;
    created = false;
  }

  const workflowId = String(saved.id ?? "");

  // 4 — activate. A webhook only listens in an ACTIVE workflow, so a failure
  // here is not cosmetic and is never folded into the success sentence.
  let active = true;
  let activationProblem = "";
  const act = await call(
    base,
    apiKey,
    `/workflows/${encodeURIComponent(workflowId)}/activate`,
    { method: "POST" },
    "workflow activeren",
    fetchImpl,
    origin,
  );
  if (!act.ok) {
    const f = act.failure;
    // CORS and a refused key are about the CONNECTION, not about this workflow:
    // they invalidate everything after them, so they abort rather than downgrade
    // to "written but not active".
    if (f.kind === "cors" || f.kind === "unauthorized") return f;
    active = false;
    activationProblem =
      f.kind === "http-error"
        ? `n8n weigerde te activeren (status ${f.status}${f.detail ? `: ${f.detail}` : ""})`
        : `n8n gaf een onleesbaar antwoord op het activeren (${f.detail})`;
  }

  // 5 — read the URL back out of n8n instead of assuming our own copy landed.
  const back = await call(
    base,
    apiKey,
    `/workflows/${encodeURIComponent(workflowId)}`,
    { method: "GET" },
    "webhook-URL teruglezen",
    fetchImpl,
    origin,
  );
  if (!back.ok) return back.failure;
  const readBack = asWorkflow(back.body);
  const webhookNode = readBack ? findQueueWebhookNode(readBack) : null;
  if (!webhookNode) return { kind: "no-webhook-node", workflowId };
  const webhookUrl = productionWebhookUrl(base, webhookNode);
  if (!webhookUrl) {
    return {
      kind: "bad-response",
      step: "webhook-URL teruglezen",
      detail: "de webhook-node had geen pad",
    };
  }

  return { kind: "ok", created, workflowId, webhookUrl, token, active, activationProblem };
}

/* ── wat hij leest ──────────────────────────────────────────────────────── */

/** The CORS message, on its own so a test can assert it names both variables
 *  and so the Koppelingen screen can show it before he even presses anything. */
export function corsHelp(base: string, origin: string): string {
  const covered = CORS_ENV_VARS[1].split("=")[1].split(",");
  const originNote =
    origin && !covered.includes(origin)
      ? ` Deze pagina draait op ${origin}, dus zet dat adres er ook bij — anders blokkeert de browser het antwoord alsnog.`
      : "";
  return (
    `De browser kreeg geen antwoord van ${base}/api/v1. Bijna altijd is dat CORS: n8n stuurt daar standaard geen ` +
    `CORS-headers, en dan blokkeert de browser het antwoord voordat LaVega het ziet. Zet op je eigen n8n deze twee ` +
    `omgevingsvariabelen en herstart n8n: ${CORS_ENV_VARS[0]} en ${CORS_ENV_VARS[1]}.${originNote} ` +
    `Staat n8n uit of klopt de basis-URL niet, dan geeft de browser exact dezelfde fout — open ${base} eerst in een tabblad. ` +
    `Er is niets in n8n aangemaakt of gewijzigd zolang deze fout op de eerste stap valt.`
  );
}

/** One sentence per outcome, each naming the variable, setting or step that is
 *  actually wrong. Nothing here may read like a success. */
export function describeProvision(outcome: ProvisionOutcome): string {
  switch (outcome.kind) {
    case "ok": {
      const head = outcome.created
        ? `Workflow “${WORKFLOW_NAME}” aangemaakt in n8n`
        : `Workflow “${WORKFLOW_NAME}” stond er al; LaVega heeft alleen de webhook opnieuw gekoppeld (je Gmail-credential is ongemoeid gelaten)`;
      const state = outcome.active
        ? "en geactiveerd"
        : `maar NIET geactiveerd: ${outcome.activationProblem}. Zolang de workflow uit staat luistert de webhook niet en komt er niets binnen`;
      return (
        `${head} ${state}. Token aangemaakt en samen met ${outcome.webhookUrl} in deze browser opgeslagen. ` +
        `Nog één ding, en dat kan LaVega niet voor je doen: open de workflow in n8n en kies bij de node ` +
        `“${GMAIL_NODE_NAME}” je Gmail-credential. Google's toestemming is een klik van jou, en n8n's API kan ` +
        `bestaande credentials niet opzoeken — daarom moet die ene stap met de hand.`
      );
    }
    case "not-configured":
      return outcome.missing === "both"
        ? "Vul eerst je n8n-adres én een n8n API-sleutel in. Er is niets verstuurd."
        : outcome.missing === "url"
          ? "Het n8n-adres is leeg. Er is niets verstuurd."
          : "De n8n API-sleutel is leeg. Maak er een in n8n onder Settings → n8n API. Er is niets verstuurd.";
    case "bad-url":
      return `“${outcome.value}” is geen adres waar LaVega naartoe kan bellen — het moet met http:// of https:// beginnen, bijvoorbeeld https://n8n.jouwdomein.nl. Er is niets verstuurd.`;
    case "cors":
      return corsHelp(outcome.base, outcome.origin);
    case "unauthorized":
      return `n8n weigerde de API-sleutel (${outcome.status}). Maak een nieuwe in n8n onder Settings → n8n API en plak die hier; de sleutel blijft in deze browser en gaat nooit naar de LaVega-server. Er is niets aangemaakt.`;
    case "no-public-api":
      return `n8n antwoordde 404 op ${outcome.base}/api/v1/workflows. Dan staat de publieke API uit (omgevingsvariabele N8N_PUBLIC_API_DISABLED) of wijst het adres niet naar n8n. Er is niets aangemaakt.`;
    case "http-error":
      return `n8n gaf status ${outcome.status} bij “${outcome.step}”${outcome.detail ? `: ${outcome.detail}` : ""}. LaVega is daar gestopt — controleer dit in n8n voor je opnieuw verbindt.`;
    case "bad-response":
      return `Het antwoord van n8n bij “${outcome.step}” was niet te gebruiken: ${outcome.detail}. LaVega is daar gestopt.`;
    case "no-webhook-node":
      return `De workflow “${WORKFLOW_NAME}” in jouw n8n heeft geen Webhook-node meer, dus er valt niets te koppelen. Hernoem of verwijder die workflow in n8n, dan maakt LaVega hem opnieuw aan.`;
  }
}
