import type { CatalogValue } from "@lavega/core";
import { describe, expect, it, vi } from "vitest";
import {
  cacheKey,
  cachedCall,
  confirmAccepted,
  openAnswerAccepted,
  effectiveMaxAge,
  lookup,
  mayReuse,
  mergeHeld,
  modelHealth,
  parseCache,
  prune,
  store,
  touch,
  type ModelReply,
  type ReplyCache,
} from "./replyCache.js";
import type { ConfirmOutcome } from "./catalogConfirm.js";

const tool = {
  name: "report",
  description: "Report the figure.",
  input_schema: { type: "object", properties: { a: { type: "number" }, b: { type: "string" } } },
};
const request = { temperature: 0, top_p: 1, max_tokens: 32_000, tool_choice: "auto" };
const parts = {
  model: "mistral-large-latest",
  system: "system text",
  user: "Product: X\n<<<\ndocument\n>>>",
  tool,
  request,
};
const empty: ReplyCache = { version: 1, entries: {} };
const toolReply = { kind: "tool", input: { fxFeePct: 1.2 } } as const;
const declined = { kind: "declined", text: "not stated" } as const;
// Hex keys: the first byte decides the staggered max age (00 -> 28, 01 -> 21, 02 -> 14, 03 -> 7).
const K0 = "00".padEnd(64, "a");
const K1 = "01".padEnd(64, "a");
const K3 = "03".padEnd(64, "a");

describe("cacheKey", () => {
  it("same parts give the same key", () => {
    expect(cacheKey(parts)).toBe(cacheKey({ ...parts }));
    expect(cacheKey(parts)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a one-character change in the document gives a new key", () => {
    expect(cacheKey({ ...parts, user: parts.user.replace("document", "documenT") })).not.toBe(
      cacheKey(parts),
    );
  });

  it("a different model gives a new key", () => {
    expect(cacheKey({ ...parts, model: "mistral-medium-latest" })).not.toBe(cacheKey(parts));
  });

  it("key ignores object key order in the tool schema", () => {
    const reordered = {
      ...tool,
      input_schema: {
        properties: { b: { type: "string" }, a: { type: "number" } },
        type: "object",
      },
    };
    expect(cacheKey({ ...parts, tool: reordered })).toBe(cacheKey(parts));
  });

  it("a changed tool description gives a new key", () => {
    expect(cacheKey({ ...parts, tool: { ...tool, description: "Other." } })).not.toBe(
      cacheKey(parts),
    );
  });

  it("a changed max_tokens gives a new key", () => {
    expect(cacheKey({ ...parts, request: { ...request, max_tokens: 8_000 } })).not.toBe(
      cacheKey(parts),
    );
  });
});

describe("effectiveMaxAge", () => {
  it("spreads keys over 7, 14, 21 and 28 days", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 64; i++) {
      seen.add(effectiveMaxAge(cacheKey({ ...parts, user: `u${i}` }), 28));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([7, 14, 21, 28]);
    expect([effectiveMaxAge(K0, 28), effectiveMaxAge(K1, 28), effectiveMaxAge(K3, 28)]).toEqual([
      28, 21, 7,
    ]);
  });

  it("never goes below 7 and never above the setting", () => {
    expect(effectiveMaxAge(K3, 10)).toBe(7);
    expect(effectiveMaxAge(K0, 10)).toBe(10);
    expect(effectiveMaxAge(K0, 3)).toBe(3);
  });

  it("cacheDays 0 disables reuse", () => {
    expect(effectiveMaxAge(K0, 0)).toBe(0);
  });
});

