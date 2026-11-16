import { Fragment } from "react";
import type { EntityScope } from "@lavega/core";
import Pill from "./ui/Pill.js";
import { SHOW_SCOPE_SWITCH } from "../archive";
import { SCOPE_ORDER } from "../scope.js";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";

/* The controls on the right of the shell's top bar: the Persoonlijk | Zakelijk
 * switch (archived, `SHOW_SCOPE_SWITCH`) plus the reference's "Add widget" (Overzicht only), which
 * opens the profile's module picker. Same picker, reached from the other end:
 * from here you are adding something to the nav, from the profile you are
 * curating it.
 *
 * The switch replaced the per-company pills. Per-company splitting is not
 * deleted — it moved to the places that need it (Transacties' filter,
 * Rekeningen, Belasting per BV); the chrome asks the question the owner
 * actually asks first: is this my money or the company's. */

type TopBarActionsProps = {
  /** Which half of the owner's money is in view. */
  scope: EntityScope;
  onScopeChange: (scope: EntityScope) => void;
  onAddWidget: () => void;
  /** "Widget toevoegen" belongs to Overzicht only; every other view hides it. */
  showAddWidget: boolean;
};

/** The top bar's right-hand controls: the scope switch (while shown) and "Add widget". */
export function TopBarActions({
  scope,
  onScopeChange,
  onAddWidget,
  showAddWidget,
}: TopBarActionsProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  if (!SHOW_SCOPE_SWITCH && !showAddWidget) return null;
  return (
    <div className="topbar-right">
      {SHOW_SCOPE_SWITCH && (
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
      )}

      {showAddWidget && (
        <Pill className="topbar-add" onClick={onAddWidget}>
          <span aria-hidden="true">+</span>
          <span>{c.topBar.addWidget}</span>
        </Pill>
      )}
    </div>
  );
}
