import { Link } from "react-router-dom";
import { useAgentCatalog } from "../lib/portfolioAgents.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Button } from "./ui/button.js";

export function AgentsList() {
  const { catalog, reload } = useAgentCatalog();
  if (catalog.status === "loading")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading agents…
      </p>
    );
  if (catalog.status === "error" || catalog.status === "empty")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agents unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-negative">
            {catalog.status === "error" ? catalog.message : "No portfolio agents available."}
          </p>
          <Button type="button" variant="outline" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {catalog.agents.map((agent) => (
        <Link
          key={agent.id}
          to={`/agents/${agent.id}`}
          className="pressable rounded-card border border-border bg-card p-5 shadow-sm hover:bg-secondary/40"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Agent</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">{agent.displayName}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.investingStyle}</p>
        </Link>
      ))}
    </div>
  );
}
