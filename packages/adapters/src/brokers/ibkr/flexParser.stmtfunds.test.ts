import { expect, test } from "vitest";
import { parseFlexStatement } from "./flexParser.js";

const realShape = `<FlexQueryResponse queryName="q" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U1" fromDate="20251006" toDate="20261005" period="Last365CalendarDays" whenGenerated="20261006;120000">
<OpenPositions><OpenPosition accountId="U1" symbol="VUSA" position="93" markPrice="130" positionValue="12090" costBasisPrice="104" costBasisMoney="9672" currency="EUR" assetCategory="STK" percentOfNAV="40" /></OpenPositions>
<Trades></Trades>
<Transfers></Transfers>
<CorporateActions></CorporateActions>
<CashReport><CashReportCurrency accountId="U1" fromDate="20251006" toDate="20261005" startingCash="100" endingCash="500" currency="EUR" /></CashReport>
<StmtFunds><StatementOfFundsLine accountId="U1" date="20260310" activityDescription="Electronic Fund Transfer" amount="400" debit="" credit="400" balance="500" currency="EUR" assetCategory="" /></StmtFunds>
</FlexStatement></FlexStatements></FlexQueryResponse>`;

test("IBKR's real <StmtFunds> container counts as the Statement of Funds", () => {
  const result = parseFlexStatement(realShape, "personal");
  expect(result.sections.cashFlows.status).toBe("complete");
  expect(result.sections.dividends.status).toBe("complete");
  expect(result.sections.cashFlows.rows).toHaveLength(1);
  expect(result.cashHistory?.status).toBe("complete");
  expect(result.cashHistory).toMatchObject({ quantityProvenFrom: "2025-10-06" });
});

test("an Electronic Fund Transfer without an activity code is a deposit or withdrawal by its sign", () => {
  const withLines = (lines: string) =>
    realShape.replace(/<StmtFunds>[\s\S]*<\/StmtFunds>/, `<StmtFunds>${lines}</StmtFunds>`);
  const result = parseFlexStatement(
    withLines(
      '<StatementOfFundsLine accountId="U1" date="20260310" activityDescription="Electronic Fund Transfer" amount="400" currency="EUR" />' +
        '<StatementOfFundsLine accountId="U1" date="20260410" activityDescription="Electronic Fund Transfer" amount="-150" currency="EUR" />',
    ),
    "personal",
  );
  expect(result.sections.cashFlows.rows.map((flow) => [flow.kind, flow.amount])).toEqual([
    ["deposit", 400],
    ["withdrawal", -150],
  ]);
});

const withLines = (lines: string) =>
  realShape.replace(/<StmtFunds>[\s\S]*<\/StmtFunds>/, `<StmtFunds>${lines}</StmtFunds>`);
const line = (description: string, amount: number, extra = "") =>
  `<StatementOfFundsLine accountId="U1" date="20260310" activityDescription="${description}" amount="${amount}" currency="EUR" ${extra} />`;
const parse = (lines: string) => parseFlexStatement(withLines(lines), "personal").sections;

test("two identical same-day lines stay two rows when their running balance differs", () => {
  const { cashFlows } = parse(
    line("Electronic Fund Transfer", 500, 'balance="600"') +
      line("Electronic Fund Transfer", 500, 'balance="1100"'),
  );
  expect(cashFlows.rows.map((flow) => [flow.kind, flow.amount])).toEqual([
    ["deposit", 500],
    ["deposit", 500],
  ]);
  expect(new Set(cashFlows.rows.map((flow) => flow.id)).size).toBe(2);
});

test("fully identical lines (no balance) are told apart by occurrence", () => {
  const { cashFlows } = parse(
    line("Electronic Fund Transfer", 500) + line("Electronic Fund Transfer", 500),
  );
  expect(cashFlows.rows).toHaveLength(2);
  expect(new Set(cashFlows.rows.map((flow) => flow.id)).size).toBe(2);
});

test("row ids do not depend on where the statement window starts", () => {
  const a = parse(line("Electronic Fund Transfer", 500) + line("Interest", 1));
  const b = parse(line("Interest", 1));
  expect(b.cashFlows.rows[0]?.id).toBe(a.cashFlows.rows[1]?.id);
});

test("buying an ETF named DIVIDEND is trade cash, not income", () => {
  const { cashFlows, dividends } = parse(
    line(
      "Buy 10 VHYL (VANGUARD FTSE ALL-WORLD HIGH DIVIDEND YIELD)",
      -60,
      'symbol="VHYL" assetCategory="ETF"',
    ),
  );
  expect(dividends.rows).toHaveLength(0);
  expect(cashFlows.rows.map((flow) => [flow.kind, flow.amount])).toEqual([["other", -60]]);
});

