import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const cardVariants = cva("rounded-card border", {
  variants: {
    variant: {
      default: "border-border bg-card",
      empty: "border-dashed border-border bg-transparent",
    },
  },
  defaultVariants: { variant: "default" },
});

const cardHeaderVariants = cva("flex flex-col p-5 sm:p-6", {
  variants: { gap: { default: "gap-1.5", wide: "gap-4" } },
  defaultVariants: { gap: "default" },
});

const cardTitleVariants = cva("", {
  variants: {
    size: {
      default: "font-display text-3xl",
      md: "font-sans text-xl font-semibold tracking-tight",
    },
  },
  defaultVariants: { size: "default" },
});

const cardContentVariants = cva("p-5 pt-0 sm:p-6 sm:pt-0", {
  variants: { spacing: { default: "", loose: "space-y-5", inset: "px-6" } },
  defaultVariants: { spacing: "default" },
});

export function Card({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

export function CardHeader({
  className,
  gap,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardHeaderVariants>) {
  return <div className={cn(cardHeaderVariants({ gap }), className)} {...props} />;
}

export function CardTitle({
  as: Heading = "h3",
  className,
  size,
  ...props
}: HTMLAttributes<HTMLHeadingElement> &
  VariantProps<typeof cardTitleVariants> & { as?: "h1" | "h2" | "h3" }) {
  return <Heading className={cn(cardTitleVariants({ size }), className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({
  className,
  spacing,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardContentVariants>) {
  return <div className={cn(cardContentVariants({ spacing }), className)} {...props} />;
}