describe("lookup, store, touch, prune", () => {
  it("lookup returns a fresh entry", () => {
    const c = store(empty, K0, toolReply, "2026-11-01");
    expect(lookup(c, K0, "2026-11-22", 28)?.reply).toEqual(toolReply);
    expect(lookup(c, "missing", "2026-11-22", 28)).toBeNull();
  });

  it("lookup returns null at the staggered max age", () => {
    const c = store(empty, K1, toolReply, "2026-10-01");
    expect(lookup(c, K1, "2026-10-21", 28)).not.toBeNull();
    expect(lookup(c, K1, "2026-10-22", 28)).toBeNull();
    const c3 = store(empty, K3, toolReply, "2026-10-01");
    expect(lookup(c3, K3, "2026-10-07", 28)).not.toBeNull();
    expect(lookup(c3, K3, "2026-10-08", 28)).toBeNull();
  });

  it("max age 0 disables reuse", () => {
    const c = store(empty, K0, toolReply, "2026-11-22");
    expect(lookup(c, K0, "2026-11-22", 0)).toBeNull();
  });

  it("store then lookup round-trips a tool reply and a declined reply", () => {
    let c = store(empty, K0, toolReply, "2026-11-20");
    c = store(c, K1, declined, "2026-11-20", "mistral-medium-latest");
    expect(lookup(c, K0, "2026-11-22", 28)).toEqual({
      key: K0,
      at: "2026-11-20",
      lastUsed: "2026-11-20",
      reply: toolReply,
    });
    expect(lookup(c, K1, "2026-11-22", 28)?.model).toBe("mistral-medium-latest");
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });

  it("touch updates lastUsed only", () => {
    const c = store(empty, K0, toolReply, "2026-11-01");
    const t = touch(c, K0, "2026-11-22");
    expect(t.entries[K0]).toEqual({
      key: K0,
      at: "2026-11-01",
      lastUsed: "2026-11-22",
      reply: toolReply,
    });
    expect(c.entries[K0]!.lastUsed).toBe("2026-11-01");
    expect(touch(c, "nope", "2026-11-22")).toEqual(c);
  });

  it("prune drops entries unused for longer than the limit and keeps the rest", () => {
    let c = store(empty, "old", toolReply, "2026-01-01");
    c = store(c, "new", toolReply, "2026-11-01");
    c = touch(c, "old", "2026-10-10");
    expect(Object.keys(prune(c, "2026-11-22", 42).entries)).toEqual(["new"]);
    expect(Object.keys(prune(c, "2026-11-22", 43).entries).sort()).toEqual(["new", "old"]);
  });
});

describe("parseCache", () => {
  it("a malformed cache file parses to empty", () => {
    for (const raw of [
      null,
      undefined,
      3,
      "x",
      [],
      {},
      { version: 2, entries: {} },
      { version: 1 },
    ]) {
      expect(parseCache(raw)).toEqual(empty);
    }
  });

  it("a malformed entry is dropped, the rest kept, and the model name survives", () => {
    const good = store(empty, "good", toolReply, "2026-11-01", "mistral-medium-latest");
    const raw = {
      version: 1,
      entries: {
        ...good.entries,
        noReply: { key: "noReply", at: "2026-11-01", lastUsed: "2026-11-01" },
        badDate: { key: "badDate", at: "yesterday", lastUsed: "2026-11-01", reply: toolReply },
        badKind: { key: "badKind", at: "2026-11-01", lastUsed: "2026-11-01", reply: { kind: "x" } },
        wrongKey: { key: "other", at: "2026-11-01", lastUsed: "2026-11-01", reply: toolReply },
        notObject: 5,
      },
    };
    expect(parseCache(raw)).toEqual(good);
  });
});

describe("mayReuse", () => {
  const pending = new Set(["ing-betaalpas.fxFeePct"]);
  const held = new Set(["knab-betaalpas.fxFeePct"]);

  it("a product with a pending figure is not reused", () => {
    expect(mayReuse("ing-betaalpas", pending, held)).toBe(false);
  });

  it("a product held last run is not reused", () => {
    expect(mayReuse("knab-betaalpas", pending, held)).toBe(false);
  });

  it("any other product is reused", () => {
    expect(mayReuse("sns-internet-sparen", pending, held)).toBe(true);
    expect(mayReuse("ing-betaalpas-plus", pending, held)).toBe(true);
  });
});

