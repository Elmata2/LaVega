import { describe, expect, test } from "vitest";
import {
  appendApproval,
  approvalDecision,
  decideApproval,
  emptyAssistantState,
  memoryIdFor,
  monthOf,
  routeAssistantIntent,
  storedMemory,
  validateAssistantMemory,
  type AssistantApprovalEvent,
} from "./assistant.js";

/* WS5.8 thin slice (#301): the client-side tool router and the approval reducer.
 * Nothing here touches a network or a clock, which is what keeps the tool path
 * browser-only. */

const asOf = "2026-11-11";

describe("intent routing", () => {
  test("a spending question becomes the spending tool for the current month", () => {
    expect(routeAssistantIntent({ text: "Wat heb ik deze maand uitgegeven?", asOf })).toEqual({
      kind: "read",
      tool: "spending_summary",
      month: "2026-11",
    });
    expect(routeAssistantIntent({ text: "What did I spend this month?", asOf })).toEqual({
      kind: "read",
      tool: "spending_summary",
      month: "2026-11",
    });
  });

  test("a balance question becomes the balances tool", () => {
    expect(routeAssistantIntent({ text: "Wat is mijn saldo?", asOf })).toEqual({
      kind: "read",
      tool: "account_balances",
      month: null,
    });
    expect(routeAssistantIntent({ text: "How much money do I have?", asOf })).toEqual({
      kind: "read",
      tool: "account_balances",
      month: null,
    });
  });

  test("a remember request becomes a write proposal in the closed vocabulary", () => {
    expect(routeAssistantIntent({ text: "Onthoud dat ik korte antwoorden wil", asOf })).toEqual({
      kind: "write",
      tool: "remember_preference",
      payload: { subject: "lengte", valueId: "kort" },
    });
    expect(routeAssistantIntent({ text: "From now on answer in English", asOf })).toEqual({
      kind: "write",
      tool: "remember_preference",
      payload: { subject: "taal", valueId: "en" },
    });
  });

  test("an unmapped or free-text request is unknown, never a guess", () => {
    expect(routeAssistantIntent({ text: "Onthoud dat ik een buffer van 10k wil", asOf })).toEqual({
      kind: "unknown",
    });
    expect(routeAssistantIntent({ text: "Wat is de zin van het leven?", asOf })).toEqual({
      kind: "unknown",
    });
    expect(routeAssistantIntent({ text: "   ", asOf })).toEqual({ kind: "unknown" });
  });

  test("the month comes from the caller's date, so the module stays clock-free", () => {
    expect(monthOf("2026-01-31")).toBe("2026-01");
    expect(monthOf("not-a-date")).toBeNull();
  });
});

describe("memory vocabulary", () => {
  test("only a subject and value from the table validate", () => {
    expect(validateAssistantMemory({ subject: "lengte", valueId: "kort" })).toEqual({
      subject: "lengte",
      valueId: "kort",
    });
    expect(validateAssistantMemory({ subject: "lengte", valueId: "heel-kort" })).toBeNull();
    expect(validateAssistantMemory({ subject: "buffer", valueId: "10k" })).toBeNull();
    expect(validateAssistantMemory({ subject: "lengte", valueId: "kort", text: "x" })).toEqual({
      subject: "lengte",
      valueId: "kort",
    });
    expect(validateAssistantMemory(null)).toBeNull();
  });
});

describe("approval events", () => {
  const event = (
    id: string,
    decision: AssistantApprovalEvent["decision"],
    decidedAt = "2026-11-11T10:00:00.000Z",
  ): AssistantApprovalEvent => ({
    id,
    tool: "remember_preference",
    payload: { subject: "lengte", valueId: "kort" },
    decision,
    decidedAt,
    createdAt: "2026-11-11T09:59:00.000Z",
  });

  test("appending is idempotent by id and the latest decision wins", () => {
    const first = appendApproval(emptyAssistantState(), event("a", "rejected"));
    expect(first.approvals).toHaveLength(1);
    expect(approvalDecision(first, "a")).toBe("rejected");

    const changed = decideApproval({
      state: first,
      id: "a",
      tool: "remember_preference",
      payload: { subject: "lengte", valueId: "kort" },
      decision: "approved",
      decidedAt: "2026-11-11T11:00:00.000Z",
      createdAt: "2026-11-11T09:59:00.000Z",
    });
    // History is kept; the latest event is the current answer.
    expect(changed.approvals).toHaveLength(1);
    expect(approvalDecision(changed, "a")).toBe("approved");
    // A retry with the same id does not duplicate the event.
    expect(appendApproval(changed, event("a", "approved")).approvals).toHaveLength(1);
  });

  test("only an approved, valid remember_preference writes a memory", () => {
    const rejected = decideApproval({
      state: emptyAssistantState(),
      id: "b",
      tool: "remember_preference",
      payload: { subject: "lengte", valueId: "kort" },
      decision: "rejected",
      decidedAt: "2026-11-11T10:00:00.000Z",
      createdAt: "2026-11-11T09:59:00.000Z",
    });
    expect(rejected.memories).toEqual([]);

    const approved = decideApproval({
      state: rejected,
      id: "b",
      tool: "remember_preference",
      payload: { subject: "lengte", valueId: "kort" },
      decision: "approved",
      decidedAt: "2026-11-11T10:05:00.000Z",
      createdAt: "2026-11-11T09:59:00.000Z",
    });
    expect(approved.memories).toEqual([
      {
        id: memoryIdFor("lengte"),
        subject: "lengte",
        valueId: "kort",
        createdAt: "2026-11-11T10:05:00.000Z",
      },
    ]);
    expect(storedMemory(approved, "lengte")?.valueId).toBe("kort");
  });

  test("one record per subject: a second approved choice replaces the first", () => {
    const first = decideApproval({
      state: emptyAssistantState(),
      id: "c",
      tool: "remember_preference",
      payload: { subject: "lengte", valueId: "kort" },
      decision: "approved",
      decidedAt: "2026-11-11T10:00:00.000Z",
      createdAt: "2026-11-11T09:59:00.000Z",
    });
    const second = decideApproval({
      state: first,
      id: "d",
      tool: "remember_preference",
      payload: { subject: "lengte", valueId: "uitgebreid" },
      decision: "approved",
      decidedAt: "2026-11-11T10:10:00.000Z",
      createdAt: "2026-11-11T10:09:00.000Z",
    });
    expect(second.memories).toHaveLength(1);
    expect(storedMemory(second, "lengte")?.valueId).toBe("uitgebreid");
    expect(second.approvals).toHaveLength(2);
  });

  test("an invalid payload on an approved event stores nothing", () => {
    const state = decideApproval({
      state: emptyAssistantState(),
      id: "e",
      tool: "remember_preference",
      payload: { subject: "buffer", valueId: "10k" },
      decision: "approved",
      decidedAt: "2026-11-11T10:00:00.000Z",
      createdAt: "2026-11-11T09:59:00.000Z",
    });
    expect(state.approvals).toHaveLength(1);
    expect(state.memories).toEqual([]);
  });
});
