import { useSyncExternalStore } from "react";
import type { InvestingLayout, InvestingModuleId, InvestingWidgetId } from "@lavega/core";
import { HOME_MODULE, resolveModules, resolveWidgets } from "./investingRegistry.js";

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

type LayoutSnapshot = Omit<InvestingLayoutResource, "setModules" | "setWidgets">;

/** The save pipeline, single-flight: at most one PUT is ever on the wire.
 *  `confirmed` is what the server holds; `inFlight` is the body of the PUT
 *  now outstanding; `pending` is the newest desired layout waiting its turn,
 *  so any number of toggles made during one PUT coalesce into the next. What
 *  the reader sees is always the newest of the three. Nothing is sent until
 *  the GET has `loaded`, so a PUT never overwrites server choices the store
 *  hasn't read; a `failed` load is retried by the next toggle. */
type SaveQueue = {
  load: "idle" | "loading" | "loaded" | "failed";
  confirmed: InvestingLayout;
  inFlight: InvestingLayout | null;
  pending: InvestingLayout | null;
  saveError: string | null;
};

function displayed(queue: SaveQueue): InvestingLayout {
  return queue.pending ?? queue.inFlight ?? queue.confirmed;
}

/** One layout per app: the top bar, every module route and the profile page
 *  must agree, so they all read this store instead of each owning a copy.
 *  The first subscriber starts the GET. The queue keeps draining with no
 *  subscribers, so an edit is never dropped by navigating away. */
function createLayoutStore() {
  const queue: SaveQueue = {
    load: "idle",
    confirmed: EMPTY_LAYOUT,
    inFlight: null,
    pending: null,
    saveError: null,
  };
  /* Only the reader's explicit choices, so the GET merges under them. */
  let localEdits: InvestingLayout = { modules: {}, widgets: {} };
  let snapshot: LayoutSnapshot = {
    status: "loading",
    modules: resolveModules({}),
    widgets: resolveWidgets({}),
    saveError: null,
  };
  const listeners = new Set<() => void>();

  function publish() {
    const layout = displayed(queue);
    snapshot = {
      status: "ready",
      modules: resolveModules(layout.modules),
      widgets: resolveWidgets(layout.widgets),
      saveError: queue.saveError,
    };
    for (const listener of listeners) listener();
  }

  function pump() {
    if (queue.load !== "loaded" || queue.inFlight || !queue.pending) return;
    const sent = queue.pending;
    queue.inFlight = sent;
    queue.pending = null;
    void putLayout(sent).then((ok) => {
      queue.inFlight = null;
      if (ok) queue.confirmed = sent;
      if (!queue.pending) queue.saveError = ok ? null : SAVE_ERROR_MESSAGE;
      pump();
      publish();
    });
  }

  function load() {
    queue.load = "loading";
    void fetchLayout().then((serverLayout) => {
      if (serverLayout === null) {
        queue.load = "failed";
        queue.saveError = LOAD_ERROR_MESSAGE;
        publish();
        return;
      }
      queue.load = "loaded";
      queue.confirmed = serverLayout;
      queue.saveError = null;
      if (queue.pending) {
        queue.pending = {
          modules: { ...serverLayout.modules, ...localEdits.modules },
          widgets: { ...serverLayout.widgets, ...localEdits.widgets },
        };
      }
      pump();
      publish();
    });
  }

  function applyChange<K extends "modules" | "widgets">(kind: K, next: InvestingLayout[K]) {
    localEdits = { ...localEdits, [kind]: next };
    queue.pending = { ...displayed(queue), [kind]: next };
    if (queue.load === "idle" || queue.load === "failed") load();
    pump();
    publish();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (queue.load === "idle") load();
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    setModules: (next: Partial<Record<InvestingModuleId, boolean>>) =>
      applyChange("modules", next),
    setWidgets: (next: Partial<Record<InvestingWidgetId, boolean>>) =>
      applyChange("widgets", next),
  };
}

let store: ReturnType<typeof createLayoutStore> | null = null;

function layoutStore() {
  store ??= createLayoutStore();
  return store;
}

/** Tests mount many apps in one module instance; each needs a fresh store. */
export function resetInvestingLayoutStoreForTests() {
  store = null;
}

export function useInvestingLayout(): InvestingLayoutResource {
  const current = layoutStore();
  const snapshot = useSyncExternalStore(current.subscribe, current.getSnapshot);
  return { ...snapshot, setModules: current.setModules, setWidgets: current.setWidgets };
}
