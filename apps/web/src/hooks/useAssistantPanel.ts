import { useCallback, useState } from "react";
import {
  ASSISTANT_DEFAULT_WIDTH,
  clampAssistantWidth,
  readAssistant,
  writeAssistant,
  type PanelPrefs,
} from "../lib/assistantPanel";

export type AssistantPanelApi = {
  /** The stored choice (before the fit rule). */
  prefs: PanelPrefs;
  toggle: () => void;
  /** Keep a new width (clamped 320..520). Call on pointer-up, not per move. */
  setWidth: (width: number) => void;
  /** Back to 380, open state unchanged. */
  reset: () => void;
};

/** Assistant-column state, persisted per device in `lavega.assistantPanel`.
 *  Storage failures are silent; state then lives in memory. */
export function useAssistantPanel(): AssistantPanelApi {
  const [prefs, setPrefs] = useState<PanelPrefs>(() =>
    readAssistant(typeof window === "undefined" ? 1440 : window.innerWidth),
  );
  const update = useCallback((change: (p: PanelPrefs) => PanelPrefs) => {
    setPrefs((p) => {
      const next = change(p);
      writeAssistant(next);
      return next;
    });
  }, []);
  const toggle = useCallback(() => update((p) => ({ ...p, open: !p.open })), [update]);
  const setWidth = useCallback(
    (width: number) => update((p) => ({ ...p, width: clampAssistantWidth(width) })),
    [update],
  );
  const reset = useCallback(
    () => update((p) => ({ ...p, width: ASSISTANT_DEFAULT_WIDTH })),
    [update],
  );
  return { prefs, toggle, setWidth, reset };
}
