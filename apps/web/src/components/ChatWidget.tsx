import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { streamChat } from "../api.js";
import { getChatEnabled, setChatEnabled } from "../settings.js";

type ChatMsg = { role: "user" | "assistant"; content: string };

type ChatWidgetProps = {
  view: string;
  context: { tab: string; context: Record<string, unknown> };
  configured: boolean;
  /** An externally-triggered question (e.g. the "vs. gemiddelde" button). When
   *  `promptNonce` changes, the widget opens and pre-fills the input with
   *  `prompt` — the owner still reviews + presses Verstuur (so consent holds). */
  prompt?: string | null;
  promptNonce?: number;
};

/** Floating LaVega assistant. Opt-in and local-first: nothing leaves the
 *  browser until the owner enables the assistant AND sends a message. Each turn
 *  forwards only the active tab's pre-computed context (via buildTabContext) plus
 *  the conversation to our own server (POST /api/agent/chat) — never Anthropic
 *  directly. Default OFF; the consent gate below explains what is sent. */
export default function ChatWidget({ view, context, configured, prompt, promptNonce }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean>(() => getChatEnabled());
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Abort any in-flight stream when the widget unmounts (e.g. Vergrendel), so a
  // late chunk can't call setState on a gone component.
  useEffect(() => () => abortRef.current?.abort(), []);

  // An external "ask this" trigger (e.g. the per-category "vs. gemiddelde"
  // button) opens the panel and pre-fills the input. We do NOT auto-send: the
  // owner reviews and presses Verstuur, which keeps the opt-in/consent intact.
  useEffect(() => {
    if (promptNonce && prompt) {
      setOpen(true);
      setInput(prompt);
    }
    // Keyed on the nonce so clicking the same category twice re-triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptNonce]);

  // Keep the newest message in view as it streams in.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, open]);

  function enableAssistant() {
    setChatEnabled(true);
    setEnabled(true);
  }

  function send() {
    const text = input.trim();
    if (!enabled || !configured || !text || streaming) return;

    // Payload = the conversation INCLUDING this new user turn, but excluding the
    // empty assistant placeholder we append to the UI to stream into.
    const outgoing: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const appendToLast = (chunk: string) =>
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const copy = prev.slice();
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, content: last.content + chunk };
        return copy;
      });
    const setLast = (content: string) =>
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const copy = prev.slice();
        copy[copy.length - 1] = { role: "assistant", content };
        return copy;
      });

    void streamChat(
      { tab: context.tab, messages: outgoing, context: context.context },
      {
        onChunk: (t) => appendToLast(t),
        onError: (m) => {
          setLast(`⚠️ ${m}`);
          setStreaming(false);
        },
        onDone: () => setStreaming(false),
      },
      controller.signal,
    ).catch((err: unknown) => {
      if (controller.signal.aborted) return; // unmounted / user closed — ignore
      setLast(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
      setStreaming(false);
    });
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const lastMsg = messages[messages.length - 1];
  const showTyping = streaming && lastMsg?.role === "assistant" && lastMsg.content === "";
  const canSend = enabled && configured && input.trim().length > 0 && !streaming;

  return (
    <div className="chat-widget" data-view={view}>
      {open && (
        <div className="chat-panel" role="dialog" aria-label="LaVega assistent">
          <div className="chat-header">
            <span className="chat-header-title">💬 LaVega</span>
            <button
              type="button"
              className="chat-close"
              aria-label="Sluit assistent"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          {!configured ? (
            <div className="chat-body">
              <div className="chat-notice">
                <p>AI-assistent is nog niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt op de server).</p>
              </div>
            </div>
          ) : !enabled ? (
            <div className="chat-body">
              <div className="chat-notice">
                <p>
                  Ik stuur de gegevens van dít tabblad + je vraag naar Claude (via jouw server, jouw
                  sleutel) om te antwoorden. Voor actuele cijfers zoek ik op het web. Er wordt niets
                  opgeslagen.
                </p>
                <button type="button" className="btn btn-primary" onClick={enableAssistant}>
                  Zet assistent aan
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="chat-body" ref={listRef}>
                {messages.length === 0 && !showTyping && (
                  <p className="chat-empty">Stel een vraag over dit tabblad.</p>
                )}
                {messages.map((m, i) =>
                  m.content === "" ? null : (
                    <div
                      key={i}
                      className={`chat-msg ${m.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}`}
                    >
                      {m.content}
                    </div>
                  ),
                )}
                {showTyping && <div className="chat-typing">LaVega denkt na…</div>}
              </div>

              <div className="chat-input-row">
                <textarea
                  className="chat-input"
                  rows={1}
                  placeholder="Typ je vraag…"
                  value={input}
                  disabled={streaming}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                />
                <button
                  type="button"
                  className="btn btn-primary chat-send"
                  disabled={!canSend}
                  onClick={send}
                >
                  Verstuur
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className="chat-launcher"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        💬 LaVega
      </button>
    </div>
  );
}
