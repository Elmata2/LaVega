import { useId, useLayoutEffect, useRef, useState } from "react";

export type MentionAgent = { id: string; displayName: string };

/* `@` starts a tag at the beginning of the text or after whitespace, the
 * same rule the server applies, so an address such as a@b.com never opens
 * the list. */
const OPEN_TAG = /(?<!\S)@([\w ]*)$/;

function matches(agent: MentionAgent, query: string): boolean {
  const name = agent.displayName.toLowerCase();
  return name.startsWith(query) || name.split(" ").some((word) => word.startsWith(query));
}

/** A text input that offers the other agents when the owner types `@`.
 *  Choosing one writes `@Display Name ` where the tag began. */
export function MentionInput({
  value,
  onChange,
  agents,
  selfId,
  id,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  agents: readonly MentionAgent[];
  selfId: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  /* Where the dismissed tag began; typing a different tag opens the list again. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const tag = OPEN_TAG.exec(value.slice(0, caret));
  const query = tag?.[1]?.toLowerCase().trimStart() ?? "";
  const options = tag ? agents.filter((agent) => agent.id !== selfId && matches(agent, query)) : [];
  const open = !disabled && tag !== null && options.length > 0 && dismissedAt !== tag.index;
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const optionId = (agentId: string) => `${listId}-${agentId}`;

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  function choose(agent: MentionAgent) {
    if (!tag) return;
    const inserted = `@${agent.displayName} `;
    const next = value.slice(0, tag.index) + inserted + value.slice(caret);
    pendingCaret.current = tag.index + inserted.length;
    setCaret(pendingCaret.current);
    setActive(0);
    onChange(next);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(options[activeIndex]!);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDismissedAt(tag!.index);
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(options[activeIndex]!.id) : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        onChange={(event) => {
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setActive(0);
          onChange(event.target.value);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? value.length)}
        onKeyDown={onKeyDown}
        onBlur={() => setDismissedAt(tag?.index ?? null)}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Tag an agent"
          className="mention-menu absolute bottom-full left-0 z-10 mb-3 min-w-56 origin-bottom-left rounded-tile border border-border bg-card p-1 shadow-md"
        >
          {options.map((agent, index) => (
            <li
              key={agent.id}
              id={optionId(agent.id)}
              role="option"
              aria-selected={index === activeIndex}
              className={`cursor-pointer rounded-tile px-3 py-2 text-sm ${index === activeIndex ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(agent);
              }}
              onMouseEnter={() => setActive(index)}
            >
              {agent.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A sent message with each `@Display Name` tag set in bold. */
export function MentionText({ text, agents }: { text: string; agents: readonly MentionAgent[] }) {
  if (agents.length === 0) return <>{text}</>;
  const names = agents.map((agent) => agent.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const tags = new RegExp(`((?<!\\S)@(?:${names.join("|")})(?![\\w]))`, "i");
  return (
    <>
      {text.split(tags).map((part, index) =>
        // split() puts the captured tags at the odd positions.
        index % 2 === 1 ? (
          <span key={index} className="font-semibold">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
