import { useEffect, useRef, useState } from "react";
import { isArchivedWidget } from "../archive";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import { WIDGETS, toggleWidget, useOverviewWidgets, type WidgetId } from "./moduleRegistry";

/* The add area at the bottom of Home: up to four dashed boxes, one per widget
 * that is off. A click switches the widget on. Focus never stays on a node that
 * unmounts: after an add it goes to the new card's heading, after a hide (see
 * WidgetHideButton) to this area's heading, and when the area itself is gone to
 * #main. The move runs in an effect, after the store change is rendered.
 *
 * The component stays mounted when it has nothing to show (only the live region
 * remains), so that effect still runs and the last add is still announced. */

const MAX_BOXES = 4;

type Pending = { kind: "added"; id: WidgetId } | { kind: "hidden" } | null;
let pending: Pending = null;

/** Called by WidgetHideButton just before it switches a widget off. */
export function requestFocusAfterHide(): void {
  pending = { kind: "hidden" };
}

export default function HomeAddArea({ onOpenPicker }: { onOpenPicker: () => void }) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const [enabled, setEnabled] = useOverviewWidgets();
  const [addedId, setAddedId] = useState<WidgetId | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const candidates = WIDGETS.filter(
    (w) => !isArchivedWidget(w.id) && !enabled.includes(w.id),
  ).slice(0, MAX_BOXES);

  useEffect(() => {
    const request = pending;
    if (request === null) return;
    pending = null;
    if (request.kind === "hidden") {
      (headingRef.current ?? document.getElementById("main"))?.focus();
      return;
    }
    const card = document.querySelector<HTMLElement>(`[data-widget="${request.id}"]`);
    card?.closest(".module")?.setAttribute("data-just-added", "");
    (card ?? headingRef.current ?? document.getElementById("main"))?.focus();
  }, [enabled]);

  // Said only while the widget is still on: a hide empties the region, and the
  // box coming back is the feedback.
  const message =
    addedId !== null && enabled.includes(addedId)
      ? c.home.added(c.modulePicker.widgets[addedId].label)
      : "";

  /* The live region stays mounted when the last box goes, so that last add is
   * announced too; only the heading and the boxes disappear. */
  const status = (
    <div role="status" className="sr-only">
      {message}
    </div>
  );

  return (
    <>
      {candidates.length > 0 && (
        <section className="home-add" data-add-area aria-labelledby="home-add-heading">
          <div className="home-add-head">
            <h2
              id="home-add-heading"
              ref={headingRef}
              tabIndex={-1}
              data-add-heading
              className="module-title"
            >
              {c.home.addHeading}
            </h2>
            <button type="button" className="home-add-all" onClick={onOpenPicker}>
              {c.home.allWidgets}
            </button>
          </div>
          <div className="home-add-grid">
            {candidates.map((w) => {
              const text = c.modulePicker.widgets[w.id];
              return (
                <button
                  type="button"
                  key={w.id}
                  className="home-add-box"
                  data-add-box
                  onClick={() => {
                    pending = { kind: "added", id: w.id };
                    setAddedId(w.id);
                    setEnabled(toggleWidget(enabled, w.id, true));
                  }}
                >
                  <span className="home-add-plus" aria-hidden="true">
                    +
                  </span>
                  <span className="home-add-label" data-box-label>
                    {text.label}
                  </span>
                  <span className="home-add-what">{text.what}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {status}
    </>
  );
}
