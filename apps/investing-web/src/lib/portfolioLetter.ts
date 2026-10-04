import { useEffect, useState } from "react";

/* Client side of /api/letters. The page only reads: the letter is written by
 * the broker-sync cron, never on page load. The type mirrors PortfolioLetter in
 * @lavega/database, which a browser bundle cannot import. */

export type PortfolioLetter = {
  id: string;
  snapshotHash: string;
  holdingsHash: string;
  createdAt: string;
  verdict: string;
  observations: Array<{ title: string; body: string; figures: string[] }>;
};

export type LetterState =
  | { status: "loading" }
  | { status: "ready"; letter: PortfolioLetter }
  | { status: "empty" }
  | { status: "error"; message: string };

const isString = (value: unknown): value is string => typeof value === "string";

function isPortfolioLetter(value: unknown): value is PortfolioLetter {
  if (typeof value !== "object" || value === null) return false;
  const letter = value as Record<string, unknown>;
  return (
    isString(letter.id) &&
    isString(letter.createdAt) &&
    isString(letter.verdict) &&
    Array.isArray(letter.observations) &&
    letter.observations.every(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        isString((item as Record<string, unknown>).title) &&
        isString((item as Record<string, unknown>).body) &&
        Array.isArray((item as Record<string, unknown>).figures) &&
        ((item as Record<string, unknown>).figures as unknown[]).every(isString),
    )
  );
}

async function fetchLatestLetter(signal: AbortSignal): Promise<PortfolioLetter | null> {
  let response: Response;
  try {
    response = await fetch("/api/letters/latest", { signal });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
    throw new Error("Failed to load letter: network error.");
  }
  if (!response.ok) throw new Error(`Failed to load letter: ${response.status}`);
  const payload: unknown = await response.json().catch(() => undefined);
  const letter = (payload as { letter?: unknown } | undefined)?.letter;
  if (letter === null) return null;
  if (!isPortfolioLetter(letter)) throw new Error("Letter has an invalid format.");
  return letter;
}

/** Reads the stored letter once per mount. It never asks the server to make one. */
export function useLatestLetter(enabled = true): LetterState {
  const [state, setState] = useState<LetterState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchLatestLetter(controller.signal)
      .then((letter) => {
        if (!controller.signal.aborted)
          setState(letter ? { status: "ready", letter } : { status: "empty" });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: reason instanceof Error ? reason.message : "Failed to load letter",
        });
      });
    return () => controller.abort();
  }, [enabled]);
  return state;
}

/** The letter as plain text, the first message of a Munger thread. */
export function letterToText(letter: PortfolioLetter): string {
  return [
    "Charlie, you wrote me this letter about my portfolio. Let us discuss it.",
    letter.verdict,
    ...letter.observations.map(
      (item, index) =>
        `${index + 1}. ${item.title}. ${item.body}${item.figures.length ? ` (${item.figures.join("; ")})` : ""}`,
    ),
  ].join("\n\n");
}
