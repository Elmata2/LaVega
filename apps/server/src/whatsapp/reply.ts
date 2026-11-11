import { randomUUID } from "node:crypto";
import {
  amsterdamDay,
  DE_CATEGORY_RULES,
  NL_CATEGORY_RULES,
  parseToolCall,
  runTool,
  scrubPersonalValues,
  type AgentMirror,
  type ToolCall,
} from "@lavega/core";
import {
  createAgentRepository,
  createEbFlowRepository,
  type AgentRepository,
  type Database,
} from "@lavega/database";
import { SESSION_TTL_MS } from "../eb-routes.js";
import {
  checkBudget,
  recordUsage,
  releaseReservation,
  type ReservationHandle,
} from "../agent/budget.js";
import { WHATSAPP_FETCH_CAP, type EbSessionRow } from "../agent/instinct.js";
import { createMistralProvider } from "../agent/mistral.js";
import { MISTRAL_SMALL } from "../agent/models.js";
import { composeAnswer, guardAnswer, parseSelection } from "../agent/numberGuard.js";
import { composePrompt } from "../agent/prompts.js";
import type { LlmProvider } from "../agent/provider.js";
import { createRateLimiter, type RateLimiter } from "../agent/rateLimit.js";
import { fetchForAgent } from "../agent/unattendedFetch.js";
import { WindowClosedError, whatsappClientFromEnv, type WhatsAppClient } from "./client.js";
import { moreFacts, WHATSAPP_COPY } from "./copy.js";
import type { Inbound } from "./webhook.js";

/* The two-way answer path. The privacy line runs through here:
 *  - bank transactions are fetched into memory for this one call and only a pure
 *    tool (`runTool`) reads them;
 *  - the model is called at most twice and sees only the scrubbed question, today's date,
 *    the category names and the computed facts, never a transaction, a counterparty,
 *    an IBAN, a balance, the number, the user id or the email; a result whose facts
 *    embed bank text (`containsBankText`) skips the second call entirely;
 *  - the model never writes the answer: it selects computed fact sentences by
 *    index and the server sends them verbatim (all of them if the selection is bad).
 * Nothing here logs a question, an answer, a prompt, a figure or a fact, and
 * `answerInbound` never throws: the webhook's dedupe key would make a retry useless. */

const MAX_QUESTION_CHARS = 500;
/** One deadline over the whole answer: two model calls and a bank read. */
export const DEADLINE_MS = 20_000;
const STEP_1_MAX_TOKENS = 200;
const STEP_2_MAX_TOKENS = 300;
const MESSAGES_PER_HOUR = 20;

export type Outcome =
  | "answered"
  | "fallback"
  | "no-data"
  | "rate-limited"
  | "window-closed"
  | "agent-off"
  | "error";

type ReplyRepo = Pick<
  AgentRepository,
  "getSettings" | "getLink" | "getMirror" | "takeFetchBudget" | "appendEvent"
>;

export type ReplyDeps = {
  repo: ReplyRepo;
  fetchSessions: (userId: string) => Promise<EbSessionRow[]>;
  fetchOutcome: typeof fetchForAgent;
  llm: LlmProvider;
  budget: typeof checkBudget;
  client: WhatsAppClient;
  now: () => number;
  recordUsage?: typeof recordUsage;
  releaseReservation?: typeof releaseReservation;
  limiter?: RateLimiter;
  timer?: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
};

class DeadlineError extends Error {
  constructor() {
    super("The answer took too long");
    this.name = "DeadlineError";
  }
}

const defaultLimiter = createRateLimiter(MESSAGES_PER_HOUR, 60 * 60 * 1000);
const EMPTY_MIRROR: AgentMirror = { rules: [], dueDates: [], cardOffer: null };
const CATEGORIES = [
  ...new Set([...NL_CATEGORY_RULES, ...DE_CATEGORY_RULES].map((r) => r.category)),
].sort();

const kindOf = (error: unknown) => (error instanceof Error ? error.name : "UnknownError");

/** Step 1 output to a `ToolCall`. Anything that is not exactly a known call is `unknown`. */
function toolCallFrom(text: string): ToolCall {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return { tool: "unknown" };
  try {
    return parseToolCall(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return { tool: "unknown" };
  }
}

const weekdayOf = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );

type Ctx = {
  deps: ReplyDeps;
  userId: string;
  to: string;
  windowOpenAt: number | null;
  aiConsent: boolean;
  locale: "nl" | "en";
  usage: { calls: number; input: number; output: number };
  reservation?: ReservationHandle;
  /** Set when the deadline passed: the abandoned work must not send or spend more. */
  abandoned?: boolean;
};

export async function answerInbound(
  deps: ReplyDeps,
  userId: string,
  text: string,
): Promise<Outcome> {
  if (!(deps.limiter ?? defaultLimiter)(userId)) return "rate-limited";

  let ctx: Ctx | undefined;
  try {
    const [settings, link] = await Promise.all([deps.repo.getSettings(), deps.repo.getLink()]);
    /* Turned off (or deleted) since the link: answer nothing, store nothing. */
    if (!settings?.enabled) return "agent-off";
    if (!link) return "window-closed";
    const opened = link.lastInboundAt ? Date.parse(link.lastInboundAt) : Number.NaN;
    ctx = {
      deps,
      userId,
      to: link.phone.replace(/\D/g, ""),
      windowOpenAt: Number.isFinite(opened) ? opened : null,
      aiConsent: link.aiConsentAt != null,
      locale: settings?.locale ?? "nl",
      usage: { calls: 0, input: 0, output: 0 },
    };
    const work = converse(ctx, text);
    work.catch(() => undefined);
    const timer = deps.timer ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as never),
    };
    let handle: unknown;
    const deadline = new Promise<never>((_, reject) => {
      handle = timer.set(() => reject(new DeadlineError()), DEADLINE_MS);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      timer.clear(handle);
    }
  } catch (error) {
    // Type only: never the message, the question or the error text.
    await deps.repo
      .appendEvent({
        id: randomUUID(),
        channel: "whatsapp",
        type: "error",
        body: { text: kindOf(error) },
      })
      .catch(() => undefined);
    if (error instanceof WindowClosedError) return "window-closed";
    if (ctx) {
      if (error instanceof DeadlineError) ctx.abandoned = true;
      await sendRaw(ctx, WHATSAPP_COPY[ctx.locale].failed).catch(() => undefined);
    }
    return "error";
  } finally {
    if (ctx?.usage.calls)
      await (deps.recordUsage ?? recordUsage)(
        {
          userId,
          route: "instinct-reply",
          model: MISTRAL_SMALL,
          inputTokens: ctx.usage.input,
          outputTokens: ctx.usage.output,
        },
        ctx.reservation,
      );
    else if (ctx?.reservation)
      await (deps.releaseReservation ?? releaseReservation)(ctx.reservation);
  }
}

async function send(ctx: Ctx, body: string): Promise<void> {
  if (ctx.abandoned) throw new DeadlineError();
  await sendRaw(ctx, body);
}

async function sendRaw(ctx: Ctx, body: string): Promise<void> {
  const { deps } = ctx;
  const { wamid } = await deps.client.sendText(ctx.to, body, ctx.windowOpenAt, deps.now());
  // The message is out: a lost record must not turn it into a failure.
  await deps.repo
    .appendEvent({
      id: randomUUID(),
      channel: "whatsapp",
      type: "message",
      body: { text: body, meta: { direction: "out" } },
      dedupeKey: `wa-out:${wamid}`,
    })
    .catch(() => undefined);
}

const sendFixed = (ctx: Ctx, key: keyof (typeof WHATSAPP_COPY)["nl"]) =>
  send(ctx, WHATSAPP_COPY[ctx.locale][key]);

async function complete(ctx: Ctx, input: Parameters<LlmProvider["complete"]>[0]): Promise<string> {
  if (ctx.abandoned) throw new DeadlineError();
  const res = await ctx.deps.llm.complete(input);
  ctx.usage.calls += 1;
  ctx.usage.input += res.usage.input;
  ctx.usage.output += res.usage.output;
  return res.text;
}