describe("mergeHeld", () => {
  const verdict = (id: string, field: string, kind: string) => ({ id, field, verdict: { kind } });

  it("keeps only hold verdicts, whatever the hold reason", () => {
    const held = mergeHeld([], new Set(["a", "b", "c"]), [
      verdict("a", "fxFeePct", "hold"),
      verdict("b", "interestPct", "hold"),
      verdict("c", "fxFeePct", "publish"),
      verdict("c", "interestPct", "pending"),
    ]);
    expect(held).toEqual(["a.fxFeePct", "b.interestPct"]);
  });

  it("a subset run replaces its own products and keeps the others", () => {
    const held = mergeHeld(["a.fxFeePct", "b.interestPct"], new Set(["a"]), [
      verdict("a", "fxFeePct", "publish"),
    ]);
    expect(held).toEqual(["b.interestPct"]);
    expect(
      mergeHeld(["a.fxFeePct", "b.interestPct"], new Set(["a"]), [
        verdict("a", "fxFeePct", "hold"),
      ]),
    ).toEqual(["b.interestPct", "a.fxFeePct"]);
  });

  it("an absent previous list is an empty one", () => {
    expect(mergeHeld(undefined, new Set(["a"]), [verdict("a", "fxFeePct", "hold")])).toEqual([
      "a.fxFeePct",
    ]);
  });

  it("an id that contains the swept id as a prefix is another product", () => {
    expect(mergeHeld(["ing.fxFeePct"], new Set(["ing-x"]), [])).toEqual(["ing.fxFeePct"]);
  });
});

describe("modelHealth", () => {
  it("three attempts and no answer refuses", () => {
    const h = modelHealth({ enabled: true, attempts: 3, answers: 0, reused: 5 });
    expect(h.kind).toBe("refuse");
  });

  it("two attempts and no answer warns", () => {
    const h = modelHealth({ enabled: true, attempts: 2, answers: 0, reused: 5 });
    expect(h.kind).toBe("warn");
  });

  it("attempts with at least one answer pass", () => {
    expect(modelHealth({ enabled: true, attempts: 9, answers: 1, reused: 0 }).kind).toBe("ok");
  });

  it("no attempts and only reuse pass", () => {
    expect(modelHealth({ enabled: true, attempts: 0, answers: 0, reused: 40 }).kind).toBe("ok");
  });

  it("no attempts and no reuse refuses, as before", () => {
    expect(modelHealth({ enabled: true, attempts: 0, answers: 0, reused: 0 }).kind).toBe("refuse");
  });

  it("a model rung that is off is never judged", () => {
    expect(modelHealth({ enabled: false, attempts: 5, answers: 0, reused: 0 }).kind).toBe("ok");
  });
});

