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

  /* The refs below exist because closures over `state` go stale the instant
   * a second call — the initial GET, or a second toggle — lands before the
   * first setState has re-rendered:
   *  - layoutRef mirrors the optimistic layout the reader is looking at, so
   *    a PUT body always reflects every edit made so far, not just the one
   *    that triggered it.
   *  - confirmedRef is the last layout the server actually has, so a failed
   *    save has something honest to revert to.
   *  - localEditsRef is only the reader's own explicit choices (never the
   *    server's), so a slow initial GET can merge underneath them instead
   *    of overwriting a toggle made while it was still in flight.
   *  - saveSeqRef numbers every PUT this hook sends, so a response can tell
   *    whether it belongs to the toggle the reader is currently looking at
   *    (the latest one issued) or an earlier one a later toggle has since
   *    superseded.
   *  - confirmedSeqRef is the sequence number of whichever PUT most
   *    recently confirmed confirmedRef. A *success* is real, permanent
   *    server state the instant it arrives, however late — dropping it
   *    entirely (as an older-response check alone would) would forget a
   *    save that did land. So any success newer than confirmedSeqRef still
   *    updates confirmedRef, even out of order; only a *failure* is
   *    ignored when it isn't the latest request, since an old failure says
   *    nothing about whether a newer edit saved. Only the latest request,
   *    success or failure, is allowed to touch what's on screen
   *    (state.layout/saveError) — an older success updates the fallback
   *    silently, an older failure is simply stale news.
   *  - mountedRef guards every async continuation against running after
   *    unmount, for both the initial GET and every PUT. */
  const layoutRef = useRef<InvestingLayout>(EMPTY_LAYOUT);
  const confirmedRef = useRef<InvestingLayout>(EMPTY_LAYOUT);
  const confirmedSeqRef = useRef(0);
  const localEditsRef = useRef<InvestingLayout>({ modules: {}, widgets: {} });
  const saveSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void fetchLayout().then((serverLayout) => {
      if (!mountedRef.current) return;
      const merged: InvestingLayout = {
        modules: { ...serverLayout.modules, ...localEditsRef.current.modules },
        widgets: { ...serverLayout.widgets, ...localEditsRef.current.widgets },
      };
      confirmedRef.current = merged;
      layoutRef.current = merged;
      setState((previous) => ({ status: "ready", layout: merged, saveError: previous.saveError }));
    });
  }, []);

  function applyChange<K extends "modules" | "widgets">(kind: K, next: InvestingLayout[K]) {
    const nextLayout: InvestingLayout = { ...layoutRef.current, [kind]: next };
    layoutRef.current = nextLayout;
    localEditsRef.current = { ...localEditsRef.current, [kind]: next };
    setState((previous) => ({ status: "ready", layout: nextLayout, saveError: previous.saveError }));

    const mySeq = ++saveSeqRef.current;
    void putLayout(nextLayout).then((ok) => {
      if (!mountedRef.current) return;
      const isLatest = mySeq === saveSeqRef.current;
      if (ok) {
        // A success is real server state the moment it arrives, however
        // late — record it as long as nothing newer already has, but only
        // touch what's on screen if this was the request the reader is
        // still waiting on.
        if (mySeq > confirmedSeqRef.current) {
          confirmedRef.current = nextLayout;
          confirmedSeqRef.current = mySeq;
        }
        if (isLatest) setState((previous) => ({ ...previous, saveError: null }));
        return;
      }
      if (!isLatest) return; // superseded by a later toggle
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
