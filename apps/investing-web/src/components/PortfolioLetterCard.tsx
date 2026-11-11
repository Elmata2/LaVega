import type { LetterState, LetterWriteState } from "../lib/portfolioLetter.js";
import { shortDate } from "../lib/dates.js";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const letterDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** The model copies figures verbatim from the portfolio brief, so a figure is a
 *  bare string with no label. Only the date shape is unambiguous: a percentage
 *  could be a weight or a return and a bare number a value or a count, so those
 *  pass through untouched. Labels need a structured figure contract. */
export const formatLetterFigure = (figure: string): string =>
  isoDate.test(figure) ? shortDate(figure) : figure;

/** Presentational: Overview owns the read and the two actions. The write button
 *  asks the server for a letter now; the server's gate still refuses one when
 *  nothing changed, so a click is never a model call for its own sake. */
export function PortfolioLetterCard({
  state,
  writeState,
  onDiscuss,
  onWrite,
}: {
  state: LetterState;
  writeState: LetterWriteState;
  onDiscuss: () => void;
  onWrite: () => void;
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
          <CardTitle size="md">No letter yet</CardTitle>
          <CardDescription>Letter from Charlie</CardDescription>
        </CardHeader>
        <CardContent spacing="loose">
          <p className="text-sm text-muted-foreground">
            Charlie writes after your broker data changes. Write the first letter now, or wait for
            the next sync.
          </p>
          <WriteControl writeState={writeState} onWrite={onWrite} />
        </CardContent>
      </Card>
    );
  const { letter } = state;
  return (
    <Card aria-label="Letter from Charlie" data-dashboard-section="letter">
      <CardHeader>
        <CardTitle size="md">{letter.verdict}</CardTitle>
        <CardDescription>
          Letter from Charlie · {letterDate.format(new Date(letter.createdAt))}
        </CardDescription>
      </CardHeader>
      <CardContent spacing="loose">
        <ol className="space-y-4 text-sm">
          {letter.observations.map((item) => (
            <li key={item.title} className="space-y-1">
              <p className="font-medium text-foreground">{item.title}</p>
              <p className="text-muted-foreground">{item.body}</p>
              {item.figures.length > 0 && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {item.figures.map(formatLetterFigure).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-start gap-3">
          <Button type="button" variant="outline" onClick={onDiscuss}>
            Discuss
          </Button>
          <WriteControl writeState={writeState} onWrite={onWrite} variant="ghost" />
        </div>
      </CardContent>
    </Card>
  );
}

function WriteControl({
  writeState,
  onWrite,
  variant = "outline",
}: {
  writeState: LetterWriteState;
  onWrite: () => void;
  variant?: "outline" | "ghost";
}) {
  const writing = writeState.status === "writing";
  return (
    <div className="space-y-2">
      <Button type="button" variant={variant} onClick={onWrite} disabled={writing}>
        {writing ? "Writing…" : "Write letter now"}
      </Button>
      {writeState.status === "unchanged" && (
        <p className="text-xs text-muted-foreground">Nothing changed since the last letter.</p>
      )}
      {writeState.status === "error" && (
        <p role="alert" className="text-xs text-negative">
          {writeState.message}
        </p>
      )}
    </div>
  );
}
