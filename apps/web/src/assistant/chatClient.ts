import type { ChatLocale, ChatStep, ChatStepResult } from "@lavega/core";
import { API_BASE } from "../api.js";

/* The browser half of the Assistent chat's wire: one POST per model round to the
 * stateless proxy, and the public "is AI configured" check. The body is exactly
 * `{locale, noTools, messages}`; the messages were built by the turn loop from the
 * scrubbed question and tool results, nothing else is added here. */

/** A little above the server's own 60 s provider timeout, so the server's answer wins. */
export const CLIENT_TIMEOUT_MS = 65_000;

export type AssistantErrorReason =
  | "offline"
  | "rate"
  | "budget"
  | "not-configured"
  | "signed-out"
  | "timeout"
  | "cancelled"
  | "unavailable";

/** A round that did not produce a step. Carries a KIND, never a server sentence. */
export class AssistantStepError extends Error {
  constructor(readonly reason: AssistantErrorReason) {
    super(reason);
    this.name = "AssistantStepError";
  }
}

function reasonFor(status: number, code: string | undefined): AssistantErrorReason {
  if (status === 401) return "signed-out";
  if (status === 503) return "not-configured";
  if (status === 429)
    return code === "ai-budget-day" || code === "ai-budget-month" ? "budget" : "rate";
  return "unavailable";
}

function isStep(body: unknown): body is ChatStepResult {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { type?: unknown; text?: unknown; calls?: unknown };
  return (
    (b.type === "answer" && typeof b.text === "string") ||
    (b.type === "tool_calls" && Array.isArray(b.calls))
  );
}

export type AssistantStepOptions = {
  /** The user's calendar day (Europe/Amsterdam), sent so both sides agree. */
  today: string;
  /** Read before EVERY request: consent can be withdrawn while a question is running. */
  enabled: () => boolean;
  /** Aborted on switch-off, unmount or account change. */
  signal?: AbortSignal;
};

/** `language` is the language of the answer, chosen from the user's own words. */
export function createAssistantStep(language: ChatLocale, options: AssistantStepOptions): ChatStep {
  return async ({ messages, noTools }) => {
    if (options.signal?.aborted || !options.enabled()) throw new AssistantStepError("cancelled");
    const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/agent/assistant`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: language, noTools, today: options.today, messages }),
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (options.signal?.aborted) throw new AssistantStepError("cancelled");
      if (error instanceof DOMException && error.name === "TimeoutError")
        throw new AssistantStepError("timeout");
      throw new AssistantStepError("offline");
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const code = (body as { code?: unknown } | null)?.code;
      throw new AssistantStepError(
        reasonFor(res.status, typeof code === "string" ? code : undefined),
      );
    }
    if (options.signal?.aborted || !options.enabled()) throw new AssistantStepError("cancelled");
    if (!isStep(body)) throw new AssistantStepError("unavailable");
    return body;
  };
}

/** Is an AI service configured on the server? False only when the server says so;
 *  a failed check does not block (the route itself answers 503 when it is not). */
export async function fetchAssistantConfigured(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/agent/status`, { credentials: "same-origin" });
    if (!res.ok) return true;
    const body = (await res.json()) as { configured?: unknown };
    return body.configured !== false;
  } catch {
    return true;
  }
}
