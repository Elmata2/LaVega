import { useState } from "react";

/** Read once at mount, as the mockup does: a change mid-visit does not restart anything. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useReducedMotion(): boolean {
  return useState(prefersReducedMotion)[0];
}

/** Loops and typing need both permission (no reduced motion) and an
 *  IntersectionObserver to know when the block is on screen. Without either,
 *  the page shows its static state. */
export function useAnimated(): boolean {
  return useState(() => !prefersReducedMotion() && typeof IntersectionObserver !== "undefined")[0];
}

/** Index `i` of `n` stacked items, with `k` steps taken. 0 is the front. */
export function slot(i: number, k: number, n: number, dir: 1 | -1): number {
  return (((dir * (i - k)) % n) + n) % n;
}