async function converse(ctx: Ctx, text: string): Promise<Outcome> {
  const { deps, userId, locale } = ctx;
  // The question goes to the AI provider only for a user who agreed to that when linking.
  if (!ctx.aiConsent) {
    await sendFixed(ctx, "aiConsentNeeded");
    return "fallback";
  }
  const system = composePrompt("_instinct.md");
  const question = scrubPersonalValues(text.slice(0, MAX_QUESTION_CHARS));
  const today = amsterdamDay(new Date(deps.now()));

  const gate = await deps.budget("instinct-reply", userId);
  if (!gate.ok) {
    await sendFixed(ctx, "budgetRefused");
    return "fallback";
  }
  ctx.reservation = gate.reservation;

  /* Step 1: the model may only choose a tool; parseToolCall decides what is valid. */
  let call: ToolCall = { tool: "unknown" };
  try {
    call = toolCallFrom(
      await complete(ctx, {
        system,
        user: `MODE: tool\nTODAY: ${today} (${weekdayOf(today)})\nCATEGORIES: ${CATEGORIES.join(", ")}\nQUESTION: ${question}`,
        json: true,
        maxTokens: STEP_1_MAX_TOKENS,
      }),
    );
  } catch {
    call = { tool: "unknown" };
  }
  if (call.tool === "unknown") {
    await sendFixed(ctx, "help");
    return "fallback";
  }

  /* The bank is read only now, and only against the shared daily budget. */
  const sessions = await deps.fetchSessions(userId);
  if (sessions.length === 0) {
    await sendFixed(ctx, "noBank");
    return "no-data";
  }
  if (!(await deps.repo.takeFetchBudget(today, WHATSAPP_FETCH_CAP))) {
    await sendFixed(ctx, "fetchExhausted");
    return "no-data";
  }
  const bank = await deps.fetchOutcome(sessions, deps.now()).catch(() => null);
  if (!bank || bank.status !== "ok" || !bank.banks.some((b) => b.state === "ok")) {
    await sendFixed(ctx, "noBank");
    return "no-data";
  }

  const mirror = (await deps.repo.getMirror()) ?? EMPTY_MIRROR;
  const result = runTool(
    call,
    {
      today,
      txs: bank.txs,
      accounts: bank.accounts,
      rules: mirror.rules,
      mirror,
      balances: bank.balances,
      rates: [],
      answers: {},
      state: { sentKeys: [], lastTipDate: null },
    },
    locale,
  );
  // From here on only `result` is used; the transactions are not referenced again.
  if (result.facts.length === 0) {
    await sendFixed(ctx, "failed");
    return "fallback";
  }

  /* Step 2: selection. The model picks which fact sentences answer the question; the
   * server composes the message from them. No model text is ever sent. */
  const more = (n: number) => moreFacts(locale, n);
  let selection: number[] | null = null;
  // Facts that embed bank text (a counterparty) never reach the model: skip step 2 and
  // send them all. No selection means all facts; the outcome is still "answered".
  let fromBankText = false;
  if (result.containsBankText) fromBankText = true;
  else if (result.facts.length > 1) {
    try {
      selection = parseSelection(
        await complete(ctx, {
          system,
          user: `MODE: answer\nLANGUAGE: ${locale}\nQUESTION: ${question}\nFACTS:\n${result.facts.map((f, n) => `${n}: ${f}`).join("\n")}`,
          json: true,
          maxTokens: STEP_2_MAX_TOKENS,
        }),
        result.facts.length,
      );
    } catch {
      selection = null;
    }
  } else selection = [0];
  let message = composeAnswer(result.facts, selection, more);
  // Invariant: true by construction. A later edit that adds free text fails here.
  if (!guardAnswer(message, [result], more).ok) {
    message = composeAnswer(result.facts, null, more);
    selection = null;
    fromBankText = false;
  }
  await send(ctx, message);
  return selection || fromBankText ? "answered" : "fallback";
}

/** Production wiring for one linked user's text message. Never throws. */
export async function answerLinkedText(
  db: Database,
  userId: string,
  inbound: Inbound,
): Promise<void> {
  if (inbound.kind !== "text") return;
  try {
    const client = whatsappClientFromEnv();
    const apiKey = process.env.MISTRAL_API_KEY?.trim();
    if (!client || !apiKey) return;
    const flow = createEbFlowRepository(db);
    await answerInbound(
      {
        repo: createAgentRepository(db, userId),
        fetchSessions: (id) => flow.listSessions(id, SESSION_TTL_MS),
        fetchOutcome: fetchForAgent,
        llm: createMistralProvider(apiKey, MISTRAL_SMALL),
        budget: checkBudget,
        client,
        now: () => Date.now(),
      },
      userId,
      inbound.text,
    );
  } catch (error) {
    console.log(JSON.stringify({ event: "whatsapp.reply_failed", kind: kindOf(error) }));
  }
}
