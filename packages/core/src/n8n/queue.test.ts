import { expect, test } from "vitest";
import { addToQueue, MAX_QUEUE, MAX_SEEN } from "./queue.js";

const NOW = "2026-08-17T08:00:00.000Z";

function invoice(messageId: string) {
  return { messageId, amountCents: 1000 };
}
function notice(messageId: string) {
  return { messageId, kind: "notification" as const };
}

test("facturen en meldingen komen in twee aparte rijen", () => {
  const store: Record<string, unknown> = {};
  const result = addToQueue(store, { invoices: [invoice("a")], notices: [notice("b")], processedIds: ["a", "b"] }, NOW);
  expect(result).toEqual({
    addedInvoices: 1,
    addedNotices: 1,
    inQueue: 1,
    noticesInQueue: 1,
    remembered: 2,
  });
  expect((store.queue as { queuedAt: string }[])[0].queuedAt).toBe(NOW);
});

test("dezelfde mail komt er niet twee keer in", () => {
  const store: Record<string, unknown> = {};
  addToQueue(store, { invoices: [invoice("a")], notices: [], processedIds: ["a"] }, NOW);
  const second = addToQueue(store, { invoices: [invoice("a")], notices: [], processedIds: ["a"] }, NOW);
  expect(second.addedInvoices).toBe(0);
  expect(second.inQueue).toBe(1);
});

test("een regel zonder messageId komt er niet in: daar is niet op te ontdubbelen", () => {
  const store: Record<string, unknown> = {};
  const result = addToQueue(store, { invoices: [{ messageId: "" }], notices: [{}], processedIds: [] }, NOW);
  expect(result.addedInvoices).toBe(0);
  expect(result.addedNotices).toBe(0);
});

test("seenIds onthoudt wat het model beoordeeld heeft — daar draait het uursgewijs opnieuw sturen op stuk", () => {
  const store: Record<string, unknown> = {};
  addToQueue(store, { invoices: [], notices: [], processedIds: ["m1", "m2"] }, NOW);
  addToQueue(store, { invoices: [], notices: [], processedIds: ["m2", "m3"] }, NOW);
  expect(store.seenIds).toEqual(["m1", "m2", "m3"]);
});

test("de rij loopt niet vol: de oudste vallen eruit", () => {
  const store: Record<string, unknown> = {};
  const many = Array.from({ length: MAX_QUEUE + 10 }, (_, i) => invoice("m" + i));
  const result = addToQueue(store, { invoices: many, notices: [], processedIds: [] }, NOW);
  expect(result.inQueue).toBe(MAX_QUEUE);
  expect((store.queue as { messageId: string }[])[0].messageId).toBe("m10");
});

test("het geheugen van beoordeelde berichten loopt ook niet vol", () => {
  const store: Record<string, unknown> = { seenIds: Array.from({ length: MAX_SEEN }, (_, i) => "old" + i) };
  const result = addToQueue(store, { invoices: [], notices: [], processedIds: ["nieuw"] }, NOW);
  expect(result.remembered).toBe(MAX_SEEN);
  expect((store.seenIds as string[]).at(-1)).toBe("nieuw");
  expect((store.seenIds as string[])[0]).toBe("old1");
});

test("een lege run laat de rij met rust", () => {
  const store: Record<string, unknown> = {};
  addToQueue(store, { invoices: [invoice("a")], notices: [], processedIds: ["a"] }, NOW);
  const result = addToQueue(store, { invoices: [], notices: [], processedIds: [] }, NOW);
  expect(result.inQueue).toBe(1);
  expect(result.addedInvoices).toBe(0);
});
