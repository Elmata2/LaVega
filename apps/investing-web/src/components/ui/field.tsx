import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex w-full flex-col gap-6", className)}
      {...props}
    />
  );
}

export function Field({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="field" className={cn("flex w-full flex-col gap-2", className)} {...props} />
  );
}

export function FieldLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={cn("leading-snug", className)} {...props} />;
}

export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-sm leading-normal text-muted-foreground", className)}
      {...props}
    />
  );
}
