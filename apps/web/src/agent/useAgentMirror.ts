import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanResult, Rule, ScheduledFlow } from "@lavega/core";
import {
  agentMirrorApi,
  buildMirror,
  createMirrorSync,
  fetchAgentEnabled,
  type MirrorApi,
} from "./mirror.js";

/* Keeps the server's copy of the mirror current, for opted-in accounts only.
 * "Enabled" is React state keyed to the signed-in account: it starts false for
 * every account, is looked up once per account when the vault is ready, and a
 * sign-out or account switch drops it (and any queued push) before anything can
 * be sent under the next account. When the lookup resolves true the state change
 * re-runs the push effect, so a user who enabled earlier gets a fresh copy on
 * load without having to edit anything. */
export function useAgentMirror(i: {
  /** The signed-in account's id, or null for a device vault or a signed-out state. */
  accountId: string | null;
  ready: boolean;
  rules: Rule[];
  flows: ScheduledFlow[];
  plan: PlanResult | null;
  locale: "nl" | "en";
  api?: MirrorApi;
  lookup?: () => Promise<boolean>;
  debounceMs?: number;
}): { enabled: boolean; setEnabled: (on: boolean) => void } {
  const [enabledFor, setEnabledFor] = useState<{ accountId: string; on: boolean } | null>(null);
  const enabled = i.accountId !== null && enabledFor?.accountId === i.accountId && enabledFor.on;
  const enabledRef = useRef(false);
  enabledRef.current = enabled;

  const sync = useMemo(
    () =>
      createMirrorSync(i.api ?? agentMirrorApi, () => enabledRef.current, {
        ...(i.debounceMs === undefined ? {} : { debounceMs: i.debounceMs }),
        onRefused: () => setEnabledFor(null),
      }),
    // The api and delay are fixed for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // New account, or none: forget the old answer and anything queued for it.
  useEffect(() => {
    setEnabledFor((cur) => (cur && cur.accountId === i.accountId ? cur : null));
    sync.cancel();
    return () => sync.cancel();
  }, [i.accountId, sync]);

  useEffect(() => {
    if (!i.ready || i.accountId === null) return;
    let live = true;
    const id = i.accountId;
    void (i.lookup ?? fetchAgentEnabled)().then((on) => {
      if (live) setEnabledFor({ accountId: id, on });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i.ready, i.accountId]);

  useEffect(() => {
    if (!i.ready || !enabled) return;
    sync.push(
      buildMirror({
        rules: i.rules,
        flows: i.flows,
        plan: i.plan,
        now: new Date(),
        locale: i.locale,
      }),
    );
  }, [i.ready, enabled, i.rules, i.flows, i.plan, i.locale, sync]);

  return {
    enabled,
    setEnabled: (on) => {
      if (i.accountId !== null) setEnabledFor({ accountId: i.accountId, on });
    },
  };
}
