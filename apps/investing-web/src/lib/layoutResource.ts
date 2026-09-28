import { useEffect, useRef, useState } from "react";
import type { InvestingLayout, InvestingModuleId, InvestingWidgetId } from "@lavega/core";
import { HOME_MODULE, resolveModules, resolveWidgets } from "./investingRegistry.js";

type LayoutState = {
  status: "loading" | "ready";
  layout: InvestingLayout;
  saveError: string | null;
};

const SAVE_ERROR_MESSAGE = "Couldn't save — try again.";
const LOAD_ERROR_MESSAGE = "Couldn't load your settings — changes aren't saved yet.";
const LOAD_TIMEOUT_MS = 8_000;

const EMPTY_LAYOUT: InvestingLayout = { modules: {}, widgets: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Decodes only as much of the contract as this app reads. A shape it
 *  doesn't recognise resolves to registry defaults, exactly like a tenant
 *  who never chose. */
function decodeLayout(payload: unknown): InvestingLayout {
  if (!isRecord(payload)) return EMPTY_LAYOUT;
  return {
    modules: isRecord(payload.modules) ? (payload.modules as InvestingLayout["modules"]) : {},
    widgets: isRecord(payload.widgets) ? (payload.widgets as InvestingLayout["widgets"]) : {},
  };
}

/** Returns the stored layout, or null when the server's answer is unknown
 *  (non-2xx, unreadable body, network error, timeout). The caller must not
 *  save while it's unknown: a PUT would overwrite choices it never read. */
async function fetchLayout(): Promise<InvestingLayout | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    const response = await fetch("/api/investing/layout", { signal: controller.signal });
    if (!response.ok) return null;
    return decodeLayout(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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
 *  the GET has `loaded`, so a PUT never overwrites server choices the hook
 *  hasn't read; a `failed` load is retried by the next toggle. */
type SaveQueue = {
  load: "loading" | "loaded" | "failed";
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
    load: "loading",
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
    if (queue.load !== "loaded" || queue.inFlight || !queue.pending) return;
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

  function load() {
    const queue = queueRef.current;
    queue.load = "loading";
    void fetchLayout().then((serverLayout) => {
      if (serverLayout === null) {
        queue.load = "failed";
        queue.saveError = LOAD_ERROR_MESSAGE;
        render();
        return;
      }
      queue.load = "loaded";
      queue.confirmed = serverLayout;
      queue.saveError = null;
      if (queue.pending) {
        queue.pending = {
          modules: { ...serverLayout.modules, ...localEditsRef.current.modules },
          widgets: { ...serverLayout.widgets, ...localEditsRef.current.widgets },
        };
      }
      pump();
      render();
    });
  }

  useEffect(load, []);

  function applyChange<K extends "modules" | "widgets">(kind: K, next: InvestingLayout[K]) {
    const queue = queueRef.current;
    localEditsRef.current = { ...localEditsRef.current, [kind]: next };
    queue.pending = { ...displayed(queue), [kind]: next };
    if (queue.load === "failed") load();
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
