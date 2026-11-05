import type { AdvisorProfile } from "@lavega/core";
import type { ProfileSection } from "../../copy/intake.js";
import { FIELD_ROWS, type RowContext } from "../aboutYouRows.js";
import { wizardCopy } from "../../copy/wizard.js";
import { WIZARD_DEBT, WIZARD_GOAL, isAnswered, type ScreenId } from "./screens.js";

export type SummaryRow = { screen: ScreenId; label: string; value: string };

/** The profile section a screen writes, and the row key when the section holds
 *  several rows. Screens that share a line (money sharing with household,
 *  child years with children, debt details with debts) are left out. */
const SOURCE: Partial<Record<ScreenId, { section: ProfileSection; key?: string }>> = {
  household: { section: "household" },
  "birth-year": { section: "birthYear" },
  work: { section: "work" },
  vat: { section: "chargesVat" },
  "income-regularity": { section: "incomeRegularity" },
  children: { section: "children" },
  income: { section: "statedRanges", key: "statedRanges:income" },
  spend: { section: "statedRanges", key: "statedRanges:spend" },
  housing: { section: "housing" },
  savings: { section: "savings" },
  banks: { section: "statedBanks" },
  "debit-cards": { section: "statedDebitCards" },
  cards: { section: "statedCards" },
  "card-repayment": { section: "cardRepayment" },
  "spend-mix": { section: "spendMix" },
  "foreign-spend": { section: "foreignSpend" },
  goal: { section: "goals", key: `goals:${WIZARD_GOAL}` },
  debts: { section: "debts", key: `debts:${WIZARD_DEBT}` },
  buffer: { section: "buffer" },
  priorities: { section: "priorities" },
};

/** Line text comes from the About you row builders. Risk answers share one line, placed at the
 *  first answered risk screen. */
export function summaryRows(
  p: AdvisorProfile,
  screens: readonly ScreenId[],
  ctx: RowContext,
): SummaryRow[] {
  const out: SummaryRow[] = [];
  let riskDone = false;
  for (const screen of screens) {
    if (!isAnswered(p, screen)) continue;
    if (screen === "invested") {
      out.push({
        screen,
        label: wizardCopy[ctx.locale].investedLabel,
        value: p.knowledge?.value.investedBefore === true ? ctx.c.values.yes : ctx.c.values.no,
      });
      continue;
    }
    const src: { section: ProfileSection; key?: string } | undefined = screen.startsWith("risk:")
      ? riskDone
        ? undefined
        : { section: "risk" }
      : SOURCE[screen];
    if (src === undefined) continue;
    const row = FIELD_ROWS[src.section](p, ctx).find(
      (r) => src.key === undefined || r.key === src.key,
    );
    if (row === undefined) continue;
    if (src.section === "risk") riskDone = true;
    out.push({
      screen,
      label: row.detail !== "" ? row.detail : ctx.c.sectionLabels[row.section],
      value: row.value,
    });
  }
  return out;
}
