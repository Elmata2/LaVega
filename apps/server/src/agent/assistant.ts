import { amsterdamDay, CHAT_TOOL_SPECS, scrubIdentifiers } from "@lavega/core";
import type { LlmProvider, LlmToolMessage, LlmToolSchema } from "./provider.js";
import { composePrompt } from "./prompts.js";
import { ValidationError } from "./validationError.js";

/* The assistant chat's server half: a STATELESS proxy to the model.
 *
 * The browser runs the tool loop on the unlocked vault and sends the whole
 * conversation each round. This module validates what arrives (the redaction
 * boundary), adds the system prompt and the tool schemas, makes one model call
 * and hands back either tool calls or text. It reads no bank, stores nothing,
 * and logs nothing about the conversation. */

export const ASSISTANT_MAX_OUTPUT_TOKENS = 700;
const MAX_MESSAGES = 40;
const MAX_USER_CHARS = 500;
const MAX_ASSISTANT_CHARS = 4000;
const MAX_TOOL_CALLS_PER_MESSAGE = 6;
const MAX_ARGS_BYTES = 2000;
const MAX_TOOL_RESULT_BYTES = 12 * 1024;
const MAX_REQUEST_BYTES = 200 * 1024;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
/** The only keys a tool result may carry: the envelope the browser tools write, or their safe error. */
const RESULT_KEYS = new Set([
  "asOf",
  "scope",
  "coverage",
  "data",
  "truncated",
  "totalRows",
  "error",
  "hint",
]);
const TOOL_NAMES: ReadonlySet<string> = new Set(CHAT_TOOL_SPECS.map((s) => s.name));

export type AssistantLocale = "nl" | "en";

export type AssistantToolCall = { id: string; name: string; args: Record<string, unknown> };

export type AssistantMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AssistantToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type AssistantRequest = {
  locale: AssistantLocale;
  /** True: the model may not call tools in this round (the last round, or after a guard failed). */
  noTools: boolean;
  /** The user's calendar day (Europe/Amsterdam): the browser's, when it is within a day of ours. */
  today: string;
  messages: AssistantMessage[];
};

export type AssistantResult =
  | { type: "tool_calls"; calls: AssistantToolCall[] }
  | { type: "answer"; text: string };

const bad = (message: string): ValidationError =>
  new ValidationError("assistant-bad-input", message);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const bytes = (s: string): number => new TextEncoder().encode(s).length;

/** Identifiers out of every string in a value; numbers and structure untouched. */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (typeof value === "string") return scrubIdentifiers(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (isObject(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, depth + 1)]));
  return value;
}

function sanitizeToolCall(raw: unknown): AssistantToolCall {
  if (!isObject(raw)) throw bad("ongeldige toolaanroep");
  const { id, name, args } = raw;
  if (typeof id !== "string" || !ID.test(id)) throw bad("ongeldige toolaanroep");
  if (typeof name !== "string" || !TOOL_NAMES.has(name)) throw bad("onbekende tool");
  if (!isObject(args) || bytes(JSON.stringify(args)) > MAX_ARGS_BYTES)
    throw bad("ongeldige toolargumenten");
  return { id, name, args: scrubDeep(args) as Record<string, unknown> };
}

