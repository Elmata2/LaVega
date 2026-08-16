import type { View } from "../App";

/* The greeting/title row, straight from the desktop reference: one large line
 * naming where you are, a muted eyebrow above it, and the filter controls on
 * the right. The eyebrow now reflects the active company scope instead of
 * always claiming "Alle bedrijven". */

const VIEW_TITLES: Record<View, string> = {
  overview: "Overzicht",
  transactions: "Transacties",
  accounts: "Rekeningen",
  rules: "Regels",
  forecast: "Forecast",
  optimalisatie: "Optimalisatie",
  valuta: "Valuta",
  belasting: "Belasting",
  facturen: "Facturen",
  punten: "Punten",
  backup: "Back-up",
};

type TopBarProps = {
  view: View;
  entityScope: string;
  onEntityScopeChange: (entity: string) => void;
  entityOptions: string[];
};

export default function TopBar({ view, entityScope, onEntityScopeChange, entityOptions }: TopBarProps) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="eyebrow">LaVega · {entityScope || "Alle bedrijven"}</div>
        <h1 className="topbar-title">{VIEW_TITLES[view]}</h1>
      </div>

      <div className="topbar-right" role="group" aria-label="Bedrijfsfilter">
        <button
          type="button"
          className={`pill${entityScope === "" ? " pill-active" : ""}`}
          aria-pressed={entityScope === ""}
          onClick={() => onEntityScopeChange("")}
        >
          Alle
        </button>
        {entityOptions.map((e) => (
          <button
            key={e}
            type="button"
            className={`pill${entityScope === e ? " pill-active" : ""}`}
            aria-pressed={entityScope === e}
            onClick={() => onEntityScopeChange(e)}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
