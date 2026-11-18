import type { ReactNode } from "react";
import type { AgentFeedEvent } from "../api.js";
import type { Locale } from "../locale.js";

/* One daily message as a list row: the text, then its date. The `meldingen`
 * view and the Assistent panel both render this, so a message looks the same in
 * both. The action (delete in the view, none in the panel) is passed in. */

export function eventDateFormat(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AgentEventItem({
  event,
  format,
  textId,
  action,
  clamp = false,
  className = "",
}: {
  event: AgentFeedEvent;
  format: Intl.DateTimeFormat;
  /** Id of the text paragraph, for an action that describes itself by it. */
  textId?: string;
  action?: ReactNode;
  /** Narrow column: text cut at two lines (the full text stays in `title`), tighter rows. */
  clamp?: boolean;
  /** Extra classes for the row, e.g. a responsive hide. */
  className?: string;
}) {
  return (
    <li
      className={`flex items-start justify-between gap-3 border-b border-line ${clamp ? "py-2" : "py-3"} ${className}`.trim()}
    >
      <div>
        <p
          id={textId}
          className={clamp ? "m-0 line-clamp-2" : "m-0"}
          {...(clamp ? { title: event.body.text } : {})}
        >
          {event.body.text}
        </p>
        <p className="cell-sub m-0">
          <time dateTime={event.createdAt}>{format.format(new Date(event.createdAt))}</time>
        </p>
      </div>
      {action}
    </li>
  );
}
