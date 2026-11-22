import { createHash } from "node:crypto";
import { isCovered, wholeDaysBetween, type CatalogValue } from "@lavega/core";
import { storedCheckOf, type ConfirmOutcome } from "./catalogConfirm.js";

/** Reuse of model replies. A reply is reused only when the whole request (model, both
 *  prompts, tool name and schema) is byte-for-byte the one it answered. Pure: `today` is an input. */

export type CachedReply = {
  key: string;
  /** YYYY-MM-DD the reply was produced. */
  at: string;
  lastUsed: string;
  /** The model that actually answered, when it was not the primary one. */
  model?: string;
  reply: { kind: "tool"; input: unknown } | { kind: "declined"; text: string };
};
export type ReplyCache = { version: 1; entries: Record<string, CachedReply> };

export const EMPTY_CACHE: ReplyCache = { version: 1, entries: {} };

/** JSON with object keys sorted, so the order a schema was written in does not matter. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** The key covers everything that shapes the request: model, both prompts, the whole tool
 *  (name, description, schema) and the constants the client sends (`request`). */
export function cacheKey(parts: {
  model: string;
  system: string;
  user: string;
  tool: { name: string; description: string; input_schema: object };
  request: object;
}): string {
  return createHash("sha256")
    .update(stable([parts.model, parts.system, parts.user, parts.tool, parts.request]))
    .digest("hex");
}

const MIN_REFRESH_DAYS = 7;

/** Entries refresh at 7, 14, 21 or 28 days (a quarter each, from the key's first byte), so one
 *  first run does not make every entry expire in the same week. 0 disables reuse. */
export function effectiveMaxAge(key: string, cacheDays: number): number {
  if (cacheDays <= 0) return 0;
  const byte = Number.parseInt(key.slice(0, 2), 16);
  const step = Number.isNaN(byte) ? 0 : byte % 4;
  return Math.min(cacheDays, Math.max(MIN_REFRESH_DAYS, cacheDays - step * 7));
}

/** A fresh entry, or null when absent or at least its staggered max age old (see effectiveMaxAge).
 *  `maxAgeDays` 0 disables reuse. */
export function lookup(
  cache: ReplyCache,
  key: string,
  today: string,
  maxAgeDays: number,
): CachedReply | null {
  if (maxAgeDays <= 0) return null;
  const hit = cache.entries[key];
  if (!hit) return null;
  const age = wholeDaysBetween(hit.at, today);
  return age === null || age >= effectiveMaxAge(key, maxAgeDays) ? null : hit;
}

export function store(
  cache: ReplyCache,
  key: string,
  reply: CachedReply["reply"],
  today: string,
  model?: string,
): ReplyCache {
  const entry: CachedReply = {
    key,
    at: today,
    lastUsed: today,
    ...(model ? { model } : {}),
    reply,
  };
  return { version: 1, entries: { ...cache.entries, [key]: entry } };
}

export function touch(cache: ReplyCache, key: string, today: string): ReplyCache {
  const hit = cache.entries[key];
  if (!hit) return cache;
  return { version: 1, entries: { ...cache.entries, [key]: { ...hit, lastUsed: today } } };
}

export function prune(cache: ReplyCache, today: string, unusedDays: number): ReplyCache {
  const entries: Record<string, CachedReply> = {};
  for (const [k, e] of Object.entries(cache.entries)) {
    const idle = wholeDaysBetween(e.lastUsed, today);
    if (idle !== null && idle <= unusedDays) entries[k] = e;
  }
  return { version: 1, entries };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseEntry(key: string, raw: unknown): CachedReply | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (e.key !== key) return null;
  if (typeof e.at !== "string" || !DAY.test(e.at)) return null;
  if (typeof e.lastUsed !== "string" || !DAY.test(e.lastUsed)) return null;
  const model = typeof e.model === "string" && e.model ? { model: e.model } : {};
  const r = e.reply as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") return null;
  if (r.kind === "tool" && "input" in r) {
    return {
      key,
      at: e.at,
      lastUsed: e.lastUsed,
      ...model,
      reply: { kind: "tool", input: r.input },
    };
  }
  if (r.kind === "declined" && typeof r.text === "string") {
    return {
      key,
      at: e.at,
      lastUsed: e.lastUsed,
      ...model,
      reply: { kind: "declined", text: r.text },
    };
  }
  return null;
}

/** Tolerant: anything malformed gives an empty cache, a malformed entry is dropped. Never throws. */
export function parseCache(raw: unknown): ReplyCache {
  if (!raw || typeof raw !== "object") return { version: 1, entries: {} };
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !o.entries || typeof o.entries !== "object" || Array.isArray(o.entries)) {
    return { version: 1, entries: {} };
  }
  const entries: Record<string, CachedReply> = {};
  for (const [k, v] of Object.entries(o.entries)) {
    const e = parseEntry(k, v);
    if (e) entries[k] = e;
  }
  return { version: 1, entries };
}

/** Whether a product's model replies may be reused. A figure waiting for a second read must get an
 *  independent read, and a figure that was held last run must be read afresh: a reused reply is
 *  neither. Keys are "productId.field". */
export function mayReuse(
  productId: string,
  pendingKeys: ReadonlySet<string>,
  heldKeys: ReadonlySet<string>,
): boolean {
  const prefix = `${productId}.`;
  for (const k of pendingKeys) if (k.startsWith(prefix)) return false;
  for (const k of heldKeys) if (k.startsWith(prefix)) return false;
  return true;
}

