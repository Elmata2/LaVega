import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "scroll", "wheel"] as const;

/** Locks the vault after `idleMs` without pointer, key, touch, wheel, or scroll
 *  activity, and immediately on return from a tab that was hidden for at
 *  least `idleMs` (a background tab's timers are throttled, so that case is
 *  caught on `visibilitychange` using a timestamp rather than a timer). Only
 *  active while `enabled`; calls `lockNow` (always the latest one passed in)
 *  at most once per idle period.
 *
 *  ── WHAT THIS DOES AND DOES NOT BOUND ─────────────────────────────────────
 *
 *  The lock itself only calls `lockNow`; what that means is App's `handleLock`:
 *  it drops the in-memory vault key (`storage.lock()`) and, for an account
 *  owner, POSTs `/api/auth/sign-out`, which revokes the session server-side.
 *  So an idle lock is not cosmetic — it removes the key from memory AND ends
 *  the server session.
 *
 *  What it does NOT bound is the session's own lifetime. Better Auth's session
 *  is configured with `expiresIn` = 30 days and `updateAge` = 1 day
 *  (`apps/server/src/auth.ts`), so a session that is never explicitly signed
 *  out stays valid for up to 30 days, rolled forward while it is used. And this
 *  timer only runs while the page is alive: closing the tab, crashing, or a
 *  phone that suspends the whole process leaves the session cookie valid until
 *  that expiry. There is deliberately no server-side idle bound to tighten that
 *  today — adding one costs a per-request update and a clock the self-hosted
 *  Docker path does not have — so the honest statement of the residual risk is:
 *  the idle lock bounds how long the unlocked vault key lives in this tab, not
 *  how long a stolen session cookie can be replayed. */
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
