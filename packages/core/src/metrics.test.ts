import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { autoConfirmTransfers, suggestTransfers } from "./transfers.js";
import { categorize, ownAccounts } from "./views.js";

/* WS6.4 metric review (#302): the program's measured aggregates.
 *
 * Every number here is derived from committed SYNTHETIC fixtures, never from
 * the owner's vault: the vault is local-first and an agent cannot read it
 * (ADR 0009), so the live baselines (#303) stay owner-pending. The artifact
 * `docs/metrics/sure-program-metrics-2026-11-11.json` records only aggregates
 * (rates, percentages, counts) — no real amount, counterparty or account.
 *
 * The test pins the artifact so a fixture or formula change cannot silently
 * move the published numbers. Owner-pending rows stay in the artifact with a
 * reason and a definition, never an estimate. */

type MeasuredMetric = {
  id: string;
  label: string;
  valuePct: number | null;
  beforePct?: number;
  afterPct?: number;
  unit: "percent";
  basis: "synthetic-fixture";
  method: string;
};

type PendingMetric = {
  id: string;
  label: string;
  reason: string;
  definition: string;
  status: "owner-pending";
};

type MetricArtifact = {
  program: string;
  asOf: string;
  basis: string;
  measured: MeasuredMetric[];
  ownerPending: PendingMetric[];
};

const ARTIFACT_URL = new URL(
  "../../../docs/metrics/sure-program-metrics-2026-11-11.json",
  import.meta.url,
);

const round2 = (value: number): number => Math.round(value * 100) / 100;

type ForecastArtifact = {
  openingCents: number | null;
  checkpoints: Array<{ label: string; absoluteErrorCents: number | null }>;
};

const forecastError = (): MeasuredMetric[] => {
  const baseline = JSON.parse(
    readFileSync(
      new URL("./plan/__fixtures__/forecast-error-baseline-290.json", import.meta.url),
      "utf8",
    ),
  ) as ForecastArtifact;
  const integrated = JSON.parse(
    readFileSync(
      new URL("./plan/__fixtures__/forecast-error-integrated-290.json", import.meta.url),
      "utf8",
    ),
  ) as ForecastArtifact;
  const opening = baseline.openingCents;
  if (opening == null || opening <= 0) throw new Error("forecast fixture opening unknown");
  return baseline.checkpoints.map((checkpoint) => {
    const after = integrated.checkpoints.find((row) => row.label === checkpoint.label);
    const beforeCents = checkpoint.absoluteErrorCents;
    const afterCents = after?.absoluteErrorCents;
    if (beforeCents == null || afterCents == null) throw new Error("forecast checkpoint missing");
    return {
      id: `forecast-error-${checkpoint.label}`,
      label: `Forecast absolute error at ${checkpoint.label}`,
      valuePct: round2((afterCents / opening) * 100),
      beforePct: round2((beforeCents / opening) * 100),
      afterPct: round2((afterCents / opening) * 100),
      unit: "percent" as const,
      basis: "synthetic-fixture" as const,
      method:
        "absolute error of the projected close vs the actual ledger at the 30/60/90-day checkpoint, as a percentage of the opening position; #290 real-shaped fixture",
    };
  });
};

type TransferVault = { asOf: string; accounts: Account[]; txs: Tx[] };

/** The bills-era real-shaped vault has twelve same-day, opposite-sign savings
 *  sweeps between the household's two accounts. Each pair is one expected
 *  internal transfer, so auto-confirmed pairs / labelled pairs is the
 *  synthetic analogue of the plan's transfer-coverage metric. */
const transferCoverage = (): MeasuredMetric => {
  const vault = JSON.parse(
    readFileSync(new URL("./bills/__fixtures__/real-shaped-vault.json", import.meta.url), "utf8"),
  ) as TransferVault;
  const expected = vault.txs.filter(
    (tx) =>
      tx.amount < 0 &&
      tx.counterparty === "Eigen overboeking" &&
      tx.description === "Naar spaarrekening",
  ).length;
  const { added } = autoConfirmTransfers({
    txs: vault.txs,
    accounts: vault.accounts,
    asOf: vault.asOf,
  });
  const remaining = suggestTransfers({
    txs: vault.txs,
    accounts: vault.accounts,
    pairs: added,
    asOf: vault.asOf,
  }).length;
  if (expected === 0) throw new Error("no labelled transfer pairs in the fixture");
  return {
    id: "internal-transfer-match-rate",
    label: "Internal-transfer match rate",
    valuePct: round2((added.length / expected) * 100),
    unit: "percent",
    basis: "synthetic-fixture",
    method: `${added.length} of ${expected} labelled same-day pairs auto-confirmed, ${remaining} pairs left as suggestions; real-shaped synthetic vault`,
  };
};

