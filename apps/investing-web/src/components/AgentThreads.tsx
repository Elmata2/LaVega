import { useEffect, useRef, useState } from "react";
import { deleteThread, fetchThreads, type ThreadSummary } from "../lib/agentMemory.js";
import { Button } from "@lavega/ui";
import { longDate } from "../lib/dates.js";

type ThreadsPhase =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "error"; message: string }
  | { kind: "ready"; threads: ThreadSummary[] };

/* A persona's saved conversations: reopen one, start a new one, or delete
 * one. Deleting a thread also deletes what the agent noted from it, never a
 * thesis or a goal. Hidden when the server has no memory. */
export function AgentThreads({
  agentId,
  activeThreadId,
  refreshKey,
  onOpen,
  onNew,
  onDeleted,
}: {
  agentId: string;
  activeThreadId: string;
  refreshKey: string;
  onOpen: (threadId: string) => void;
  onNew: () => void;
  onDeleted: (threadId: string) => void;
}) {
  const [phase, setPhase] = useState<ThreadsPhase>({ kind: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void fetchThreads(agentId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setPhase(next === null ? { kind: "disabled" } : { kind: "ready", threads: next });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setPhase({
          kind: "error",
          message: reason instanceof Error ? reason.message : "Conversations could not be loaded.",
        });
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [agentId, refreshKey]);

  if (phase.kind === "loading" || phase.kind === "disabled") return null;

  if (phase.kind === "error")
    return (
      <div className="mb-5 border-b border-border pb-5">
        <h3 className="font-display text-3xl">Conversations</h3>
        <p role="alert" className="mt-2 text-xs text-negative">
          {phase.message}
        </p>
      </div>
    );

  const { threads } = phase;

  async function remove(threadId: string) {
    if (deleting !== null) return;
    setDeleting(threadId);
    setDeleteError(null);
    try {
      await deleteThread(threadId);
      if (!mountedRef.current) return;
      setPhase((current) =>
        current.kind === "ready"
          ? { kind: "ready", threads: current.threads.filter((thread) => thread.id !== threadId) }
          : current,
      );
      setConfirming(null);
      onDeleted(threadId);
    } catch (reason) {
      if (mountedRef.current)
        setDeleteError(
          reason instanceof Error ? reason.message : "Conversation could not be deleted.",
        );
    } finally {
      if (mountedRef.current) setDeleting(null);
    }
  }

  return (
    <div className="mb-5 border-b border-border pb-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-3xl">Conversations</h3>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onNew}>
          New conversation
        </Button>
      </div>
      {threads.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No saved conversations yet.</p>
      ) : (
        <ul className="mt-3 max-h-60 space-y-1.5 overflow-y-auto pr-1">
          {threads.map((thread) => (
            <li
              key={thread.id}
              className={`flex items-center gap-2 rounded-tile px-3 py-2 ${thread.id === activeThreadId ? "bg-secondary" : "bg-secondary/60"}`}
            >
              <button
                type="button"
                onClick={() => onOpen(thread.id)}
                aria-current={thread.id === activeThreadId ? "true" : undefined}
                className="pressable min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-semibold">{thread.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {longDate(thread.updatedAt.slice(0, 10))}
                </span>
              </button>
              {confirming === thread.id ? (
                <button
                  type="button"
                  disabled={deleting !== null}
                  onClick={() => void remove(thread.id)}
                  onBlur={() => setConfirming(null)}
                  className="pressable shrink-0 text-xs font-semibold text-negative hover:underline disabled:opacity-50"
                >
                  {deleting === thread.id ? "Deleting…" : "Confirm delete"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={deleting !== null}
                  onClick={() => setConfirming(thread.id)}
                  aria-label={`Delete conversation ${thread.title}`}
                  className="pressable shrink-0 text-xs font-semibold text-muted-foreground hover:text-negative disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleteError && (
        <p role="alert" className="mt-2 text-xs text-negative">
          {deleteError}
        </p>
      )}
    </div>
  );
}
