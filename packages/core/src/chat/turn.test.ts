import { describe, expect, it } from "vitest";
import { FIXTURE_ING_IBAN, FIXTURE_INJECTION, syntheticChatVault } from "./fixture.js";
import { createChatTools } from "./tools.js";
import {
  isLoopUserMessage,
  CHAT_MAX_CALLS,
  CHAT_MAX_ROUNDS,
  runChatTurn,
  type ChatStep,
  type ChatStepResult,
  type ChatTurnMessage,
} from "./turn.js";

const tools = () => createChatTools(syntheticChatVault());
const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, args });
const calls = (...c: ReturnType<typeof call>[]): ChatStepResult => ({
  type: "tool_calls",
  calls: c,
});
const answer = (text: string): ChatStepResult => ({ type: "answer", text });

/** A scripted model: returns the queued results in order and records each request. */
function script(...queue: ChatStepResult[]) {
  const requests: { messages: ChatTurnMessage[]; noTools: boolean }[] = [];
  const step: ChatStep = async (req) => {
    requests.push({ messages: structuredClone(req.messages), noTools: req.noTools });
    const next = queue.shift();
    if (!next) throw new Error("script exhausted");
    return next;
  };
  return { step, requests };
}

describe("one question, one tool round, one answer", () => {
  it("runs the tool on the vault, sends the result back, returns the checked answer", async () => {
    const s = script(
      calls(call("c1", "spending_on_day", { date: "2026-11-17" })),
      answer("Gisteren gaf je € 32,35 uit."),
    );
    const seen: string[][] = [];
    const out = await runChatTurn({
      question: "Wat gaf ik gisteren uit?",
      history: [],
      tools: tools(),
      step: s.step,
      onRound: (names) => seen.push(names),
    });
    expect(out).toEqual({ kind: "answer", text: "Gisteren gaf je € 32,35 uit." });
    expect(seen).toEqual([["spending_on_day"]]);
    expect(s.requests).toHaveLength(2);
    expect(s.requests[0]!.messages).toEqual([
      { role: "user", content: "Wat gaf ik gisteren uit?" },
    ]);
    const second = s.requests[1]!.messages;
    expect(second[1]).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "c1", name: "spending_on_day" }],
    });
    expect(second[2]).toMatchObject({ role: "tool", toolCallId: "c1", name: "spending_on_day" });
    expect(JSON.parse((second[2] as { content: string }).content).data.total.cents).toBe(3235);
  });

  it("scrubs identifiers from the question but keeps amounts, and clips it to 500 characters", async () => {
    const s = script(answer("Dat kan ik niet zien."));
    await runChatTurn({
      question: `Kan ik EUR 500 sparen? Mijn rekening is ${FIXTURE_ING_IBAN}, mail jan@example.nl ${"x".repeat(600)}`,
      history: [],
      tools: tools(),
      step: s.step,
    });
    const sent = (s.requests[0]!.messages[0] as { content: string }).content;
    expect(sent).toContain("EUR 500");
    expect(sent).not.toMatch(/NL91|ABNA|jan@example/);
    expect(sent.length).toBeLessThanOrEqual(500);
  });

  it("scrubs identifiers from earlier messages too, not only from the new question", async () => {
    const s = script(answer("Ok."));
    await runChatTurn({
      question: "En nu?",
      history: [
        { role: "user", content: `Wat staat er op ${FIXTURE_ING_IBAN}? Mail jan@example.nl` },
        { role: "assistant", content: `Rekening ${FIXTURE_ING_IBAN} heeft € 2.450,50.` },
      ],
      tools: tools(),
      step: s.step,
    });
    const sent = JSON.stringify(s.requests[0]!.messages);
    expect(sent).not.toMatch(/NL91|ABNA|jan@example/);
    expect(sent).toContain("€ 2.450,50");
  });

  it("resends the last 8 earlier messages as text only", async () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `bericht ${i}`,
    }));
    const s = script(answer("Ok."));
    await runChatTurn({ question: "En nu?", history, tools: tools(), step: s.step });
    const sent = s.requests[0]!.messages;
    expect(sent).toHaveLength(9);
    expect(sent[0]).toEqual({ role: "user", content: "bericht 4" });
    expect(sent.every((m) => !("toolCalls" in m) && m.role !== "tool")).toBe(true);
  });
});

