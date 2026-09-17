// First-party client based on Gloomberb implementation.
import { httpFetch } from "../../../vendor/gloomberb/http-transport.js";
import { hasBrokerSyncTime } from "../BrokerAccessAdapter.js";

export interface FlexQueryConfig {
  token: string;
  queryId: string;
  endpoint?: string;
  /** Test/config override; production defaults match IBKR's expected delay. */
  initialWaitMs?: number;
  pollDelayMs?: number;
  maxDownloadAttempts?: number;
  /** Absolute Unix time. Undefined keeps local sync unlimited. */
  deadlineMs?: number;
}

export const IBKR_STATEMENT_URL =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest";
const IBKR_STATEMENT_GET_URL =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement";
const FLEX_USER_AGENT = "Gloomberb/1.0 Flex";
const FLEX_STATEMENT_INITIAL_WAIT_MS = 3_000;
const FLEX_STATEMENT_POLL_DELAY_MS = 5_000;
const FLEX_STATEMENT_MAX_DOWNLOAD_ATTEMPTS = 60;
const FLEX_DEADLINE_MESSAGE =
  "IBKR Flex sync paused before the host time limit; retry on the next sync";

type FlexRequestPhase = "request" | "download";

interface FlexErrorContext {
  phase: FlexRequestPhase;
  endpoint?: string;
  queryId?: string;
  token?: string;
  referenceCode?: string;
  httpStatus?: number;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractXmlTag(text: string, tagName: string): string | null {
  const match = text.match(new RegExp(`<${tagName}>\\s*([^<]*?)\\s*<\\/${tagName}>`, "i"));
  return match?.[1] ? decodeXmlText(match[1].trim()) : null;
}

function extractFlexErrorMessage(text: string): string | null {
  const message = extractXmlTag(text, "ErrorMessage");
  const code = extractXmlTag(text, "ErrorCode");
  if (message && code) return `IBKR error ${code}: ${message}`;
  return message;
}

function buildFlexUrl(endpoint: string, params: Record<string, string>): string {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function resolveFlexGetEndpoint(sendEndpoint: string | undefined): string {
  if (!sendEndpoint || sendEndpoint === IBKR_STATEMENT_URL) return IBKR_STATEMENT_GET_URL;

  try {
    const url = new URL(sendEndpoint);
    url.search = "";
    if (url.pathname.endsWith("/SendRequest")) {
      url.pathname = url.pathname.replace(/\/SendRequest$/, "/GetStatement");
      return url.toString();
    }
    if (url.pathname.endsWith("FlexStatementService.SendRequest")) {
      url.pathname = url.pathname.replace(
        /FlexStatementService\.SendRequest$/,
        "FlexStatementService.GetStatement",
      );
      return url.toString();
    }
  } catch {
    return IBKR_STATEMENT_GET_URL;
  }

  return IBKR_STATEMENT_GET_URL;
}

function flexRequestInit(): RequestInit {
  return {
    headers: {
      "User-Agent": FLEX_USER_AGENT,
    },
    signal: AbortSignal.timeout(30_000),
  };
}

function endpointName(endpoint: string | undefined): string {
  if (!endpoint) return "default";
  try {
    const url = new URL(endpoint);
    return url.pathname.split("/").filter(Boolean).at(-1) || url.hostname;
  } catch {
    return endpoint.split("?")[0]?.split("/").filter(Boolean).at(-1) || endpoint;
  }
}

function buildFlexErrorMessage(providerMessage: string, context: FlexErrorContext): string {
  const phase =
    context.phase === "request"
      ? "requesting the statement"
      : "downloading the generated statement";
  const details = [
    `Endpoint ${endpointName(context.endpoint)}`,
    context.queryId ? `query ID ${context.queryId}` : null,
    context.referenceCode ? `reference code ${context.referenceCode}` : null,
    context.token ? "token configured" : "token missing",
    context.httpStatus && context.httpStatus >= 400 ? `HTTP ${context.httpStatus}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const advice =
    context.phase === "request"
      ? "Check that Flex Web Service is enabled, the token is active, and the query ID belongs to that token."
      : "IBKR accepted the request but did not return the statement; retry shortly or check that the Flex query can generate a statement.";

  return `IBKR Flex request failed while ${phase}: ${providerMessage}. ${details}. ${advice}`;
}

function flexError(providerMessage: string, context: FlexErrorContext): Error {
  return new Error(buildFlexErrorMessage(providerMessage, context));
}

function throwIfFlexDeadline(deadlineMs: number | undefined, workMs = 0): void {
  if (!hasBrokerSyncTime(deadlineMs, workMs)) throw new Error(FLEX_DEADLINE_MESSAGE);
}

export async function requestFlexStatement(config: FlexQueryConfig): Promise<string> {
  const endpoint = config.endpoint || IBKR_STATEMENT_URL;
  const url = buildFlexUrl(endpoint, {
    t: config.token,
    q: config.queryId,
    v: "3",
  });
  let resp: Response;
  let text: string;
  throwIfFlexDeadline(config.deadlineMs);
  try {
    resp = await httpFetch(url, flexRequestInit());
    text = await resp.text();
  } catch (error) {
    throw flexError(error instanceof Error ? error.message : "Network request failed", {
      phase: "request",
      endpoint,
      queryId: config.queryId,
      token: config.token,
    });
  }

  const referenceCode = extractXmlTag(text, "ReferenceCode");
  if (!referenceCode) {
    throw flexError(extractFlexErrorMessage(text) || "No reference code returned", {
      phase: "request",
      endpoint,
      queryId: config.queryId,
      token: config.token,
      httpStatus: resp.status,
    });
  }

  return referenceCode;
}

async function getFlexStatement(
  token: string,
  referenceCode: string,
  context: Partial<
    Pick<
      FlexQueryConfig,
      | "endpoint"
      | "queryId"
      | "initialWaitMs"
      | "pollDelayMs"
      | "maxDownloadAttempts"
      | "deadlineMs"
    >
  > = {},
): Promise<string> {
  const initialWaitMs = context.initialWaitMs ?? FLEX_STATEMENT_INITIAL_WAIT_MS;
  throwIfFlexDeadline(context.deadlineMs, initialWaitMs);
  await new Promise((resolve) => setTimeout(resolve, initialWaitMs));

  const endpoint = resolveFlexGetEndpoint(context.endpoint);
  const url = buildFlexUrl(endpoint, {
    t: token,
    q: referenceCode,
    v: "3",
  });
  for (
    let attempt = 0;
    attempt < (context.maxDownloadAttempts ?? FLEX_STATEMENT_MAX_DOWNLOAD_ATTEMPTS);
    attempt += 1
  ) {
    let resp: Response;
    let text: string;
    throwIfFlexDeadline(context.deadlineMs);
    try {
      resp = await httpFetch(url, flexRequestInit());
      text = await resp.text();
    } catch (error) {
      throw flexError(error instanceof Error ? error.message : "Network request failed", {
        phase: "download",
        endpoint,
        queryId: context.queryId,
        token,
        referenceCode,
      });
    }

    if (text.includes("<FlexQueryResponse") || text.includes("<FlexStatements")) {
      return text;
    }

    if (text.includes("Statement generation in progress")) {
      const pollDelayMs = context.pollDelayMs ?? FLEX_STATEMENT_POLL_DELAY_MS;
      throwIfFlexDeadline(context.deadlineMs, pollDelayMs);
      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
      continue;
    }

    const providerMessage = extractFlexErrorMessage(text);
    if (providerMessage) {
      throw flexError(providerMessage, {
        phase: "download",
        endpoint,
        queryId: context.queryId,
        token,
        referenceCode,
        httpStatus: resp.status,
      });
    }
  }

  throw flexError("statement generation timed out", {
    phase: "download",
    endpoint,
    queryId: context.queryId,
    token,
    referenceCode,
  });
}

export async function loadFlexStatement(config: FlexQueryConfig): Promise<string> {
  const referenceCode = await requestFlexStatement(config);
  return getFlexStatement(config.token, referenceCode, config);
}
