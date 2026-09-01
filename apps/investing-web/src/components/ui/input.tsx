import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal", className)} {...props} />;
}
