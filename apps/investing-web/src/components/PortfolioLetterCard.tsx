import type { LetterState } from "../lib/portfolioLetter.js";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const letterDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Presentational: Overview owns the read and the Discuss action. There is no
 *  generate button; the broker-sync cron writes the letter. */
export function PortfolioLetterCard({
  state,
  onDiscuss,
}: {
  state: LetterState;
  onDiscuss: () => void;
}) {
  if (state.status === "loading")
    return (
      <Card aria-busy="true" aria-label="Letter from Charlie" data-dashboard-section="letter">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">Loading letter…</p>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card role="alert" aria-label="Letter from Charlie" data-dashboard-section="letter">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">{state.message}</p>
        </CardContent>
      </Card>
    );
  if (state.status === "empty")
    return (
      <Card variant="empty" aria-label="Letter from Charlie" data-dashboard-section="letter">
        <CardHeader>
          <p className="text-sm font-medium text-muted-foreground">Letter from Charlie</p>
          <CardTitle size="md">No letter yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Charlie writes after your broker data changes. The first letter appears after the next
            sync.
          </p>
        </CardContent>
      </Card>
    );
  const { letter } = state;
  return (
    <Card aria-label="Letter from Charlie" data-dashboard-section="letter">
      <CardHeader>
        <p className="text-sm font-medium text-muted-foreground">
          Letter from Charlie · {letterDate.format(new Date(letter.createdAt))}
        </p>
        <CardTitle size="md">{letter.verdict}</CardTitle>
      </CardHeader>
      <CardContent spacing="loose">
        <ol className="space-y-4 text-sm">
          {letter.observations.map((item) => (
            <li key={item.title} className="space-y-1">
              <p className="font-medium text-foreground">{item.title}</p>
              <p className="text-muted-foreground">{item.body}</p>
              {item.figures.length > 0 && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {item.figures.join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ol>
        <Button type="button" variant="outline" onClick={onDiscuss}>
          Discuss
        </Button>
      </CardContent>
    </Card>
  );
}
