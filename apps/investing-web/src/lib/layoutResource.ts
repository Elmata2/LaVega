import { useEffect, useRef, useState } from "react";
import type { InvestingLayout, InvestingModuleId, InvestingWidgetId } from "@lavega/core";
import { HOME_MODULE, resolveModules, resolveWidgets } from "./investingRegistry.js";

type LayoutState = {
  status: "loading" | "ready";
  layout: InvestingLayout;
  saveError: string | null;
};

const SAVE_ERROR_MESSAGE = "Couldn't save — try again.";

const EMPTY_LAYOUT: InvestingLayout = { modules: {}, widgets: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Decodes only as much of the contract as this app reads. Any other shape —
 *  including a 401/500 body — falls back to EMPTY_LAYOUT, which resolves to
 *  registry defaults exactly like a tenant who never chose. A layout
 *  preference failing to load must never blank the shell (spec §5). */
function decodeLayout(payload: unknown): InvestingLayout {
  if (!isRecord(payload)) return EMPTY_LAYOUT;
  return {
    modules: isRecord(payload.modules) ? (payload.modules as InvestingLayout["modules"]) : {},
    widgets: isRecord(payload.widgets) ? (payload.widgets as InvestingLayout["widgets"]) : {},
  };
}

async function fetchLayout(): Promise<InvestingLayout> {
  try {
    const response = await fetch("/api/investing/layout");
    if (!response.ok) return EMPTY_LAYOUT;
    return decodeLayout(await response.json().catch(() => null));
  } catch {
    return EMPTY_LAYOUT;
  }
}

/** Returns whether the save reached the server. A failure never throws:
 *  the caller decides what "the previous choice" means (spec §5 — a save
 *  failure must not blank the shell, and now must not lie about having
 *  saved either). */
async function putLayout(layout: InvestingLayout): Promise<boolean> {
  try {
    const response = await fetch("/api/investing/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(layout),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type InvestingLayoutResource = {
  status: "loading" | "ready";
  modules: Array<InvestingModuleId | typeof HOME_MODULE>;
  widgets: InvestingWidgetId[];
  setModules: (next: Partial<Record<InvestingModuleId, boolean>>) => void;
  setWidgets: (next: Partial<Record<InvestingWidgetId, boolean>>) => void;
  saveError: string | null;
};

export function useInvestingLayout(): InvestingLayoutResource {
  const [state, setState] = useState<LayoutState>({
    status: "loading",
    layout: EMPTY_LAYOUT,
    saveError: null,
  });

  /* The three refs below exist because closures over `state` go stale the
   * instant a second call — the initial GET, or a second toggle — lands
   * before the first setState has re-rendered:
   *  - layoutRef mirrors the optimistic layout the reader is looking at, so
   *    a PUT body always reflects every edit made so far, not just the one
   *    that triggered it.
   *  - confirmedRef is the last layout the server actually has, so a failed
   *    save has something honest to revert to.
   *  - localEditsRef is only the reader's own explicit choices (never the
   *    server's), so a slow initial GET can merge underneath them instead
   *    of overwriting a toggle made while it was still in flight. */
  const layoutRef = useRef<InvestingLayout>(EMPTY_LAYOUT);
  const confirmedRef = useRef<InvestingLayout>(EMPTY_LAYOUT);
  const localEditsRef = useRef<InvestingLayout>({ modules: {}, widgets: {} });

  useEffect(() => {
    let current = true;
    void fetchLayout().then((serverLayout) => {
      if (!current) return;
      const merged: InvestingLayout = {
        modules: { ...serverLayout.modules, ...localEditsRef.current.modules },
        widgets: { ...serverLayout.widgets, ...localEditsRef.current.widgets },
      };
      confirmedRef.current = merged;
      layoutRef.current = merged;
      setState((previous) => ({ status: "ready", layout: merged, saveError: previous.saveError }));
    });
    return () => {
      current = false;
    };
  }, []);

  function applyChange<K extends "modules" | "widgets">(kind: K, next: InvestingLayout[K]) {
    const nextLayout: InvestingLayout = { ...layoutRef.current, [kind]: next };
    layoutRef.current = nextLayout;
    localEditsRef.current = { ...localEditsRef.current, [kind]: next };
    setState((previous) => ({ status: "ready", layout: nextLayout, saveError: previous.saveError }));
    void putLayout(nextLayout).then((ok) => {
      if (ok) {
        confirmedRef.current = nextLayout;
        setState((previous) => ({ ...previous, saveError: null }));
        return;
      }
      layoutRef.current = confirmedRef.current;
      setState({ status: "ready", layout: confirmedRef.current, saveError: SAVE_ERROR_MESSAGE });
    });
  }

  function setModules(next: Partial<Record<InvestingModuleId, boolean>>) {
    applyChange("modules", next);
  }

  function setWidgets(next: Partial<Record<InvestingWidgetId, boolean>>) {
    applyChange("widgets", next);
  }

  return {
    status: state.status,
    modules: resolveModules(state.layout.modules),
    widgets: resolveWidgets(state.layout.widgets),
    setModules,
    setWidgets,
    saveError: state.saveError,
  };
}