describe("cachedCall", () => {
  const usage = { inputTokens: 10, outputTokens: 2 };
  const fresh: ModelReply = { kind: "tool", input: { v: 1 }, usage };
  const timeout = new Error("timeout");
  const base = {
    key: K0,
    productId: "sns" as string | undefined,
    pendingKeys: new Set<string>(),
    heldKeys: new Set<string>(),
    today: "2026-11-22",
    maxAgeDays: 28,
    primaryModel: "large",
    fallbackModel: null as string | null,
    isFallbackWorthy: (e: unknown) => e === timeout,
  };
  const mk = (cache: ReplyCache = empty) => {
    let c = cache;
    return { get: () => c, set: (n: ReplyCache) => (c = n) };
  };

  it("a fresh reply is not stored until accept is called", async () => {
    const st = mk();
    const out = await cachedCall({ ...base, store: st, call: async () => fresh });
    expect(out.outcome).toBe("fresh");
    expect(st.get().entries).toEqual({});
    out.accept();
    expect(st.get().entries[K0]!.reply).toEqual({ kind: "tool", input: { v: 1 } });
  });

  it("accept stores the reply and a second identical call is reused", async () => {
    const st = mk();
    const call = vi.fn(async () => fresh);
    const a = await cachedCall({ ...base, store: st, call });
    a.accept();
    const b = await cachedCall({ ...base, store: st, call });
    expect(b.outcome).toBe("reused");
    expect(b.res).toMatchObject({ kind: "tool", input: { v: 1 } });
    expect(b.res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("a reply that was never accepted is asked again", async () => {
    const st = mk();
    const call = vi.fn(async () => fresh);
    await cachedCall({ ...base, store: st, call });
    const b = await cachedCall({ ...base, store: st, call });
    expect(b.outcome).toBe("fresh");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("accept is idempotent", async () => {
    const st = mk();
    const out = await cachedCall({ ...base, store: st, call: async () => fresh });
    out.accept();
    const first = st.get();
    out.accept();
    expect(st.get()).toBe(first);
    expect(Object.keys(st.get().entries)).toEqual([K0]);
  });

  it("a reused reply's accept does not rewrite the produced date", async () => {
    const st = mk(store(empty, K0, toolReply, "2026-11-10", "medium"));
    const out = await cachedCall({ ...base, store: st, call: async () => fresh });
    expect(out.outcome).toBe("reused");
    out.accept();
    const e = st.get().entries[K0]!;
    expect(e.at).toBe("2026-11-10");
    expect(e.model).toBe("medium");
    expect(e.reply).toEqual({ kind: "tool", input: { fxFeePct: 1.2 } });
  });

  it("a thrown call has nothing to accept and stores nothing", async () => {
    const st = mk();
    const boom = new Error("boom");
    await expect(
      cachedCall({ ...base, store: st, call: async () => Promise.reject(boom) }),
    ).rejects.toBe(boom);
    expect(st.get().entries).toEqual({});
  });

  it("a pending product calls fresh; its reply is stored only on accept", async () => {
    const st = mk(store(empty, K0, toolReply, "2026-11-22"));
    const call = vi.fn(async () => fresh);
    const out = await cachedCall({
      ...base,
      store: st,
      call,
      pendingKeys: new Set(["sns.interestPct"]),
    });
    expect(out.outcome).toBe("fresh");
    expect(call).toHaveBeenCalledTimes(1);
    expect(st.get().entries[K0]!.reply).toEqual({ kind: "tool", input: { fxFeePct: 1.2 } });
    out.accept();
    expect(st.get().entries[K0]!.reply).toEqual({ kind: "tool", input: { v: 1 } });
  });

  it("a held product calls fresh", async () => {
    const st = mk(store(empty, K0, toolReply, "2026-11-22"));
    const call = vi.fn(async () => fresh);
    await cachedCall({ ...base, store: st, call, heldKeys: new Set(["sns.interestPct"]) });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("no product id means no reuse", async () => {
    const st = mk(store(empty, K0, toolReply, "2026-11-22"));
    const call = vi.fn(async () => fresh);
    await cachedCall({ ...base, store: st, call, productId: undefined });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("max age 0 never reuses", async () => {
    const st = mk(store(empty, K0, toolReply, "2026-11-22"));
    const call = vi.fn(async () => fresh);
    await cachedCall({ ...base, store: st, call, maxAgeDays: 0 });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("a null key (cache off) calls and accept stores nothing", async () => {
    const st = mk();
    const out = await cachedCall({ ...base, store: st, call: async () => fresh, key: null });
    expect(out.outcome).toBe("fresh");
    out.accept();
    expect(st.get().entries).toEqual({});
  });

  it("a declined reply is stored cut to 300 characters; an empty one is not stored", async () => {
    const st = mk();
    const a = await cachedCall({
      ...base,
      store: st,
      call: async () => ({ kind: "declined", text: "x".repeat(500), usage }),
    });
    a.accept();
    const r = st.get().entries[K0]!.reply;
    expect(r.kind === "declined" && r.text.length).toBe(300);
    const st2 = mk();
    const b = await cachedCall({
      ...base,
      store: st2,
      call: async () => ({ kind: "declined", text: "  ", usage }),
    });
    b.accept();
    expect(st2.get().entries).toEqual({});
  });

  it("two calls in flight keep both accepted replies", async () => {
    const st = mk();
    const slow = (v: number): Promise<ModelReply> =>
      new Promise((r) => setTimeout(() => r({ kind: "tool", input: { v }, usage }), v));
    const outs = await Promise.all([
      cachedCall({ ...base, store: st, key: K0, call: () => slow(5) }),
      cachedCall({ ...base, store: st, key: K1, call: () => slow(1) }),
    ]);
    for (const o of outs) o.accept();
    expect(Object.keys(st.get().entries).sort()).toEqual([K0, K1]);
  });

  it("a primary timeout triggers one fallback call", async () => {
    const st = mk();
    const call = vi.fn(async (model: string) => {
      if (model === "large") throw timeout;
      return fresh;
    });
    const out = await cachedCall({ ...base, store: st, call, fallbackModel: "medium" });
    expect(call.mock.calls.map((c) => c[0])).toEqual(["large", "medium"]);
    expect(out.fallbackUsed).toBe(true);
    expect(out.res).toBe(fresh);
  });

  it("a fallback reply is stored under the primary key only on accept", async () => {
    const st = mk();
    const out = await cachedCall({
      ...base,
      store: st,
      fallbackModel: "medium",
      call: async (m) => {
        if (m === "large") throw timeout;
        return fresh;
      },
    });
    expect(st.get().entries).toEqual({});
    out.accept();
    expect(st.get().entries[K0]!.model).toBe("medium");
    const again = await cachedCall({
      ...base,
      store: st,
      call: async () => Promise.reject(timeout),
    });
    expect(again.outcome).toBe("reused");
  });

  it("a failed fallback rethrows the primary error", async () => {
    const st = mk();
    await expect(
      cachedCall({
        ...base,
        store: st,
        fallbackModel: "medium",
        call: async (m) => {
          throw m === "large" ? timeout : new Error("fallback broke");
        },
      }),
    ).rejects.toBe(timeout);
    expect(st.get().entries).toEqual({});
  });

  it("no fallback when disabled", async () => {
    const call = vi.fn(async () => Promise.reject(timeout));
    await expect(cachedCall({ ...base, store: mk(), call })).rejects.toBe(timeout);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("a non-timeout error does not trigger the fallback", async () => {
    const other = new Error("mistral 500");
    const call = vi.fn(async () => Promise.reject(other));
    await expect(cachedCall({ ...base, store: mk(), call, fallbackModel: "medium" })).rejects.toBe(
      other,
    );
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("which answers settle something", () => {
  const value = (over: Partial<CatalogValue> = {}): CatalogValue => ({
    value: 1.25,
    route: "agent",
    sourceUrl: "https://x.nl/t",
    checkedAt: "2026-11-22",
    conditions: null,
    conditionsKnown: true,
    ...over,
  });
  const stated = {
    kind: "reply",
    reply: { status: "still_stated", quote: "rente 1,15%" },
  } as ConfirmOutcome;
  const notOnPage = { kind: "reply", reply: { status: "not_on_page" } } as ConfirmOutcome;
  const changed = {
    kind: "reply",
    reply: { status: "changed", newValue: 1.25, quote: "rente 1,25%" },
  } as ConfirmOutcome;

  it("a covered figure is accepted", () => {
    expect(openAnswerAccepted(value())).toBe(true);
  });
  it("an uncovered figure is not", () => {
    expect(openAnswerAccepted(value({ conditionsKnown: false }))).toBe(false);
  });
  it("a text decline is not", () => {
    expect(openAnswerAccepted(null)).toBe(false);
  });
  it("still_stated with an accepted quote is accepted", () => {
    expect(confirmAccepted(stated, null)).toBe(true);
  });
  it("not_on_page in the confirm step is not", () => {
    expect(confirmAccepted(notOnPage, null)).toBe(false);
  });
  it("changed and rejected replies in the confirm step are not", () => {
    expect(confirmAccepted(changed, null)).toBe(false);
    expect(confirmAccepted({ kind: "rejected", raw: {} }, null)).toBe(false);
    expect(confirmAccepted({ kind: "failed" }, null)).toBe(false);
  });
  it("cross-check gone and still-stated are accepted, unresolved is not", () => {
    const cross = { foundValue: 1.25, onStoredDocument: true };
    expect(confirmAccepted(stated, cross)).toBe(true);
    expect(confirmAccepted(notOnPage, cross)).toBe(true);
    expect(confirmAccepted(changed, cross)).toBe(true);
    expect(confirmAccepted({ kind: "rejected", raw: null }, cross)).toBe(false);
    expect(confirmAccepted(notOnPage, { foundValue: 1.25, onStoredDocument: false })).toBe(false);
  });
});
