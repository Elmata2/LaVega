import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "pressable inline-flex items-center justify-center whitespace-nowrap rounded-pill text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary px-4 py-2.5 text-primary-foreground hover:bg-primary/90",
        ghost: "px-3 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground",
        outline: "border border-border bg-transparent px-4 py-2.5 hover:bg-secondary",
        destructive:
          "border border-negative/40 bg-negative/15 px-4 py-2.5 text-negative hover:bg-negative/25",
      },
      size: { default: "", sm: "px-3 py-2 text-xs" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
