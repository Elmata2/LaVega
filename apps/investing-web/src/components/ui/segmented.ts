/* One look for every segmented control: a surface-2 track with a white pill
 * on the selected option. Coral stays reserved for the filled primary action. */
export const segmentedTrack = "flex flex-wrap gap-1 rounded-pill bg-secondary p-1";

export function segmentedItem(selected: boolean): string {
  return `pressable rounded-pill px-2.5 py-1.5 text-xs font-semibold ${selected ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`;
}
