import { expect, test } from "vitest";
import { emptyProfileStore } from "@lavega/core";
import { profileRows } from "./aboutYouRows";
import {
  applyBirthYear,
  applyCardRepayment,
  applyCheckInCadence,
  applyConfidence,
  applyCutTargets,
  applyFlightsPerYear,
  applyForeignSpend,
  applyHousehold,
  applyIncomeRegularity,
  applyMoneySharing,
  applyPointsGoal,
  applyPriorities,
  applySpendMix,
  applyStatedBanks,
  applyStatedPrograms,
} from "./state";
import { intakeCopy } from "../copy/intake";
import { wizardCopy } from "../copy/wizard";

const AS_OF = "2026-10-23";
const ctx = { c: intakeCopy.en.aboutYou, locale: "en" as const, asOf: AS_OF };

function full() {
  let p = emptyProfileStore("2026-10-23T10:00:00Z").current;
  p = applyHousehold(p, { kind: "together" }, AS_OF);
  p = applyMoneySharing(p, "mixed", AS_OF);
  p = applyBirthYear(p, 1990, AS_OF);
  p = applyIncomeRegularity(p, "varies", AS_OF);
  p = applyStatedBanks(p, ["ing", "bunq"], AS_OF);
  p = applyCardRepayment(p, "sometimes", AS_OF);
  p = applySpendMix(p, ["groceries", "travel"], AS_OF);
  p = applyForeignSpend(p, "often", AS_OF);
  p = applyPriorities(p, ["save-more"], AS_OF);
  p = applyCutTargets(p, ["subscriptions"], AS_OF);
  p = applyCheckInCadence(p, "weekly", AS_OF);
  p = applyConfidence(p, 3, AS_OF);
  p = applyStatedPrograms(p, [], AS_OF);
  p = applyPointsGoal(p, "flights", AS_OF);
  p = applyFlightsPerYear(p, "1-2", AS_OF);
  return p;
}

const NEW_SECTIONS = [
  "birthYear",
  "incomeRegularity",
  "statedBanks",
  "cardRepayment",
  "spendMix",
  "foreignSpend",
  "priorities",
  "cutTargets",
  "checkInCadence",
  "confidence",
  "statedPrograms",
  "pointsGoal",
  "flightsPerYear",
] as const;

test("every new field renders a row with its label", () => {
  const rows = profileRows(full(), ctx);
  for (const s of NEW_SECTIONS) {
    const row = rows.find((r) => r.section === s);
    expect(row, s).toBeDefined();
    expect(row!.value, s).not.toBe("");
    expect(ctx.c.sectionLabels[s], s).not.toBe("");
  }
  expect(rows.find((r) => r.key === "household:moneySharing")!.value).toBe("Partly shared");
});

test("an empty stored list renders the none value, not nothing", () => {
  const row = profileRows(full(), ctx).find((r) => r.section === "statedPrograms")!;
  expect(row.value).toBe("I have none");
});

test("money sharing is its own row only for a household of two", () => {
  const alone = applyHousehold(full(), { kind: "alone" }, AS_OF);
  expect(profileRows(alone, ctx).some((r) => r.key === "household:moneySharing")).toBe(false);
  expect(profileRows(full(), ctx).some((r) => r.key === "household:moneySharing")).toBe(true);
});

test("editing money sharing applies applyMoneySharing; removing it keeps the household", () => {
  const p = full();
  const row = profileRows(p, ctx).find((r) => r.key === "household:moneySharing")!;
  expect(row.editor!.kind).toBe("choice");
  if (row.editor!.kind !== "choice") return;
  const next = row.editor!.apply(p, "separate");
  expect(next.household!.value).toEqual({ kind: "together", moneySharing: "separate" });
  const removed = row.remove(p);
  expect(removed.household!.value).toEqual({ kind: "together" });
});

test("editing spend mix applies applySpendMix", () => {
  const p = full();
  const row = profileRows(p, ctx).find((r) => r.section === "spendMix")!;
  if (row.editor?.kind !== "multi") throw new Error("expected multi editor");
  const next = row.editor.apply(p, ["fuel", "online", "groceries", "travel"]);
  expect(next.spendMix!.value).toEqual(["groceries", "travel", "online"]);
  expect(next.spendMix!.source).toBe("stated");
});

test("editing birth year and confidence write through their appliers", () => {
  const p = full();
  const rows = profileRows(p, ctx);
  const by = rows.find((r) => r.section === "birthYear")!;
  if (by.editor?.kind !== "year") throw new Error("expected year editor");
  expect(by.editor.apply(p, 1985).birthYear!.value).toBe(1985);
  const thisYear = new Date(ctx.asOf).getFullYear();
  expect([by.editor.min, by.editor.max]).toEqual([thisYear - 100, thisYear - 16]);
  const conf = rows.find((r) => r.section === "confidence")!;
  if (conf.editor?.kind !== "choice") throw new Error("expected choice editor");
  expect(conf.editor.apply(p, "4").confidence!.value).toBe(4);
});

test("a stored bank id without a label shows as itself and survives an edit", () => {
  const p = applyStatedBanks(full(), ["ing", "mybank"], AS_OF);
  const row = profileRows(p, ctx).find((r) => r.section === "statedBanks")!;
  expect(row.value).toContain("mybank");
  expect(row.value).not.toContain("undefined");
  if (row.editor?.kind !== "multi") throw new Error("expected multi editor");
  expect(row.editor.options.some((o) => o.id === "mybank")).toBe(true);
  expect(row.editor.apply(p, ["ing", "mybank", "bunq"]).statedBanks!.value).toEqual([
    "ing",
    "bunq",
    "mybank",
  ]);
  expect(row.editor.apply(p, ["ing"]).statedBanks!.value).toEqual(["ing"]);
});

test("Dutch copy is used for labels and the none value", () => {
  const nl = { c: intakeCopy.nl.aboutYou, locale: "nl" as const, asOf: AS_OF };
  const rows = profileRows(full(), nl);
  expect(rows.find((r) => r.key === "household:moneySharing")!.value).toBe(
    wizardCopy.nl.moneySharing.mixed,
  );
  expect(rows.find((r) => r.section === "statedPrograms")!.value).toBe(wizardCopy.nl.noneCard);
});
