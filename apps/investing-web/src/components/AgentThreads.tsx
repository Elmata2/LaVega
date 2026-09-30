import { useEffect, useState } from "react";
import { deleteThread, fetchThreads, type ThreadSummary } from "../lib/agentMemory.js";
import { Button } from "./ui/button.js";
import { longDate } from "../lib/dates.js";

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
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetchThreads(agentId)
      .then((next) => current && setThreads(next))
      .catch(() => current && setThreads(null));
    return () => {
      current = false;
    };
  }, [agentId, refreshKey]);

  if (!threads) return null;

  async function remove(threadId: string) {
    setError(null);
    try {
      await deleteThread(threadId);
      setThreads((list) => list?.filter((thread) => thread.id !== threadId) ?? null);
      setConfirming(null);
      onDeleted(threadId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Conversation could not be deleted.");
    }
  }

  return (
    <div className="mb-5 border-b border-border pb-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-eyebrow text-primary">Memory</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">Conversations</h3>
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
              className={`flex items-center gap-2 rounded-xl px-3 py-2 ${thread.id === activeThreadId ? "bg-secondary" : "bg-secondary/60"}`}
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
                  onClick={() => void remove(thread.id)}
                  onBlur={() => setConfirming(null)}
                  className="pressable shrink-0 text-xs font-semibold text-negative hover:underline"
                >
                  Confirm delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(thread.id)}
                  aria-label={`Delete conversation ${thread.title}`}
                  className="pressable shrink-0 text-xs font-semibold text-muted-foreground hover:text-negative"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
