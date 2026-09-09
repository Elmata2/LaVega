// Usage: npx tsx packages/core/scripts/explain-subscription.ts <rows-file>
// <rows-file> is a text file, one "date,amount" pair per line, oldest or
// newest first (the script sorts), e.g.:
//   2025-09-25,-24.03
//   2025-10-31,-27.34
// Amount is EUR, negative for an outflow (only outflows are meaningful
// here). Prints what `merchantTallies`/`explainMerchant` would show for
// this one series: charge count, median gap, amount CV, and either the
// subscription it forms or the Dutch reason it does not.

import { readFileSync } from "node:fs";
import type { Tx } from "../src/model.js";
import { detectSubscriptions, explainMerchant, merchantTallies } from "../src/subscriptions.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx packages/core/scripts/explain-subscription.ts <rows-file>");
  process.exit(1);
}

const MERCHANT = "Diagnose Reeks";

const rows: Tx[] = readFileSync(path, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "")
  .map((line, i) => {
    const [date, amountStr] = line.split(",").map((s) => s.trim());
    return {
      id: `diag-${i}`,
      accountKey: "diag",
      date,
      amount: Number(amountStr),
      currency: "EUR",
      counterparty: MERCHANT,
      description: "",
      category: "",
      manual: false,
    };
  })
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const [tally] = merchantTallies(rows);
if (!tally) {
  console.log("Geen uitgaande rijen in dit bestand.");
  process.exit(0);
}

console.log(`Afschrijvingen: ${tally.charges}`);
console.log(`Totaal: ${(tally.totalCents / 100).toFixed(2).replace(".", ",")}`);
console.log(`Eerste: ${tally.firstDate}  Laatste: ${tally.lastDate}`);
console.log(`Mediaan gat: ${tally.medianGapDays === null ? "—" : `${tally.medianGapDays} dagen`}`);
console.log(`Bedragspreiding: ${tally.amountCv === null ? "—" : tally.amountCv.toFixed(3)}`);

const asOf = tally.lastDate;
const found = detectSubscriptions(rows, { asOf }).find((s) => s.merchant === "diagnose reeks");
if (found) {
  console.log(
    `Abonnement: ${found.monthlyCents / 100} EUR/mnd, ritme ${found.cadenceDays}d, ` +
      `${found.occurrences} afschrijvingen, laatste bedrag ${found.lastAmountCents / 100} EUR`,
  );
} else {
  const amountsCents = rows.map((t) => Math.round(Math.abs(t.amount) * 100));
  const dates = rows.map((t) => t.date);
  console.log(`Reden: ${explainMerchant(dates, amountsCents, 0.35, asOf)}`);
}
