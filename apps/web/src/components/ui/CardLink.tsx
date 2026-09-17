import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils.js";

/* Extracted from `.card-link`/`.card-link-danger` (docs/adr/0005) — the
 * borderless "see more" / destructive-action button inside a card.
 *
 * Plain `cursor-pointer`, not `enabled:cursor-pointer`: unlike Button/Pill,
 * the original `.card-link { cursor: pointer }` was never scoped to
 * `:not(:disabled)` either, and several call sites (TravelBlock, Rekeningen,
 * Punten) DO pass `disabled`. Re-expression means reproducing that exactly,
 * not fixing it as a side effect of the conversion. */
export const cardLinkVariants = cva(
  "bg-transparent border-none p-0 text-[0.85rem] font-medium cursor-pointer whitespace-nowrap " +
    "hover:underline hover:[filter:brightness(1.2)]",
  {
    variants: {
      variant: {
        default: "text-accent",
        danger: "text-neg",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type CardLinkProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof cardLinkVariants> & {
    "data-testid"?: string;
  };

/* data-testid="card-link", not the removed `.card-link` class: scope-restore
 * test.tsx scoped a `querySelectorAll` to `button.card-link` to find a
 * see-more link by its text.
 *
 * data-variant="danger", not the removed `.card-link-danger` class: three
 * more tests (rekeningen-ui, punten-persist, punten-ui) scoped a
 * querySelector to `.card-link-danger` to find the destructive action among
 * several card-links in the same card. */
const CardLink = forwardRef<HTMLButtonElement, CardLinkProps>(function CardLink(
  { className, variant, type = "button", "data-testid": dataTestId, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-testid={dataTestId ?? "card-link"}
      data-variant={variant === "danger" ? "danger" : undefined}
      className={cn(cardLinkVariants({ variant }), className)}
      {...props}
    />
  );
});

export default CardLink;