/** Share of the fixture ledger the categorizer leaves without a category. */
const uncategorizedShare = (): MeasuredMetric => {
  const vault = JSON.parse(
    readFileSync(new URL("./bills/__fixtures__/real-shaped-vault.json", import.meta.url), "utf8"),
  ) as TransferVault;
  const own = ownAccounts(vault.accounts);
  const uncategorized = vault.txs.filter((tx) => categorize(tx, [], own) === "").length;
  return {
    id: "uncategorized-share",
    label: "Uncategorized share",
    valuePct: round2((uncategorized / Math.max(1, vault.txs.length)) * 100),
    unit: "percent",
    basis: "synthetic-fixture",
    method: `${uncategorized} of ${vault.txs.length} fixture transactions have no category under the built-in tiers; synthetic vault`,
  };
};

const pending: PendingMetric[] = [
  {
    id: "forecast-error-live",
    label: "Forecast error on the owner's history",
    reason: "the personal vault is encrypted and local-first (ADR 0009); #303 owner-blocked",
    definition: "as above, on the last three complete months of the owner's own ledger",
    status: "owner-pending",
  },
  {
    id: "internal-transfer-match-rate-live",
    label: "Internal-transfer match rate on the owner's vault",
    reason: "needs the owner's ledger and 30 days of decisions; #303 owner-blocked",
    definition: "confirmed pairs / (confirmed + rejected + still-suggested after 30 days)",
    status: "owner-pending",
  },
  {
    id: "uncategorized-share-live",
    label: "Uncategorized share on the owner's ledger",
    reason: "needs the owner's last three complete months; #303 owner-blocked",
    definition: "transactions without a category / all transactions",
    status: "owner-pending",
  },
  {
    id: "statement-coverage",
    label: "Statement coverage",
    reason: "needs the owner's first-account date and imported-document months; #303 owner-blocked",
    definition:
      "months with at least one statement document / months since the first account opened",
    status: "owner-pending",
  },
  {
    id: "realised-gain-reconciliation",
    label: "Realised-gain reconciliation",
    reason:
      "needs the broker's own realised/cash statement; fixture tests prove the report runs, not an independent reconciliation",
    definition:
      "realised gains + income from the report minus the broker's reported movement; unknown when the broker does not report it",
    status: "owner-pending",
  },
  {
    id: "mcp-usage",
    label: "MCP tool calls per week and error rate",
    reason: "needs the production server audit rows; no live MCP traffic exists from a local check",
    definition: "tool calls per week and the ok/refused/error counts from the audit table",
    status: "owner-pending",
  },
  {
    id: "ai-spend",
    label: "AI spend per operation and per account per month",
    reason: "needs live agent usage; a local check makes no model calls",
    definition: "cost per operation and per account per month from the AI usage ledger",
    status: "owner-pending",
  },
  {
    id: "time-to-close-month",
    label: "Time to close a month",
    reason: "a wall-clock measurement only the owner can take",
    definition: "minutes from starting the month-close routine to trusting the numbers",
    status: "owner-pending",
  },
];

const measured: MeasuredMetric[] = [...forecastError(), transferCoverage(), uncategorizedShare()];

const artifact: MetricArtifact = {
  program: "sure-adoption",
  asOf: "2026-11-11",
  basis:
    "aggregates only; measured rows come from committed synthetic real-shaped fixtures because the owner's vault is local-first and not agent-readable (ADR 0009); owner-pending rows are stated, never estimated",
  measured,
  ownerPending: pending,
};

describe("metric review (#302)", () => {
  test("the measured aggregates match the committed artifact", () => {
    if (process.env.WRITE_METRICS_ARTIFACT === "1") {
      writeFileSync(ARTIFACT_URL, JSON.stringify(artifact, null, 2) + "\n");
    }
    const committed = JSON.parse(readFileSync(ARTIFACT_URL, "utf8")) as MetricArtifact;
    expect(artifact).toEqual(committed);
  });

  test("no owner amount or name leaks into the artifact", () => {
    const text = JSON.stringify(artifact);
    expect(text).not.toMatch(/NL\d\d[A-Z]{4}\d{10}/); // IBAN
    expect(text).not.toContain("€");
    expect(text).not.toContain("EUR ");
    // Only aggregate numbers: no field carries a money amount in euros/cents.
    expect(text).not.toMatch(/\b(amount|balance)\b/i);
  });

  test("every measured row is a percentage from a declared fixture", () => {
    for (const metric of artifact.measured) {
      expect(metric.unit).toBe("percent");
      expect(metric.basis).toBe("synthetic-fixture");
      expect(metric.valuePct).toBeGreaterThanOrEqual(0);
      expect(metric.method.length).toBeGreaterThan(20);
    }
  });

  test("the owner-blocked metrics are named, with a reason and a definition", () => {
    expect(artifact.ownerPending.length).toBe(8);
    for (const item of artifact.ownerPending) {
      expect(item.status).toBe("owner-pending");
      expect(item.reason.length).toBeGreaterThan(20);
      expect(item.definition.length).toBeGreaterThan(20);
    }
  });
});