/** The redaction boundary for the assistant route. Throws `ValidationError`. */
export function sanitizeAssistantRequest(
  raw: unknown,
  serverToday: string = amsterdamDay(new Date()),
): AssistantRequest {
  if (!isObject(raw)) throw bad("ongeldige invoer");
  if (raw.locale !== "nl" && raw.locale !== "en") throw bad("ongeldige taal");
  const list = raw.messages;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MESSAGES)
    throw bad("ongeldig aantal berichten");
  if (bytes(JSON.stringify(list)) > MAX_REQUEST_BYTES) throw bad("te veel invoer");

  const messages: AssistantMessage[] = [];
  /** call id -> tool name, for the calls still waiting for their result. */
  const open = new Map<string, string>();
  for (const m of list) {
    if (!isObject(m)) throw bad("ongeldig bericht");
    if (m.role === "user") {
      if (typeof m.content !== "string") throw bad("ongeldig bericht");
      const content = scrubIdentifiers(m.content).slice(0, MAX_USER_CHARS);
      if (content.trim() === "") throw bad("leeg bericht");
      messages.push({ role: "user", content });
    } else if (m.role === "assistant") {
      if (typeof m.content !== "string" || m.content.length > MAX_ASSISTANT_CHARS)
        throw bad("ongeldig bericht");
      const content = scrubIdentifiers(m.content);
      if (m.toolCalls === undefined) {
        messages.push({ role: "assistant", content });
        continue;
      }
      if (
        !Array.isArray(m.toolCalls) ||
        m.toolCalls.length === 0 ||
        m.toolCalls.length > MAX_TOOL_CALLS_PER_MESSAGE
      )
        throw bad("ongeldige toolaanroepen");
      const toolCalls = m.toolCalls.map(sanitizeToolCall);
      for (const c of toolCalls) open.set(c.id, c.name);
      messages.push({ role: "assistant", content, toolCalls });
    } else if (m.role === "tool") {
      const { toolCallId, name, content } = m;
      if (typeof toolCallId !== "string" || typeof name !== "string" || typeof content !== "string")
        throw bad("ongeldig toolresultaat");
      if (open.get(toolCallId) !== name) throw bad("toolresultaat zonder aanroep");
      if (bytes(content) > MAX_TOOL_RESULT_BYTES) throw bad("toolresultaat te groot");
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw bad("ongeldig toolresultaat");
      }
      if (!isObject(parsed) || !Object.keys(parsed).every((k) => RESULT_KEYS.has(k)))
        throw bad("ongeldig toolresultaat");
      open.delete(toolCallId);
      messages.push({ role: "tool", toolCallId, name, content: JSON.stringify(scrubDeep(parsed)) });
    } else throw bad("ongeldige rol");
  }
  const last = messages[messages.length - 1];
  if (!last || last.role === "assistant") throw bad("laatste bericht is geen vraag of resultaat");
  const claimed = typeof raw.today === "string" ? raw.today : "";
  const near = [addDaysIso(serverToday, -1), serverToday, addDaysIso(serverToday, 1)];
  const today = near.includes(claimed) ? claimed : serverToday;
  return { locale: raw.locale, noTools: raw.noTools === true, today, messages };
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const TAG = { nl: "nl-NL", en: "en-GB" } as const;

/** The static prompt plus the channel, today's date and the answer language (`locale`,
 *  chosen by the app from the user's own words). */
export function assistantSystemPrompt(locale: AssistantLocale, today: string): string {
  const weekday = new Intl.DateTimeFormat(TAG[locale], { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${today}T00:00:00Z`),
  );
  const language = locale === "en" ? "English" : "Dutch";
  return `${composePrompt("_assistant.md")}\n\nCHANNEL: app\nTODAY: ${today} (${weekday})\nANSWER_LANGUAGE: ${language}`;
}

export function assistantToolSchemas(): LlmToolSchema[] {
  return CHAT_TOOL_SPECS.map((s) => ({
    name: s.name,
    description: s.description,
    parameters: s.schema,
  }));
}

const parseArgs = (text: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) ? v : {};
  } catch {
    return {};
  }
};

/** One model call for one round. `onUsage` receives the provider-reported tokens. */
export async function runAssistantStep(
  req: AssistantRequest,
  deps: {
    provider: LlmProvider;
    onUsage?: (usage: {
      inputTokens: number;
      outputTokens: number;
      cacheWriteTokens?: number;
      cacheReadTokens?: number;
    }) => void | Promise<void>;
  },
): Promise<AssistantResult> {
  const messages: LlmToolMessage[] = req.messages.map((m) => {
    if (m.role === "tool") return m;
    if (m.role === "assistant" && m.toolCalls)
      return {
        role: "assistant",
        content: m.content,
        toolCalls: m.toolCalls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments: JSON.stringify(c.args),
        })),
      };
    return { role: m.role, content: m.content };
  });
  const turn = await deps.provider.chatWithTools({
    system: assistantSystemPrompt(req.locale, req.today),
    messages,
    tools: assistantToolSchemas(),
    toolChoice: req.noTools ? "none" : "auto",
    maxTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
  });
  await deps.onUsage?.({
    inputTokens: turn.usage.input,
    outputTokens: turn.usage.output,
    ...(turn.usage.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: turn.usage.cacheWriteTokens }),
    ...(turn.usage.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: turn.usage.cacheReadTokens }),
  });
  if (turn.type === "tool_calls")
    return {
      type: "tool_calls",
      calls: turn.calls
        .slice(0, MAX_TOOL_CALLS_PER_MESSAGE)
        .map((c) => ({ id: c.id, name: c.name, args: parseArgs(c.arguments) })),
    };
  return { type: "answer", text: turn.text.trim().slice(0, MAX_ASSISTANT_CHARS) };
}
