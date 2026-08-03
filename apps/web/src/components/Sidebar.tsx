import type { ReactNode } from "react";
import type { View } from "../App";

type IconProps = { children: ReactNode };
function Icon({ children }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const icons: Record<View, ReactNode> = {
  overview: (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  ),
  transactions: (
    <Icon>
      <path d="M4 7h13M17 7l-3-3M17 7l-3 3" />
      <path d="M20 17H7M7 17l3 3M7 17l3-3" />
    </Icon>
  ),
  accounts: (
    <Icon>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v9M19 10v9M9 10v9M15 10v9" />
      <path d="M3 19h18" />
    </Icon>
  ),
  rules: (
    <Icon>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10" cy="18" r="1.6" fill="currentColor" stroke="none" />
    </Icon>
  ),
  forecast: (
    <Icon>
      <path d="M4 16l5-6 4 3 7-9" />
      <path d="M14 4h6v6" />
    </Icon>
  ),
};

const importIcon = (
  <Icon>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M4 20h16" />
  </Icon>
);

const NAV_ITEMS: { key: View; label: string }[] = [
  { key: "overview", label: "Overzicht" },
  { key: "transactions", label: "Transacties" },
  { key: "accounts", label: "Rekeningen" },
  { key: "rules", label: "Regels" },
  { key: "forecast", label: "Forecast" },
];

type SidebarProps = {
  view: View;
  onNavigate: (view: View) => void;
  onImportClick: () => void;
  onLock: () => void;
};

export default function Sidebar({ view, onNavigate, onImportClick, onLock }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="dot dot-pos" aria-hidden="true" />
        <span>LaVega</span>
      </div>

      <nav className="nav" aria-label="Weergaven">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav-item${view === item.key ? " active" : ""}`}
            aria-current={view === item.key ? "page" : undefined}
            onClick={() => onNavigate(item.key)}
          >
            <span className="nav-icon" aria-hidden="true">
              {icons[item.key]}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
        <button type="button" className="nav-item" onClick={onImportClick}>
          <span className="nav-icon" aria-hidden="true">
            {importIcon}
          </span>
          <span>Importeren</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="nav-item" onClick={onLock}>
          <span className="nav-icon" aria-hidden="true">
            <Icon>
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </Icon>
          </span>
          <span>Vergrendel</span>
        </button>
        <div className="identity-card">Lokaal · privé</div>
      </div>
    </aside>
  );
}
