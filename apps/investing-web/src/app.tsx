import { useEffect, useState } from "react";
import { Link, Outlet, Route, Routes } from "react-router-dom";

type Health = { ok: boolean; service: string };

export function HealthStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/health")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health request failed: ${response.status}`);
        return (await response.json()) as Health;
      })
      .then(setHealth)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Health request failed"));
  }, []);

  if (error) return <p role="status">Server unavailable: {error}</p>;
  if (!health) return <p role="status">Connecting to investing server…</p>;
  return <p role="status">{health.service}: {health.ok ? "healthy" : "unhealthy"}</p>;
}

function Layout() {
  return (
    <main>
      <header>
        <h1>LaVega Investing</h1>
        <nav aria-label="Main navigation">
          <Link to="/">Overview</Link>{" | "}
          <Link to="/positions">Positions</Link>
        </nav>
      </header>
      <Outlet />
    </main>
  );
}

function Overview() {
  return <section aria-labelledby="overview-title"><h2 id="overview-title">Overview</h2><HealthStatus /></section>;
}

function Positions() {
  return <section aria-labelledby="positions-title"><h2 id="positions-title">Positions</h2><p>No positions loaded.</p></section>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/positions" element={<Positions />} />
      </Route>
    </Routes>
  );
}
