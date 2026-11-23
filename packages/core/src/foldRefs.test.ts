import { expect, test } from "vitest";
import {
  remapBillAccounts,
  remapBillDecisions,
  remapDocuments,
  remapImportSessions,
} from "./foldRefs.js";
import { billMatchId } from "./bills/match.js";
import type { BillDecisions, Bill } from "./bills/model.js";
import type { ImportSession } from "./csvImport.js";
import type { VaultDocument } from "./statements/types.js";

const remap = new Map<string, string | null>([
  ["old1", "new1"],
  ["gone", null],
]);
const folds = [{ survivorKey: "S", duplicateKey: "D" }];

test("bill matches and rejections follow their row; an unreplaced row drops them", () => {
  const d = {
    matches: [
      {
        id: "m1",
        occurrenceId: "o1",
        billId: "b",
        txId: "old1",
        amountCents: 1,
        currency: "EUR",
        source: "auto",
        confidence: 1,
        decidedAt: "x",
      },
      {
        id: "m2",
        occurrenceId: "o2",
        billId: "b",
        txId: "gone",
        amountCents: 1,
        currency: "EUR",
        source: "auto",
        confidence: 1,
        decidedAt: "x",
      },
      {
        id: "m3",
        occurrenceId: "o3",
        billId: "b",
        txId: "keep",
        amountCents: 1,
        currency: "EUR",
        source: "user",
        confidence: 1,
        decidedAt: "x",
      },
    ],
    marks: [],
    rejections: [
      { billId: "b", txId: "old1", occurrenceId: "o1", rejectedAt: "x" },
      { billId: "b", txId: "new1", occurrenceId: "o1", rejectedAt: "x" },
    ],
    priceChanges: [],
  } as unknown as BillDecisions;
  const out = remapBillDecisions(d, remap);
  expect(out.matches.map((m) => [m.txId, m.id])).toEqual([
    ["new1", billMatchId("o1", "new1")],
    ["keep", "m3"],
  ]);
  expect(out.rejections).toHaveLength(1);
  expect(out.rejections[0]!.txId).toBe("new1");
});

test("a bill series, an import session and a document follow the folded account", () => {
  expect(
    remapBillAccounts(
      [{ accountKey: "D" }, { accountKey: "Z" }, {}] as unknown as Bill[],
      folds,
    ).map((b) => b.accountKey),
  ).toEqual(["S", "Z", undefined]);
  const s = remapImportSessions(
    [{ accountKey: "D", txIds: ["old1", "gone", "k"] }] as unknown as ImportSession[],
    remap,
    folds,
  );
  expect(s[0]).toMatchObject({ accountKey: "S", txIds: ["new1", "k"] });
  const docs = remapDocuments(
    [
      { accountKey: "D", suggestedAccountKey: null, txIds: ["old1"] },
      { accountKey: null, suggestedAccountKey: "D" },
    ] as unknown as VaultDocument[],
    remap,
    folds,
  );
  expect(docs[0]).toMatchObject({ accountKey: "S", txIds: ["new1"] });
  expect(docs[1]).toMatchObject({ accountKey: null, suggestedAccountKey: "S" });
});
