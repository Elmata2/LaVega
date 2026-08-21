export const money = (value: number) =>
  value.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export const percent = (value: number) => {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toLocaleString("nl-NL", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
};

// XIRR annualizes a since-range-start return, so in the first few days of a
// window it can spike into the hundreds of percent — real, not a bug, but
// unreadable at full precision. Cap the display rather than let it blow up
// the tooltip's width.
export const percentXirr = (value: number) => {
  if (value > 9.99) return "> +999%";
  if (value < -0.99) return "< -99%";
  return percent(value);
};

export const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
