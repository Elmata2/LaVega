import { Fragment } from "react";
import type { EntityScope } from "@lavega/core";
import Pill from "./ui/Pill.js";
import type { View } from "../App";
import { SCOPE_ORDER } from "../scope.js";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";

/* The greeting/title row, straight from the desktop reference: one large line
 * naming where you are with a rule under it, a muted eyebrow above, and the
 * controls on the right — the Persoonlijk | Zakelijk switch plus the
 * reference's "Add widget", which opens the profile's module picker. Same
 * picker, reached from the other end: from here you are adding something to the
 * nav, from the profile you are curating it.
 *
 * The switch replaced the per-company pills. Per-company splitting is not
 * deleted — it moved to the places that need it (Transacties' filter,
 * Rekeningen, Belasting per BV); the chrome asks the question the owner
 * actually asks first: is this my money or the company's. */

type TopBarProps = {
  view: View;
  /** Which half of the owner's money is in view. */
  scope: EntityScope;
  onScopeChange: (scope: EntityScope) => void;
  onAddWidget: () => void;
};

export default function TopBar({ view, scope, onScopeChange, onAddWidget }: TopBarProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="eyebrow">LaVega · {c.scope[scope]}</div>
        <h1 className="topbar-title">{c.topBar.viewTitles[view]}</h1>
      </div>

      <div className="topbar-right">
        <div className="scope-switch" role="group" aria-label={c.topBar.scopeGroupLabel}>
          {SCOPE_ORDER.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && <span className="scope-rule" aria-hidden="true" />}
              <button
                type="button"
                className={`scope-option${scope === s ? " scope-on" : ""}`}
                aria-pressed={scope === s}
                onClick={() => onScopeChange(s)}
              >
                {c.scope[s]}
              </button>
            </Fragment>
          ))}
        </div>

        <Pill className="topbar-add" onClick={onAddWidget}>
          <span aria-hidden="true">+</span>
          <span>{c.topBar.addWidget}</span>
        </Pill>
      </div>
    </div>
  );
}
