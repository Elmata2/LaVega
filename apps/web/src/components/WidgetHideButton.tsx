import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import { requestFocusAfterHide } from "./HomeAddArea";
import { toggleWidget, useOverviewWidgets, type WidgetId } from "./moduleRegistry";

/* The small hide button in the header of a widget card. It switches the widget
 * off; the card unmounts, so focus is handed to the add area (HomeAddArea moves
 * it once the store change is rendered). Visible on hover and focus-within of
 * the card, always on touch: see `.widget-hide` in styles/modules.css. */

export default function WidgetHideButton({ id }: { id: WidgetId }) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const [enabled, setEnabled] = useOverviewWidgets();
  const label = c.modulePicker.widgets[id].label;
  return (
    <button
      type="button"
      className="widget-hide"
      aria-label={c.home.hide(label)}
      title={c.home.hide(label)}
      onClick={() => {
        requestFocusAfterHide();
        setEnabled(toggleWidget(enabled, id, false));
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
