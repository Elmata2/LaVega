import { useEffect, useState } from "react";
import type { InvestingLayout, InvestingModuleId, InvestingWidgetId } from "@lavega/core";
import { HOME_MODULE, resolveModules, resolveWidgets } from "./investingRegistry.js";

type LayoutState = {
  status: "loading" | "ready";
  layout: InvestingLayout;
};

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

async function putLayout(layout: InvestingLayout): Promise<void> {
  try {
    await fetch("/api/investing/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(layout),
    });
  } catch {
    // A failed save leaves the previous server-side choice in place; the
    // local optimistic update still reflects what the reader just did.
  }
}

export type InvestingLayoutResource = {
  status: "loading" | "ready";
  modules: Array<InvestingModuleId | typeof HOME_MODULE>;
  widgets: InvestingWidgetId[];
  setModules: (next: Partial<Record<InvestingModuleId, boolean>>) => void;
  setWidgets: (next: Partial<Record<InvestingWidgetId, boolean>>) => void;
};

export function useInvestingLayout(): InvestingLayoutResource {
  const [state, setState] = useState<LayoutState>({ status: "loading", layout: EMPTY_LAYOUT });

  useEffect(() => {
    let current = true;
    void fetchLayout().then((layout) => {
      if (current) setState({ status: "ready", layout });
    });
    return () => {
      current = false;
    };
  }, []);

  function setModules(next: Partial<Record<InvestingModuleId, boolean>>) {
    setState((previous) => ({ status: "ready", layout: { ...previous.layout, modules: next } }));
    void putLayout({ ...state.layout, modules: next });
  }

  function setWidgets(next: Partial<Record<InvestingWidgetId, boolean>>) {
    setState((previous) => ({ status: "ready", layout: { ...previous.layout, widgets: next } }));
    void putLayout({ ...state.layout, widgets: next });
  }

  return {
    status: state.status,
    modules: resolveModules(state.layout.modules),
    widgets: resolveWidgets(state.layout.widgets),
    setModules,
    setWidgets,
  };
}
