export { cn } from "@lavega/ui/utils";

/** "1 instrument", "3 instruments". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** An axis tick amount: "€14K", never "€14,000.00". */
export function compactMoney(value: number, currency: string): string {
  return value.toLocaleString("en-GB", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  });
}
