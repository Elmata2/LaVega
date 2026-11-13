import { useCallback, useEffect, useState } from "react";
import {
  SIDEBAR_DEFAULT_WIDTH,
  clampStoredWidth,
  clampWidth,
  maxWidthFor,
  readSidebar,
  writeSidebar,
  type SidebarPrefs,
} from "../lib/sidebar";

export type SidebarApi = {
  open: boolean;
  /** Width to render: the stored choice clamped to the live viewport. */
  width: number;
  /** Widest the sidebar may be in this viewport (for the resize handle). */
  maxWidth: number;
  toggle: () => void;
  /** Keep a new width (clamped 240..440). Call on pointer-up, not per move. */
  setWidth: (width: number) => void;
  /** Back to 296, open state unchanged. */
  reset: () => void;
};

function viewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

/** Account-sidebar state: open/collapsed and width, persisted per device in
 *  `lavega.sidebar`. Storage failures are silent; state then lives in memory. */
export function useSidebar(): SidebarApi {
  const [prefs, setPrefs] = useState<SidebarPrefs>(() => readSidebar(viewportWidth()));
  const [viewport, setViewport] = useState<number>(viewportWidth);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const update = useCallback((change: (p: SidebarPrefs) => SidebarPrefs) => {
    setPrefs((p) => {
      const next = change(p);
      writeSidebar(next);
      return next;
    });
  }, []);

  const toggle = useCallback(() => update((p) => ({ ...p, open: !p.open })), [update]);
  const setWidth = useCallback(
    (width: number) => update((p) => ({ ...p, width: clampStoredWidth(width) })),
    [update],
  );
  const reset = useCallback(
    () => update((p) => ({ ...p, width: SIDEBAR_DEFAULT_WIDTH })),
    [update],
  );

  return {
    open: prefs.open,
    width: clampWidth(prefs.width, viewport),
    maxWidth: maxWidthFor(viewport),
    toggle,
    setWidth,
    reset,
  };
}
