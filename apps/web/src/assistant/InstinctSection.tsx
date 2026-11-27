import { useEffect, useState, type ReactNode } from "react";
import type { AgentFeedEvent } from "../api.js";
import type { AgentStatus } from "../agent/useAgentMirror.js";
import type { FeedStore } from "../agent/feedStore.js";
import { AgentEventItem, eventDateFormat } from "../components/AgentEventItem.js";
import Button from "../components/ui/Button.js";
import { assistantCopy } from "../copy/assistant.js";
import type { Locale } from "../locale.js";

/* The daily Instinct messages, above the chat. Quiet by design: it says nothing
 * while loading, and nothing at all when Instinct cannot be used (no account,
 * server not configured, signed out). The panel hands this component only what
 * a signed-in account can reach; without `instinct` the panel never mounts it,
 * so a device vault makes no request. Rows are the `meldingen` view's rows
 * (AgentEventItem), without the delete action: deleting stays in the full view. */

const SHOWN = 3;
/* Three rows need about 700 px of height to leave the chat input in view; on a
 * shorter screen (a phone, a small window) the third row is hidden. */
const SHORT_SCREEN_HIDE = "[@media(max-height:699px)]:hidden";

export type InstinctPanelProps = {
  status: AgentStatus;
  store: FeedStore;
  /** Opens the `meldingen` view. */
  onOpenFeed: () => void;
  /** Opens Profiel, where the daily message is switched on. */
  onOpenSettings: () => void;
};

type Load =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "ok"; events: AgentFeedEvent[] };

const newestFirst = (a: AgentFeedEvent, b: AgentFeedEvent): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

export function InstinctSection({
  locale,
  status,
  store,
  onOpenFeed,
  onOpenSettings,
}: InstinctPanelProps & { locale: Locale }) {
  const copy = assistantCopy[locale].instinct;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [round, setRound] = useState(0);
  const reading = status === "on";
  const [wasReading, setWasReading] = useState(reading);
  if (wasReading !== reading) {
    setWasReading(reading);
    if (!reading) setLoad({ kind: "loading" });
  }

  useEffect(() => {
    if (!reading) return;
    let live = true;
    void store.firstPage({ force: round > 0 }).then((res) => {
      if (!live) return;
      if (res.kind === "ok") setLoad({ kind: "ok", events: [...res.events].sort(newestFirst) });
      else if (res.kind === "error") setLoad({ kind: "error" });
      else setLoad({ kind: "none" });
    });
    return () => {
      live = false;
    };
  }, [reading, store, round]);

  /* A delete or a turn-off elsewhere empties the store: read again. */
  useEffect(() => {
    if (!reading) return;
    return store.subscribe(() => setRound((n) => n + 1));
  }, [reading, store]);

  const wrap = (children: ReactNode) => (
    <section
      data-testid="instinct-section"
      aria-labelledby="instinct-heading"
      className="flex shrink-0 flex-col gap-1"
    >
      <h3 id="instinct-heading" className="text-sm font-semibold text-ink">
        {copy.title}
      </h3>
      {children}
    </section>
  );
  const quiet = (text: string) => <p className="m-0 text-sm text-muted">{text}</p>;
  const action = "min-h-11 self-start py-1.5 text-sm font-semibold";

  if (status === "off")
    return wrap(
      <>
        {quiet(copy.off)}
        <Button onClick={onOpenSettings} className={action}>
          {copy.turnOn}
        </Button>
      </>,
    );
  if (!reading || load.kind === "loading" || load.kind === "none") return null;
  if (load.kind === "error")
    return wrap(
      <>
        {quiet(copy.failed)}
        <Button onClick={() => setRound((n) => n + 1)} className={action}>
          {copy.retry}
        </Button>
      </>,
    );
  if (load.events.length === 0) return wrap(quiet(copy.empty));
  const format = eventDateFormat(locale);
  return wrap(
    <>
      <ul aria-label={copy.title} className="m-0 list-none p-0 text-sm">
        {load.events.slice(0, SHOWN).map((e, i) => (
          <AgentEventItem
            key={e.id}
            event={e}
            format={format}
            clamp
            className={i === SHOWN - 1 ? SHORT_SCREEN_HIDE : ""}
          />
        ))}
      </ul>
      <Button onClick={onOpenFeed} className={action}>
        {copy.all}
      </Button>
    </>,
  );
}
