import { type ElementType, forwardRef, type ReactNode } from "react";
import { cn } from "./utils.js";

/* Extracted from `.card`/`.card-header` (docs/adr/0005) — the app's
 * most-shared primitive, 25 call sites. Call sites use `<section>` (the
 * common case, for the landmark's `aria-label`), one bare `<div>`, and one
 * `<form>` (VaultGate) — so `as` picks the host element instead of forcing
 * every caller to wrap a semantic element in a styling `<div>`. */
const CARD_BASE =
  "mb-[var(--sp-5)] rounded-sm border border-line bg-surface p-[var(--sp-5)] " +
  /* `.card > h2` gave an un-headered card (Import, Belasting's own sections)
   * the same title rule `<CardHeader>` gives one — this is that same rule,
   * aimed the same way, so a bare `<h2>` direct child still gets it without
   * every such call site adopting `<CardHeader>`. No-op wherever a card's
   * first child isn't an `<h2>`. */
  "[&>h2]:mb-4 [&>h2]:border-b [&>h2]:border-ink [&>h2]:pb-3";

type CardProps = {
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  [prop: string]: unknown;
};

const Card = forwardRef<HTMLElement, CardProps>(function Card({ as, className, ...props }, ref) {
  const Comp = (as ?? "div") as ElementType;
  return <Comp ref={ref} className={cn(CARD_BASE, className as string | undefined)} {...props} />;
});

/* `.card-header h2` zeroed the bare `h1,h2,h3{margin:0 0 var(--sp-3)}` tag
 * rule's own margin (plus the padding/border this same file would otherwise
 * give a direct-child `<h2>`) so the flex row's own baseline alignment isn't
 * fighting the title's. `[&_h2]` is a descendant match, not `[&>h2]`, because
 * the original was `.card-header h2` — any depth, not only a direct child. */
const CARD_HEADER_BASE =
  "mb-4 flex items-baseline justify-between gap-3 border-b border-ink pb-3 " +
  "[&_h2]:m-0 [&_h2]:border-b-0 [&_h2]:pb-0";

type CardHeaderProps = {
  className?: string;
  children?: ReactNode;
  [prop: string]: unknown;
};

const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { className, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn(CARD_HEADER_BASE, className as string | undefined)} {...props} />
  );
});

export { Card, CardHeader };
export default Card;
