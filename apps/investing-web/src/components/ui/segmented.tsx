import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { useScrollFade } from "../../lib/useScrollFade.js";

export type SegmentedOption<T extends string> = { value: T; label: string };

/* One look for every segmented control: a surface-2 track with a white pill
 * sliding behind the selected option. Coral stays reserved for the filled
 * primary action. On a phone the track scrolls sideways instead of wrapping. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onValueChange,
  className = "",
}: {
  label: string;
  value: T | null;
  options: readonly SegmentedOption<T>[];
  onValueChange: (value: T) => void;
  className?: string;
}) {
  const { ref, fade, measure } = useScrollFade<HTMLDivElement>(value);
  return (
    <SegmentedControl
      ref={ref}
      aria-label={label}
      value={value}
      onValueChange={(next, details) => {
        if (next === null) return details.cancel();
        onValueChange(next as T);
      }}
      data-fade={fade}
      onScroll={measure}
      className={`scroll-fade-x relative isolate inline-flex max-w-full shrink-0 items-center gap-1 self-start overflow-x-auto rounded-pill bg-secondary p-1 [scrollbar-width:none] ${className}`}
    >
      <SegmentedControlIndicator className="segmented-indicator absolute -z-10 rounded-pill bg-foreground" />
      {options.map((option) => (
        <SegmentedControlItem
          key={option.value}
          value={option.value}
          className="pressable shrink-0 rounded-pill px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground data-checked:text-background data-checked:hover:text-background"
        >
          {option.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
