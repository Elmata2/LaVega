import { expect, test } from "vitest";
import { addToQueue, drainQueue, MAX_NOTICES, MAX_QUEUE, MAX_SEEN, OWNER_KEY } from "./queue.js";

const NOW = "2026-08-17T08:00:00.000Z";

function invoice(messageId: string, queueKey?: string) {
  return { messageId, amountCents: 1000, queueKey };
}
function notice(messageId: string, queueKey?: string) {
  return { messageId, kind: "notification" as const, queueKey };
}

test("facturen en meldingen komen in twee aparte rijen", () => {
  const store: Record<string, unknown> = {};
  const result = addToQueue(
    store,
    { invoices: [invoice("a")], notices: [notice("b")], processedIds: ["a", "b"] },
    NOW,
  );
  expect(result).toEqual({
    addedInvoices: 1,
    addedNotices: 1,
    inQueue: 1,
    noticesInQueue: 1,
    remembered: 2,
  });
  const byKey = store.queueByKey as Record<string, { queuedAt: string }[]>;
  expect(byKey[OWNER_KEY][0].queuedAt).toBe(NOW);
});

test("dezelfde mail komt er niet twee keer in", () => {
  const store: Record<string, unknown> = {};
  addToQueue(store, { invoices: [invoice("a")], notices: [], processedIds: ["a"] }, NOW);
  const second = addToQueue(
    store,
    { invoices: [invoice("a")], notices: [], processedIds: ["a"] },
    NOW,
  );
  expect(second.addedInvoices).toBe(0);
  expect(second.inQueue).toBe(1);
});

test("een regel zonder messageId komt er niet in: daar is niet op te ontdubbelen", () => {
  const store: Record<string, unknown> = {};
  const result = addToQueue(
    store,
    { invoices: [{ messageId: "" }], notices: [{}], processedIds: [] },
    NOW,
  );
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
  const byKey = store.queueByKey as Record<string, { messageId: string }[]>;
  expect(byKey[OWNER_KEY][0].messageId).toBe("m10");
});

