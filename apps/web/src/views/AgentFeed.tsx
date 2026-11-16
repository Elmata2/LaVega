import { useCallback, useEffect, useId, useRef, useState } from "react";
import { agentApi, type AgentApi, type AgentFeedEvent } from "../api.js";
import { instinctCopy } from "../copy/instinct.js";
import type { Locale } from "../locale.js";
import type { View } from "../appRoutes.js";
import Button from "../components/ui/Button.js";
import Card, { CardHeader } from "../components/ui/Card.js";

/* Meldingen — what the daily message has sent, newest first. The same list
 * (AgentEventList) also sits in the settings under "what LaVega keeps", so
 * there is one implementation of loading, paging and deleting. */

const PAGE = 20;

const newestFirst = (a: AgentFeedEvent, b: AgentFeedEvent): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

export function AgentEventList({
  locale,
  api,
  channel,
  emptyText,
  label,
}: {
  locale: Locale;
  api: AgentApi;
  /** Absent: every channel, which is everything the server keeps. */
  channel?: string;
  emptyText: string;
  /** Accessible name of the list; defaults to the feed title. */
  label?: string;
}) {
  const c = instinctCopy[locale];
  const [events, setEvents] = useState<AgentFeedEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "signedOut" | "unavailable" | "error">(
    "loading",
  );
  const [more, setMore] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const alive = useRef(true);
  const idBase = useId();

  const load = useCallback(
    async (before?: string) => {
      const res = await api.listFeed({
        ...(channel ? { channel } : {}),
        ...(before ? { before } : {}),
        limit: PAGE,
      });
      if (!alive.current) return;
      if (res.kind !== "ok") {
        setState(res.kind);
        return;
      }
      setEvents((cur) => {
        const seen = new Set(cur.map((e) => e.id));
        const merged = before ? [...cur, ...res.events.filter((e) => !seen.has(e.id))] : res.events;
        return merged.sort(newestFirst);
      });
      setNext(res.next);
      setState("ok");
    },
    [api, channel],
  );

  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => load());
    return () => {
      alive.current = false;
    };
  }, [load]);

  async function loadMore() {
    if (!next) return;
    setMore(true);
    await load(next);
    if (alive.current) setMore(false);
  }

  async function remove(id: string) {
    setDeleteFailed(false);
    const ok = await api.deleteEvent(id);
    if (!alive.current) return;
    if (ok) setEvents((cur) => cur.filter((e) => e.id !== id));
    else setDeleteFailed(true);
  }

  const when = new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  if (state === "loading") return <p className="cell-sub">{c.loading}</p>;
  if (state === "signedOut") return <p role="alert">{c.signInNeeded}</p>;
  if (state === "unavailable") return <p role="alert">{c.feed.unavailable}</p>;
  if (state === "error")
    return (
      <p role="alert" className="text-warn">
        {c.feed.loadFailed}
      </p>
    );
  return (
    <>
      {events.length === 0 ? (
        <p className="cell-sub">{emptyText}</p>
      ) : (
        <ul aria-label={label ?? c.feed.title} className="m-0 list-none p-0">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-start justify-between gap-3 border-b border-line py-3"
            >
              <div>
                <p id={`${idBase}-${e.id}`} className="m-0">
                  {e.body.text}
                </p>
                <p className="cell-sub m-0">
                  <time dateTime={e.createdAt}>{when.format(new Date(e.createdAt))}</time>
                </p>
              </div>
              <Button
                aria-label={c.deleteItem}
                aria-describedby={`${idBase}-${e.id}`}
                onClick={() => void remove(e.id)}
              >
                {c.deleteItem}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {deleteFailed && (
        <p role="alert" className="text-warn">
          {c.feed.deleteFailed}
        </p>
      )}
      {next && (
        <Button onClick={() => void loadMore()} disabled={more}>
          {c.feed.loadMore}
        </Button>
      )}
    </>
  );
}

/* The WhatsApp conversation LaVega keeps, with one action that deletes all of it.
 * The confirm destroys data: focus goes to the safe button on open and back to
 * the trigger on cancel or after the delete. No motion, on purpose. */
export function WhatsappConversation({ locale, api }: { locale: Locale; api: AgentApi }) {
  const c = instinctCopy[locale];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [round, setRound] = useState(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const alive = useRef(true);
  const id = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = confirming;
  }, [confirming]);

  async function remove() {
    setBusy(true);
    setStatus("");
    const ok = await api.deleteConversation("whatsapp");
    if (!alive.current) return;
    setBusy(false);
    setStatus(ok ? c.feed.conversationDeleted : c.feed.conversationDeleteFailed);
    if (ok) setRound((n) => n + 1);
    setConfirming(false);
  }

  return (
    <section aria-label={c.feed.whatsappTitle}>
      <h3>{c.feed.whatsappTitle}</h3>
      <AgentEventList
        key={round}
        locale={locale}
        api={api}
        channel="whatsapp"
        emptyText={c.feed.whatsappEmpty}
        label={c.feed.whatsappTitle}
      />
      <p>
        <Button ref={triggerRef} disabled={busy || confirming} onClick={() => setConfirming(true)}>
          {c.feed.deleteConversation}
        </Button>
      </p>
      {confirming && (
        <div
          role="alertdialog"
          aria-label={c.feed.deleteConversation}
          aria-describedby={`${id}-confirm`}
        >
          <p id={`${id}-confirm`}>{c.feed.deleteConversationConfirm}</p>
          <Button variant="primary" disabled={busy} onClick={() => void remove()}>
            {c.feed.deleteConversationYes}
          </Button>{" "}
          <Button ref={cancelRef} disabled={busy} onClick={() => setConfirming(false)}>
            {c.feed.deleteConversationNo}
          </Button>
        </div>
      )}
      <p role="status" className="cell-sub">
        {status}
      </p>
    </section>
  );
}

export default function AgentFeed({
  locale,
  api = agentApi,
  onNavigate,
}: {
  locale: Locale;
  api?: AgentApi;
  onNavigate?: (view: View) => void;
}) {
  const c = instinctCopy[locale];
  return (
    <Card as="section" aria-label={c.feed.title}>
      <CardHeader>
        <h2>{c.feed.title}</h2>
      </CardHeader>
      <p className="cell-sub">{c.feed.intro}</p>
      <AgentEventList locale={locale} api={api} channel="feed" emptyText={c.feed.empty} />
      <WhatsappConversation locale={locale} api={api} />
      {onNavigate && (
        <p>
          <Button onClick={() => onNavigate("profiel")}>{c.feed.settingsLink}</Button>
        </p>
      )}
    </Card>
  );
}
