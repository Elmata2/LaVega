import { Link } from "react-router-dom";
import { useAgentCatalog } from "../lib/portfolioAgents.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Button } from "./ui/button.js";

export function AgentsList() {
  const { catalog, reload } = useAgentCatalog();
  const researchCard = (
    <Link
      to="/agents/research"
      className="pressable mb-5 block rounded-card border border-primary/30 bg-primary/5 p-5 sm:p-6"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Research Stock</p>
      <h2 className="mt-1 font-display text-3xl font-semibold">One stock. All six agents.</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Research a stock with all six agents together, compare their views, then explore any view in
        a conversation.
      </p>
      <span className="mt-4 inline-block text-sm font-semibold text-primary">
        Start stock research →
      </span>
    </Link>
  );
  let content;
  if (catalog.status === "loading")
    content = (
      <p role="status" className="text-sm text-muted-foreground">
        Loading agents…
      </p>
    );
  else if (catalog.status === "error" || catalog.status === "empty")
    content = (
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
  else
    content = (
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
  return (
    <div>
      {researchCard}
      {content}
    </div>
  );
}