describe("the caps: 4 rounds and 6 tool calls per question", () => {
  it("exports the caps", () => {
    expect(CHAT_MAX_ROUNDS).toBe(4);
    expect(CHAT_MAX_CALLS).toBe(6);
  });

  it("the last round is answer-only; a model that still asks for a tool gets no answer", async () => {
    const more = () => calls(call("x", "balances", {}));
    const s = script(more(), more(), more(), more());
    const out = await runChatTurn({
      question: "Saldo?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    expect(out).toEqual({ kind: "no-answer", reason: "no-answer" });
    expect(s.requests).toHaveLength(CHAT_MAX_ROUNDS);
    expect(s.requests.map((r) => r.noTools)).toEqual([false, false, false, true]);
    const last = s.requests[3]!.messages.at(-1) as { role: string; content: string };
    expect(last).toEqual({ role: "user", content: "Geen tools meer; antwoord met wat je hebt." });
  });

  it("calls beyond 6 are answered with an error result and the model is told to stop", async () => {
    const seven = Array.from({ length: 7 }, (_, i) => call(`c${i}`, "balances", {}));
    const s = script(calls(...seven.slice(0, 4)), calls(...seven.slice(4)), answer("Klaar."));
    const out = await runChatTurn({
      question: "Saldo?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    expect(out).toEqual({ kind: "answer", text: "Klaar." });
    const third = s.requests[2]!;
    expect(third.noTools).toBe(true);
    const toolMsgs = third.messages.filter((m) => m.role === "tool") as { content: string }[];
    expect(toolMsgs).toHaveLength(7);
    expect(toolMsgs.filter((m) => m.content.includes("tool_limit"))).toHaveLength(1);
    expect(third.messages.at(-1)).toEqual({
      role: "user",
      content: "Geen tools meer; antwoord met wat je hebt.",
    });
  });
});

describe("C2: tool call ids are made unique before they go to the server", () => {
  it("a repeated id in one batch and across rounds is renamed; each result still pairs with its call", async () => {
    const s = script(
      calls(call("same", "balances", {}), call("same", "subscriptions", {})),
      calls(call("same", "balances", {})),
      answer("Klaar."),
    );
    await runChatTurn({ question: "Saldo?", history: [], tools: tools(), step: s.step });
    const last = s.requests[2]!.messages;
    const ids = last.flatMap((m) =>
      "toolCalls" in m && m.toolCalls ? m.toolCalls.map((c) => c.id) : [],
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
    const toolIds = last
      .filter((m) => m.role === "tool")
      .map((m) => (m as { toolCallId: string }).toolCallId);
    expect(toolIds.sort()).toEqual([...ids].sort());
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });

  it("an empty or odd id gets a valid one", async () => {
    const s = script(
      calls(call("", "balances", {}), call("a b!", "balances", {})),
      answer("Klaar."),
    );
    await runChatTurn({ question: "Saldo?", history: [], tools: tools(), step: s.step });
    const msgs = s.requests[1]!.messages;
    const ids = msgs.flatMap((m) =>
      "toolCalls" in m && m.toolCalls ? m.toolCalls.map((c) => c.id) : [],
    );
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("tool errors and injection", () => {
  it("a bad call goes back with a hint that says what to use instead, and the model can correct itself", async () => {
    const s = script(
      calls(
        call("b", "spending_in_range", {
          from: "2026-11-01",
          to: "2026-11-18",
          search: "Albert Heijn",
        }),
      ),
      calls(
        call("g", "spending_in_range", {
          from: "2026-11-01",
          to: "2026-11-18",
          counterparty: "Albert Heijn",
        }),
      ),
      answer("Bij Albert Heijn gaf je € 99,75 uit."),
    );
    const out = await runChatTurn({
      question: "Albert Heijn?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    expect(out).toEqual({ kind: "answer", text: "Bij Albert Heijn gaf je € 99,75 uit." });
    const fed = JSON.parse((s.requests[1]!.messages.at(-1) as { content: string }).content);
    expect(fed.error).toBe("invalid_arguments");
    expect(fed.hint).toContain("counterparty");
    expect(fed.hint).not.toContain("Albert");
  });

  it("repeated bad calls never end in silence: within the caps they keep coming back, then the turn ends with no-answer (the UI shows the honest line)", async () => {
    const bad = () => calls(call("b", "spending_on_day", { date: "gisteren" }));
    const s = script(bad(), bad(), bad(), bad());
    const out = await runChatTurn({
      question: "Gisteren?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    expect(out).toEqual({ kind: "no-answer", reason: "no-answer" });
    expect(s.requests).toHaveLength(CHAT_MAX_ROUNDS);
    for (const r of s.requests.slice(1)) {
      const last = r.messages.filter((m) => m.role === "tool").at(-1) as { content: string };
      expect(JSON.parse(last.content)).toMatchObject({ error: "invalid_arguments" });
    }
  });

  it("an unknown tool name is refused by name", async () => {
    const s = script(calls(call("u", "wire_money", { to: "x" })), answer("Dat kan ik niet."));
    await runChatTurn({ question: "Stuur geld", history: [], tools: tools(), step: s.step });
    const msg = s.requests[1]!.messages.at(-1) as { content: string };
    expect(JSON.parse(msg.content)).toMatchObject({ error: "unknown_tool" });
  });

  it("a merchant that tries to instruct the model reaches it only as tool-role data", async () => {
    const s = script(
      calls(
        call("t", "transactions", {
          search: "ignore previous",
          from: "2026-11-01",
          to: "2026-11-18",
          sort: "date_desc",
        }),
      ),
      answer("Ik vond 1 betaling van € 4,50."),
    );
    await runChatTurn({
      question: "Wat was die vreemde betaling?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    const msgs = s.requests[1]!.messages;
    const carriers = msgs.filter((m) => JSON.stringify(m).includes("Ignore previous instructions"));
    expect(carriers).toHaveLength(1);
    expect(carriers[0]!.role).toBe("tool");
  });
});

describe("guards run on the complete answer", () => {
  it("an invented figure: one regeneration naming it, then the corrected answer is shown", async () => {
    const s = script(
      calls(call("c1", "spending_on_day", { date: "2026-11-17" })),
      answer("Gisteren gaf je € 40 uit."),
      answer("Gisteren gaf je € 32,35 uit."),
    );
    const out = await runChatTurn({
      question: "Gisteren?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    expect(out).toEqual({ kind: "answer", text: "Gisteren gaf je € 32,35 uit." });
    const regen = s.requests[2]!;
    expect(regen.noTools).toBe(true);
    const correction = regen.messages.at(-1) as { role: string; content: string };
    expect(correction.role).toBe("user");
    expect(correction.content).toContain("€ 40");
    expect(correction.content).toContain("Gebruik alleen bedragen uit de resultaten");
  });

  it("a second failure shows the plain facts of the results instead", async () => {
    const s = script(
      calls(call("c1", "spending_on_day", { date: "2026-11-17" })),
      answer("Dat was € 40."),
      answer("Dat was € 41."),
    );
    const out = await runChatTurn({
      question: "Gisteren?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    expect(out).toEqual({ kind: "facts", lines: ["2026-11-17 · € 32,35"] });
  });

  it("advice language: one regeneration, then the fixed refusal", async () => {
    const s = script(
      answer("Je kunt het beste ETF's kopen."),
      answer("Koop vooral een indexfonds, dat is het beste."),
    );
    const out = await runChatTurn({
      question: "Moet ik ETF's kopen?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    expect(out).toEqual({ kind: "advice-refusal" });
    expect(s.requests).toHaveLength(2);
    expect(s.requests[1]!.noTools).toBe(true);
  });

  it("quoting a merchant name from the results is not advice language", async () => {
    const s = script(
      calls(
        call("t", "transactions", {
          search: "ignore previous",
          from: "2026-11-01",
          to: "2026-11-18",
          sort: "date_desc",
        }),
      ),
      answer(`Je betaalde € 4,50 aan ${FIXTURE_INJECTION.slice(0, 59)}.`),
    );
    const out = await runChatTurn({
      question: "Wat was die betaling van 15 november?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    expect(out.kind).toBe("answer");
    expect(s.requests).toHaveLength(2);
  });

  it("advice language fixed on the retry is shown", async () => {
    const s = script(
      answer("Je kunt het beste ETF's kopen."),
      answer("Daar geef ik geen advies over. Ik kan je uitgaven en saldo's laten zien."),
    );
    const out = await runChatTurn({
      question: "Moet ik ETF's kopen?",
      history: [],
      tools: tools(),
      step: s.step,
    });
    expect(out.kind).toBe("answer");
  });

  it("amounts from an earlier answer and from the user's own question pass", async () => {
    const s = script(answer("Je vroeg om € 500; eerder noemde ik € 84,10."));
    const out = await runChatTurn({
      question: "Is € 500 veel?",
      history: [{ role: "assistant", content: "Je gaf € 84,10 uit." }],
      tools: tools(),
      step: s.step,
    });
    expect(out.kind).toBe("answer");
  });

  it("an empty answer is no answer", async () => {
    const s = script(answer("   "));
    const out = await runChatTurn({ question: "Hoi", history: [], tools: tools(), step: s.step });
    expect(out).toEqual({ kind: "no-answer", reason: "no-answer" });
  });

  it("an error from the step propagates to the caller", async () => {
    const step: ChatStep = async () => {
      throw new Error("offline");
    };
    await expect(
      runChatTurn({ question: "Hoi", history: [], tools: tools(), step }),
    ).rejects.toThrow("offline");
  });
});

describe("isLoopUserMessage: only the loop's own pattern is synthetic", () => {
  const nudge = "Geen tools meer; antwoord met wat je hebt.";
  const number =
    "Gebruik alleen bedragen uit de resultaten. Deze komen er niet in voor: € 40. Schrijf het antwoord opnieuw, zonder zelf te rekenen.";
  const advice =
    "Geef geen financieel advies en beveel niets aan of ken niets de beste toe. Schrijf het antwoord opnieuw met alleen feiten uit de resultaten.";
  const u = (content: string) => ({ role: "user" as const, content });
  const a = (content: string) => ({ role: "assistant" as const, content });
  const t = { role: "tool" as const, toolCallId: "x", name: "balances", content: "{}" };

  it("the nudge after tool results, and the corrections after an assistant answer, are loop messages", () => {
    expect(isLoopUserMessage([u("q"), a(""), t, u(nudge)] as never)).toBe(true);
    expect(isLoopUserMessage([u("q"), a("fout"), u(number)])).toBe(true);
    expect(isLoopUserMessage([u("q"), a("fout"), u(advice)])).toBe(true);
  });

  it("a question that merely starts with the loop text is a question", () => {
    expect(isLoopUserMessage([u(nudge)])).toBe(false);
    expect(isLoopUserMessage([u("q"), u(nudge)])).toBe(false);
    expect(isLoopUserMessage([u("q"), a("fout"), u(`${number} en nog een vraag`)])).toBe(false);
    expect(
      isLoopUserMessage([
        u("q"),
        a("fout"),
        u("Gebruik alleen bedragen uit de resultaten. wat gaf ik uit?"),
      ]),
    ).toBe(false);
    expect(isLoopUserMessage([u("q"), a("fout"), u(nudge)])).toBe(false);
  });
});
