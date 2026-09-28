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

/** The save pipeline, single-flight: at most one PUT is ever on the wire.
 *  `confirmed` is what the server holds; `inFlight` is the body of the PUT
 *  now outstanding; `pending` is the newest desired layout waiting its turn,
 *  so any number of toggles made during one PUT coalesce into the next. What
 *  the reader sees is always the newest of the three. Nothing is sent until
 *  the initial GET settles, so a PUT never overwrites server choices the
 *  hook hasn't read yet. */
type SaveQueue = {
  loaded: boolean;
  confirmed: InvestingLayout;
  inFlight: InvestingLayout | null;
  pending: InvestingLayout | null;
  saveError: string | null;
};

function displayed(queue: SaveQueue): InvestingLayout {
  return queue.pending ?? queue.inFlight ?? queue.confirmed;
}

export function useInvestingLayout(): InvestingLayoutResource {
  const [state, setState] = useState<LayoutState>({
    status: "loading",
    layout: EMPTY_LAYOUT,
    saveError: null,
  });

  /* A ref, not state: a second toggle can land before the first one's
   * setState re-renders, and it must build on the first. localEditsRef is
   * only the reader's explicit choices, so the initial GET merges under them.
   * The queue keeps draining after unmount so an edit is never dropped;
   * mountedRef only stops the setState. */
  const queueRef = useRef<SaveQueue>({
    loaded: false,
    confirmed: EMPTY_LAYOUT,
    inFlight: null,
    pending: null,
    saveError: null,
  });
  const localEditsRef = useRef<InvestingLayout>({ modules: {}, widgets: {} });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function render() {
    if (!mountedRef.current) return;
    const queue = queueRef.current;
    setState({ status: "ready", layout: displayed(queue), saveError: queue.saveError });
  }

  function pump() {
    const queue = queueRef.current;
    if (!queue.loaded || queue.inFlight || !queue.pending) return;
    const sent = queue.pending;
    queue.inFlight = sent;
    queue.pending = null;
    void putLayout(sent).then((ok) => {
      queue.inFlight = null;
      if (ok) queue.confirmed = sent;
      if (!queue.pending) queue.saveError = ok ? null : SAVE_ERROR_MESSAGE;
      pump();
      render();
    });
  }

  useEffect(() => {
    void fetchLayout().then((serverLayout) => {
      const queue = queueRef.current;
      queue.loaded = true;
      queue.confirmed = serverLayout;
      if (queue.pending) {
        queue.pending = {
          modules: { ...serverLayout.modules, ...localEditsRef.current.modules },
          widgets: { ...serverLayout.widgets, ...localEditsRef.current.widgets },
        };
      }
      pump();
      render();
    });
  }, []);

  function applyChange<K extends "modules" | "widgets">(kind: K, next: InvestingLayout[K]) {
    const queue = queueRef.current;
    localEditsRef.current = { ...localEditsRef.current, [kind]: next };
    queue.pending = { ...displayed(queue), [kind]: next };
    pump();
    render();
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
