import { useCallback, useEffect, useState } from "react";
import type { SectorCoverage, SectorExposure } from "@lavega/core";

export type SectorReadData = {
  sectors: SectorExposure[];
  sectorCoverage: SectorCoverage;
  /** The sector-store revision the server resolved against. A correction or
   *  inference-setting write raises it; the dashboard's data version does not. */
  revision: number;
};

export type SectorState =
  | { status: "loading" }
  | { status: "ready"; data: SectorReadData }
  | { status: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSectorExposure(value: unknown): value is SectorExposure {
  return isRecord(value) && typeof value.sector === "string" && typeof value.weight === "number";
}

function isSectorCoverage(value: unknown): value is SectorCoverage {
  return (
    isRecord(value) &&
    typeof value.provider === "number" &&
    typeof value.inferred === "number" &&
    typeof value.correction === "number" &&
    typeof value.unknown === "number"
  );
}

/** Decodes the network contract; a payload missing a field is rejected rather
 *  than rendered as if it were empty. */
function isSectorReadData(value: unknown): value is SectorReadData {
  return (
    isRecord(value) &&
    Array.isArray(value.sectors) &&
    value.sectors.every(isSectorExposure) &&
    isSectorCoverage(value.sectorCoverage) &&
    typeof value.revision === "number"
  );
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

async function fetchSectors(signal: AbortSignal): Promise<SectorReadData> {
  let response: Response;
  try {
    response = await fetch("/api/investing/sectors", { signal });
  } catch (reason) {
    if (isAbortError(reason)) throw reason;
    throw new Error("Failed to load sectors: network error.");
  }
  if (!response.ok) throw new Error(`Failed to load sectors: ${response.status}`);
  const payload: unknown = await response.json().catch(() => undefined);
  if (!isSectorReadData(payload)) throw new Error("Sectors have an invalid format.");
  return payload;
}

/**
 * Owns the sector read for one page. It loads on mount and again when
 * `reloadKey` (the dashboard version the page is showing) or an explicit
 * refresh changes: sector exposure is weighted over the current positions, so
 * it follows a new dashboard, while a correction or inference-setting write is
 * picked up by the server's revision key and the refresh that follows it.
 * `enabled` skips the request entirely while no sector widget is on screen.
 */
export function useSectors(
  enabled: boolean,
  reloadKey: string,
): { state: SectorState; refresh: () => void } {
  const [refreshes, setRefreshes] = useState(0);
  const requestKey = JSON.stringify([reloadKey, refreshes, enabled]);
  const [state, setState] = useState<{ key: string; result: SectorState }>({
    key: "",
    result: { status: "loading" },
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchSectors(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key: requestKey, result: { status: "ready", data } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setState({
          key: requestKey,
          result: {
            status: "error",
            message: reason instanceof Error ? reason.message : "Failed to load sectors",
          },
        });
      });
    return () => controller.abort();
  }, [requestKey, enabled]);
  const refresh = useCallback(() => setRefreshes((value) => value + 1), []);
  return {
    state: state.key === requestKey ? state.result : { status: "loading" },
    refresh,
  };
}
