import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "scroll", "wheel"] as const;

/** Locks the vault after `idleMs` without pointer, key, touch, wheel, or scroll
 *  activity, and immediately on return from a tab that was hidden for at
 *  least `idleMs` (a background tab's timers are throttled, so that case is
 *  caught on `visibilitychange` using a timestamp rather than a timer). Only
 *  active while `enabled`; calls `lockNow` (always the latest one passed in)
 *  at most once per idle period. */
export default function useIdleLock(
  enabled: boolean,
  lockNow: () => void,
  idleMs = 15 * 60_000,
): void {
  const lockRef = useRef(lockNow);
  useEffect(() => {
    lockRef.current = lockNow;
  }, [lockNow]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let hiddenAt: number | null = null;

    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => lockRef.current(), idleMs);
    };

    const onActivity = () => arm();

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        clearTimeout(timer);
        return;
      }
      const wasHiddenFor = hiddenAt === null ? null : Date.now() - hiddenAt;
      hiddenAt = null;
      if (wasHiddenFor !== null && wasHiddenFor >= idleMs) {
        lockRef.current();
        return;
      }
      arm();
    };

    // Capture phase: `scroll` does not bubble, so a scrollable pane's own
    // scrolling would otherwise never reach the window.
    for (const type of ACTIVITY_EVENTS)
      window.addEventListener(type, onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    arm();

    return () => {
      clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS)
        window.removeEventListener(type, onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, idleMs]);
}
