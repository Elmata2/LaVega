import { isArchivedWidget } from "../archive";
import type { WidgetId } from "../components/moduleRegistry";

/* The spans of the optional Home cards, so a row never has a hole.
 *
 * Home has two groups of optional cards, separated by the full-width
 * Statistieken block:
 *   head      the chart slot, with Positie beside it
 *   optional  Recente transacties, Betaalagenda, BTW, Facturen, Top uitgaven
 * Every row of a group sums to 3. Only this module knows what is on, so the
 * blocks take their span from here. Pure and local: no storage, no React. */

export type HomeSpans = Partial<Record<WidgetId | "chart", 1 | 2 | 3>>;

const OPTIONAL_ORDER: readonly WidgetId[] = [
  "recente-transacties",
  "betaalagenda",
  "btw-stand",
  "facturen-open",
  "top-uitgaven",
];

/** Pairs that keep today's proportions: first card 2, second card 1. */
const PAIRS: ReadonlyMap<WidgetId, WidgetId> = new Map([
  ["recente-transacties", "betaalagenda"],
  ["btw-stand", "facturen-open"],
]);

export function homeSpans(enabled: readonly WidgetId[]): HomeSpans {
  const on = new Set(enabled.filter((id) => !isArchivedWidget(id)));
  const spans: HomeSpans = on.has("positie") ? { chart: 2, positie: 1 } : { chart: 3 };

  const ids = OPTIONAL_ORDER.filter((id) => on.has(id));
  let i = 0;
  while (i < ids.length) {
    const id = ids[i]!;
    const next = ids[i + 1];
    if (next !== undefined && PAIRS.get(id) === next) {
      spans[id] = 2;
      spans[next] = 1;
      i += 2;
      continue;
    }
    // A single card pairs with the next one in page order, unless that one
    // starts a preferred pair of its own; then it stands alone at full width.
    const nextStartsPair = next !== undefined && PAIRS.has(next) && on.has(PAIRS.get(next)!);
    if (next === undefined || nextStartsPair) {
      spans[id] = 3;
      i += 1;
    } else {
      spans[id] = 2;
      spans[next] = 1;
      i += 2;
    }
  }
  return spans;
}
