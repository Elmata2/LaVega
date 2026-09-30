import { useEffect, useState } from "react";
import {
  fetchMemory,
  RISK_TOLERANCE_LABELS,
  saveGoal,
  saveRiskTolerance,
  saveThesis,
  type Goal,
  type Memory,
  type RiskTolerance,
  type Thesis,
} from "../lib/agentMemory.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";

/* What every portfolio agent reads about the owner: risk tolerance, theses
 * and goals. Theses and goals can be edited here but not deleted on their
 * own; conversations are deleted from an agent's page, and everything goes
 * with erase-all-data. Hidden when the server has no memory. */

const LEVELS = Object.keys(RISK_TOLERANCE_LABELS) as RiskTolerance[];
const field =
  "w-full rounded-tile border border-border bg-background px-3 py-2 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

function ThesisEditor({ thesis, onSaved }: { thesis: Thesis; onSaved: (next: Thesis) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thesis);
  const [error, setError] = useState<string | null>(null);
  const rows: Array<[keyof Pick<Thesis, "why" | "worth" | "entry" | "wrongIf">, string]> = [
    ["why", "Why you own it"],
    ["worth", "What you think it is worth"],
    ["entry", "Why you bought when you did"],
    ["wrongIf", "What would prove you wrong"],
  ];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      onSaved(await saveThesis(draft));
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Thesis could not be saved.");
    }
  }

  return (
    <li className="rounded-tile border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {thesis.symbol}
          {thesis.status === "dormant" && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              From previous holding
            </span>
          )}
        </p>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(thesis);
              setEditing(true);
            }}
            className="pressable text-xs font-semibold text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-2">
          {rows.map(([key, label]) => (
            <label key={key} className="block text-xs text-muted-foreground">
              {label}
              <textarea
                value={draft[key] ?? ""}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                rows={2}
                className={`mt-1 ${field}`}
              />
            </label>
          ))}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!draft.why.trim()}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-negative">
              {error}
            </p>
          )}
        </form>
      ) : (
        <dl className="mt-2 space-y-1 text-sm">
          {rows.map(([key, label]) =>
            thesis[key] ? (
              <div key={key}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd>{thesis[key]}</dd>
              </div>
            ) : null,
          )}
        </dl>
      )}
    </li>
  );
}

function GoalEditor({ goal, onSaved }: { goal: Goal; onSaved: (next: Goal) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(goal.text);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      onSaved(await saveGoal({ id: goal.id, symbol: goal.symbol, text }));
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Goal could not be saved.");
    }
  }

  return (
    <li className="rounded-tile border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground">{goal.symbol ?? "Portfolio"}</p>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setText(goal.text);
              setEditing(true);
            }}
            className="pressable text-xs font-semibold text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={(event) => void submit(event)} className="mt-2 space-y-2">
          <label className="sr-only" htmlFor={`goal-${goal.id}`}>
            Goal
          </label>
          <textarea
            id={`goal-${goal.id}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            className={field}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!text.trim()}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-negative">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="mt-1 text-sm">{goal.text}</p>
      )}
    </li>
  );
}

export function AgentMemorySection() {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [riskError, setRiskError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetchMemory()
      .then((next) => current && setMemory(next))
      .catch(() => current && setMemory(null));
    return () => {
      current = false;
    };
  }, []);

  if (!memory) return null;

  async function chooseRisk(level: RiskTolerance) {
    setRiskError(null);
    try {
      const saved = await saveRiskTolerance(level);
      setMemory((current) => current && { ...current, riskTolerance: saved.riskTolerance });
    } catch (reason) {
      setRiskError(reason instanceof Error ? reason.message : "Risk tolerance could not be saved.");
    }
  }

  return (
    <section id="memory" aria-label="Agent memory">
      <Card>
        <CardHeader>
          <CardTitle>Agent memory</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div>
              <p className="font-semibold">Risk tolerance</p>
              <p className="text-sm text-muted-foreground">
                Every agent reads this before it answers.
              </p>
              <div role="radiogroup" aria-label="Risk tolerance" className="mt-3 flex gap-2">
                {LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={memory.riskTolerance === level}
                    onClick={() => void chooseRisk(level)}
                    className={`pressable rounded-pill border px-3 py-1.5 text-sm font-semibold transition-colors ${memory.riskTolerance === level ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"}`}
                  >
                    {RISK_TOLERANCE_LABELS[level]}
                  </button>
                ))}
              </div>
              {riskError && (
                <p role="alert" className="mt-2 text-xs text-negative">
                  {riskError}
                </p>
              )}
            </div>

            <div>
              <p className="font-semibold">Theses</p>
              {memory.theses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None yet. An agent asks for one when you discuss a holding.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {memory.theses.map((thesis) => (
                    <ThesisEditor
                      key={thesis.symbol}
                      thesis={thesis}
                      onSaved={(next) =>
                        setMemory(
                          (current) =>
                            current && {
                              ...current,
                              theses: current.theses.map((item) =>
                                item.symbol === next.symbol ? next : item,
                              ),
                            },
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="font-semibold">Goals</p>
              {memory.goals.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None yet. Tell an agent what you want your portfolio to do.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {memory.goals.map((goal) => (
                    <GoalEditor
                      key={goal.id}
                      goal={goal}
                      onSaved={(next) =>
                        setMemory(
                          (current) =>
                            current && {
                              ...current,
                              goals: current.goals.map((item) =>
                                item.id === next.id ? next : item,
                              ),
                            },
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              Delete a conversation from its agent's page.{" "}
              <a
                href="/api/memory/export"
                download
                className="font-semibold text-primary hover:underline"
              >
                Export agent memory
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
