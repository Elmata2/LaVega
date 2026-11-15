import type { WizardCopy } from "../../copy/wizard.js";
import { Form, Next } from "./screenViews.js";
import type { ScreenId } from "./screens.js";
import type { SummaryRow } from "./summaryRows.js";

/** What the wizard knows so far, one line per answered screen. Wijzig sends the
 *  user to that screen; Verder moves on. */
export default function SummaryScreen(p: {
  busy: boolean;
  copy: WizardCopy;
  rows: readonly SummaryRow[];
  onEdit: (s: ScreenId) => void;
  onSubmit: () => void;
}) {
  return (
    <Form ok={!p.busy} onSubmit={p.onSubmit}>
      <ul className="wz-summary">
        {p.rows.map((r) => (
          <li className="wz-summary-row" key={r.screen}>
            <span className="wz-summary-text">
              <span className="wz-summary-label">{r.label}</span>
              <span>{r.value}</span>
            </span>
            <button
              type="button"
              className="wz-link"
              data-screen={r.screen}
              aria-label={`${p.copy.summaryEdit} ${r.label}`}
              disabled={p.busy}
              onClick={() => p.onEdit(r.screen)}
            >
              {p.copy.summaryEdit}
            </button>
          </li>
        ))}
      </ul>
      <Next label={p.copy.next} disabled={p.busy} />
    </Form>
  );
}
