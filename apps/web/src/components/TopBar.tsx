import type { View } from "../App";

const VIEW_TITLES: Record<View, string> = {
  overview: "Overzicht",
  transactions: "Transacties",
  accounts: "Rekeningen",
  rules: "Regels",
  forecast: "Forecast",
  optimalisatie: "Optimalisatie",
  belasting: "Belasting",
  facturen: "Facturen",
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
    <header className="topbar">
      <div className="topbar-left">
        <div className="eyebrow">LaVega · Alle bedrijven</div>
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
    </header>
  );
}