/** The held figures to persist: this write's products replace their own keys, the others stay. */
export function mergeHeld(
  previous: readonly string[] | undefined,
  sweptIds: ReadonlySet<string>,
  verdicts: readonly { id: string; field: string; verdict: { kind: string } }[],
): string[] {
  return [
    ...(previous ?? []).filter((k) => !sweptIds.has(k.slice(0, k.lastIndexOf(".")))),
    ...verdicts.flatMap((v) => (v.verdict.kind === "hold" ? [`${v.id}.${v.field}`] : [])),
  ];
}

/** Fresh attempts are requests sent; answers are replies that came back (a decline counts).
 *  One reused reply must not hide a model that is down for every page that changed. */
export function modelHealth(input: {
  enabled: boolean;
  attempts: number;
  answers: number;
  reused: number;
}): { kind: "ok" } | { kind: "warn" | "refuse"; text: string } {
  const { enabled, attempts, answers, reused } = input;
  if (!enabled || answers > 0) return { kind: "ok" };
  if (attempts >= 3) {
    return {
      kind: "refuse",
      text: `the model rung was enabled, ${attempts} fresh call(s) were sent and not one came back (${reused} reply(ies) were reused).`,
    };
  }
  if (attempts > 0) {
    return {
      kind: "warn",
      text: `${attempts} fresh model call(s) were sent and none came back; ${reused} reply(ies) were reused.`,
    };
  }
  if (reused === 0) {
    return {
      kind: "refuse",
      text: "the model rung was enabled and not one of its calls came back.",
    };
  }
  return { kind: "ok" };
}

export type ModelReply =
  | { kind: "tool"; input: unknown; usage: { inputTokens: number; outputTokens: number } }
  | { kind: "declined"; text: string; usage: { inputTokens: number; outputTokens: number } };
export type CallOutcome = "reused" | "fresh";

/** A reply is kept only when the caller accepted it: a number that settled something. A cached
 *  miss would cancel the weekly retry for that product. Open question: a figure that is covered. */
export function openAnswerAccepted(value: CatalogValue | null | undefined): boolean {
  return isCovered(value ?? undefined);
}

/** Confirm step: only a still_stated reply (the parser already checked its quote). Cross-check
 *  (`cross` set, a covered read differs from the stored figure): the two clean outcomes. */
export function confirmAccepted(
  outcome: ConfirmOutcome,
  cross: { foundValue: number; onStoredDocument: boolean } | null,
): boolean {
  if (cross) {
    return storedCheckOf(outcome, cross.foundValue, cross.onStoredDocument) !== "unresolved";
  }
  return outcome.kind === "reply" && outcome.reply.status === "still_stated";
}

const MAX_DECLINED_CHARS = 300;

function storable(res: ModelReply): CachedReply["reply"] | null {
  if (res.kind === "tool") return { kind: "tool", input: res.input };
  const text = res.text.trim();
  return text ? { kind: "declined", text: text.slice(0, MAX_DECLINED_CHARS) } : null;
}

/** The cache-or-call decision of one model request. `store` is read and written around the
 *  await, never a snapshot, because products run at the same time. Nothing is stored here: the
 *  caller calls `accept()` when the reply settled something (idempotent; for a reused reply it
 *  changes nothing, so the 7 to 28 day clock keeps running from the original answer). An error
 *  stores nothing. After a failure `isFallbackWorthy` accepts, ONE call goes to the fallback
 *  model, and its reply is stored under the PRIMARY key with the fallback's name. */
export async function cachedCall(d: {
  store: { get(): ReplyCache; set(c: ReplyCache): void };
  /** null: the cache is off. */
  key: string | null;
  productId: string | undefined;
  pendingKeys: ReadonlySet<string>;
  heldKeys: ReadonlySet<string>;
  today: string;
  maxAgeDays: number;
  primaryModel: string;
  fallbackModel: string | null;
  isFallbackWorthy: (e: unknown) => boolean;
  call: (model: string) => Promise<ModelReply>;
}): Promise<{ res: ModelReply; outcome: CallOutcome; fallbackUsed: boolean; accept: () => void }> {
  const { key } = d;
  if (key && d.productId !== undefined && mayReuse(d.productId, d.pendingKeys, d.heldKeys)) {
    const hit = lookup(d.store.get(), key, d.today, d.maxAgeDays);
    if (hit) {
      d.store.set(touch(d.store.get(), key, d.today));
      const usage = { inputTokens: 0, outputTokens: 0 };
      const res: ModelReply =
        hit.reply.kind === "tool"
          ? { kind: "tool", input: structuredClone(hit.reply.input), usage }
          : { kind: "declined", text: hit.reply.text, usage };
      return { res, outcome: "reused", fallbackUsed: false, accept: () => {} };
    }
  }
  let res: ModelReply;
  let answeredBy = d.primaryModel;
  let fallbackUsed = false;
  try {
    res = await d.call(d.primaryModel);
  } catch (primaryError) {
    if (!d.fallbackModel || !d.isFallbackWorthy(primaryError)) throw primaryError;
    try {
      res = await d.call(d.fallbackModel);
    } catch {
      throw primaryError;
    }
    answeredBy = d.fallbackModel;
    fallbackUsed = true;
  }
  const reply = key ? storable(res) : null;
  let accepted = false;
  const accept = () => {
    if (accepted || !key || !reply) return;
    accepted = true;
    d.store.set(store(d.store.get(), key, reply, d.today, answeredBy));
  };
  return { res, outcome: "fresh", fallbackUsed, accept };
}