test("a negative cash dividend is a reversal, not income", () => {
  const { dividends } = parse(line("VUSA Cash Dividend EUR 0.10 per Share", -4, 'symbol="VUSA"'));
  expect(dividends.rows.map((dividend) => dividend.amount)).toEqual([-4]);
});

test("owner-money descriptions without a code map by sign", () => {
  const { cashFlows } = parse(
    line("Disbursement Initiated by Alexander", -200) +
      line("Cash Transfer", 300) +
      line("Transfer to U2", -100) +
      line("Transfer from U2", 100) +
      line("Internal Transfer", -50),
  );
  expect(cashFlows.rows.map((flow) => [flow.kind, flow.amount])).toEqual([
    ["withdrawal", -200],
    ["deposit", 300],
    ["withdrawal", -100],
    ["deposit", 100],
    ["withdrawal", -50],
  ]);
});

test("a withholding tax refund keeps its positive sign; a charge stays negative", () => {
  const { cashFlows } = parse(
    line("VUSA Withholding Tax Refund", 3) + line("VUSA Withholding Tax", -3),
  );
  expect(cashFlows.rows.map((flow) => flow.amount)).toEqual([3, -3]);
});

test("reversals and fees are not owner deposits, and coded buys are trade cash", () => {
  const withLines = (lines: string) =>
    realShape.replace(/<StmtFunds>[\s\S]*<\/StmtFunds>/, `<StmtFunds>${lines}</StmtFunds>`);
  const line = (description: string, amount: string, extra = "") =>
    `<StatementOfFundsLine accountId="U1" date="20260310" activityDescription="${description}" amount="${amount}" currency="EUR" ${extra}/>`;
  const result = parseFlexStatement(
    withLines(
      line("Deposit Reversal", "-500") +
        line("Withdrawal reversal", "200") +
        line("ADR Dep Fee", "-1") +
        line("VANGUARD FTSE ALL-WORLD HIGH DIVIDEND YIELD", "-600", 'activityCode="BUY"') +
        line("Transfer to U2 of position VUSA", "-10"),
    ),
    "personal",
  );
  const kinds = result.sections.cashFlows.rows.map((flow) => [
    flow.description,
    flow.kind,
    flow.amount,
  ]);
  expect(kinds).toEqual([
    ["Deposit Reversal", "withdrawal", -500],
    ["Withdrawal reversal", "deposit", 200],
    ["ADR Dep Fee", "fee", -1],
    ["VANGUARD FTSE ALL-WORLD HIGH DIVIDEND YIELD", "other", -600],
    ["Transfer to U2 of position VUSA", "other", -10],
  ]);
  expect(result.sections.dividends.rows).toHaveLength(0);
});

test("base-currency summary rows are dropped when per-currency rows exist", () => {
  const withLines = (lines: string) =>
    realShape.replace(/<StmtFunds>[\s\S]*<\/StmtFunds>/, `<StmtFunds>${lines}</StmtFunds>`);
  const result = parseFlexStatement(
    withLines(
      '<StatementOfFundsLine accountId="U1" levelOfDetail="Currency" date="20260310" activityDescription="Electronic Fund Transfer" amount="400" balance="500" currency="EUR" />' +
        '<StatementOfFundsLine accountId="U1" levelOfDetail="BaseCurrency" date="20260310" activityDescription="Electronic Fund Transfer" amount="400" balance="500" currency="EUR" />',
    ),
    "personal",
  );
  expect(result.sections.cashFlows.rows).toHaveLength(1);
});

test("IBKR's signed amounts are kept: reversals, fee credits and coded owner money follow the sign", () => {
  const withLines = (lines: string) =>
    realShape.replace(/<StmtFunds>[\s\S]*<\/StmtFunds>/, `<StmtFunds>${lines}</StmtFunds>`);
  const line = (description: string, amount: string, code = "") =>
    `<StatementOfFundsLine accountId="U1" date="20260310" ${code ? `activityCode="${code}" ` : ""}activityDescription="${description}" amount="${amount}" currency="EUR" />`;
  const result = parseFlexStatement(
    withLines(
      line("Deposit Reversal", "-500", "DEP") +
        line("Withdrawal Reversal", "200", "WTH") +
        line("Commission Adjustment", "5") +
        line("Electronic Fund Transfer", "300", "ADJ") +
        line("Interest on Cash Deposit", "2"),
    ),
    "personal",
  );
  expect(
    result.sections.cashFlows.rows.map((flow) => [flow.description, flow.kind, flow.amount]),
  ).toEqual([
    ["Deposit Reversal", "withdrawal", -500],
    ["Withdrawal Reversal", "deposit", 200],
    ["Commission Adjustment", "fee", 5],
    ["Electronic Fund Transfer", "deposit", 300],
    ["Interest on Cash Deposit", "interest", 2],
  ]);
});
