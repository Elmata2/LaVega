import { Switch as SwitchRoot, SwitchThumb } from "@ui-sdk/react/switch";

/* A setting that applies the moment it changes. The label names the setting
 * and stays the same in both states; the thumb shows on or off. */
export function Switch({
  on,
  disabled,
  label,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <SwitchRoot
      aria-label={label}
      checked={on}
      disabled={disabled}
      onCheckedChange={onToggle}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border border-border bg-secondary p-0.5 transition-colors data-checked:border-transparent data-checked:bg-accent data-disabled:opacity-60"
    >
      <SwitchThumb className="block size-[18px] rounded-pill bg-foreground transition-transform duration-150 ease-out data-checked:translate-x-5" />
    </SwitchRoot>
  );
}
