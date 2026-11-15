import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/* Shared by every extracted primitive (docs/adr/0005). `clsx` folds
 * conditionals into one string; `twMerge` then resolves same-property
 * Tailwind conflicts (e.g. a variant's `text-white` against a caller's own
 * `text-*` override) by keeping the later one, the way a plain CSS class
 * override would read. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