test("het geheugen van beoordeelde berichten loopt ook niet vol", () => {
  const store: Record<string, unknown> = {
    seenIds: Array.from({ length: MAX_SEEN }, (_, i) => "old" + i),
  };
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

/* ── Partitionering: het defect dat dit bestand repareert ────────────────── */

test("ale ophalen levert alleen ale's regels, en laat bo's rij helemaal met rust", () => {
  const store: Record<string, unknown> = {};
  addToQueue(
    store,
    {
      invoices: [invoice("a1", "ale"), invoice("b1", "bo")],
      notices: [notice("a2", "ale"), notice("b2", "bo")],
      processedIds: ["a1", "b1", "a2", "b2"],
    },
    NOW,
  );

  const served = drainQueue(store, "ale", "2026-08-17T09:00:00.000Z");
  expect(served.invoices.map((r: any) => r.messageId)).toEqual(["a1"]);
  expect(served.notices.map((r: any) => r.messageId)).toEqual(["a2"]);
  expect(served.servedAt).toBe("2026-08-17T09:00:00.000Z");

  // Bo's rij bestaat nog en is ongewijzigd — geen fetch voor "ale" heeft hem
  // aangeraakt, laat staan geleegd.
  const byKey = store.queueByKey as Record<string, { messageId: string }[]>;
  const noticesByKey = store.noticesByKey as Record<string, { messageId: string }[]>;
  expect(byKey.bo.map((r) => r.messageId)).toEqual(["b1"]);
  expect(noticesByKey.bo.map((r) => r.messageId)).toEqual(["b2"]);

  // ale's eigen rij is nu leeg: nogmaals ophalen levert niets meer op.
  const again = drainQueue(store, "ale", "2026-08-17T09:05:00.000Z");
  expect(again.invoices).toEqual([]);
  expect(again.notices).toEqual([]);
});

test("een regel zonder queueKey gaat naar de eigenaar, nooit naar wie toevallig het eerst ophaalt", () => {
  const store: Record<string, unknown> = {};
  addToQueue(
    store,
    {
      // Gmail-berichten hebben geen queueKey-veld; een leeg-doorgestuurde mail
      // heeft er wel een, maar leeg.
      invoices: [invoice("gmail-1"), invoice("bad-1", "")],
      notices: [],
      processedIds: ["gmail-1", "bad-1"],
    },
    NOW,
  );

  // Een willekeurige andere ophaler krijgt ze niet.
  const stranger = drainQueue(store, "iemand-anders", "2026-08-17T09:00:00.000Z");
  expect(stranger.invoices).toEqual([]);

  // De eigenaar (geen sleutel meegegeven) krijgt ze allebei.
  const owner = drainQueue(store, "", "2026-08-17T09:01:00.000Z");
  expect(owner.invoices.map((r: any) => r.messageId).sort()).toEqual(["bad-1", "gmail-1"]);
});

test("notices partitioneren op dezelfde manier — een melding voor bo is geen to-do voor ale", () => {
  const store: Record<string, unknown> = {};
  addToQueue(
    store,
    { invoices: [], notices: [notice("n1", "ale"), notice("n2", "bo")], processedIds: [] },
    NOW,
  );
  const forAle = drainQueue(store, "ale", NOW);
  expect(forAle.notices.map((r: any) => r.messageId)).toEqual(["n1"]);
  const noticesByKey = store.noticesByKey as Record<string, { messageId: string }[]>;
  expect(noticesByKey.bo.map((r) => r.messageId)).toEqual(["n2"]);
});

test("de grens blijft globaal: duizend sleutels vermenigvuldigen het plafond niet", () => {
  const store: Record<string, unknown> = {};
  const many = Array.from({ length: MAX_QUEUE + 50 }, (_, i) => invoice("m" + i, "sleutel" + i));
  const result = addToQueue(store, { invoices: many, notices: [], processedIds: [] }, NOW);
  expect(result.inQueue).toBe(MAX_QUEUE);
  const byKey = store.queueByKey as Record<string, unknown[]>;
  const total = Object.values(byKey).reduce((n, rows) => n + rows.length, 0);
  expect(total).toBe(MAX_QUEUE);
  expect(Object.keys(byKey).length).toBeLessThanOrEqual(MAX_QUEUE);
});

test("MAX_NOTICES geldt ook globaal, over alle sleutels heen", () => {
  const store: Record<string, unknown> = {};
  const many = Array.from({ length: MAX_NOTICES + 20 }, (_, i) => notice("n" + i, "sleutel" + i));
  const result = addToQueue(store, { invoices: [], notices: many, processedIds: [] }, NOW);
  expect(result.noticesInQueue).toBe(MAX_NOTICES);
});

/* ── Migratie van de oude platte vorm ─────────────────────────────────────── */

test("een levende n8n met de oude platte store verliest zijn rij niet bij de eerste run", () => {
  const store: Record<string, unknown> = {
    queue: [{ messageId: "oud-1", amountCents: 500, queuedAt: "2026-08-01T00:00:00.000Z" }],
    notices: [{ messageId: "oud-2", kind: "notification", queuedAt: "2026-08-01T00:00:00.000Z" }],
    seenIds: ["oud-1", "oud-2"],
  };
  addToQueue(store, { invoices: [invoice("nieuw-1")], notices: [], processedIds: [] }, NOW);

  const byKey = store.queueByKey as Record<string, { messageId: string }[]>;
  expect(byKey[OWNER_KEY].map((r) => r.messageId)).toEqual(["oud-1", "nieuw-1"]);
  expect(store.queue).toBeUndefined();
  expect(store.notices).toBeUndefined();
});

test("draineren migreert ook: de oude rij was altijd van de eigenaar", () => {
  const store: Record<string, unknown> = {
    queue: [{ messageId: "oud-1", amountCents: 500 }],
    notices: [{ messageId: "oud-2", kind: "reminder" }],
  };
  const served = drainQueue(store, "", NOW);
  expect(served.invoices.map((r: any) => r.messageId)).toEqual(["oud-1"]);
  expect(served.notices.map((r: any) => r.messageId)).toEqual(["oud-2"]);
});
