import { useState } from "react";
import type { RewardsBalance, TrackedStatus, TrackingState } from "@lavega/core";
import {
  makeRewardsBalance, REWARD_PROGRAMS, rewardsTracked, trackingStatuses,
  applyRewardsReply, snoozeTracker, parseBalanceReply, norm,
} from "@lavega/core";
import { formatEuro } from "../format";
import "../styles/views.css";

/* Punten — the hand-kept side of the money picture.
 *
 * What this screen may and may not claim:
 *   - It knows ONE thing about a balance: the number the owner typed, and when.
 *     Every figure is therefore labelled with the date it was confirmed, and the
 *     screen says out loud that nothing here is fetched from the programme.
 *   - It does NOT price points. A Membership Rewards point has no single honest
 *     value — 0,5 cent as a statement credit, several cents through a transfer
 *     partner — so an "indicatieve waarde" was removed once for inventing
 *     precision and is not coming back. Where the unit genuinely IS euros
 *     (bunq's cashback), the balance is its own value and is shown as euros.
 *     Nowhere else does a euro sign appear.
 *   - It never sums across programmes. Avios plus Bonvoy is not a number.
 */

/** Replace the balance with the same id, or append it. */
export function upsertBalance(list: RewardsBalance[], b: RewardsBalance): RewardsBalance[] {
  const i = list.findIndex((x) => x.id === b.id);
  if (i === -1) return [...list, b];
  const next = [...list];
  next[i] = b;
  return next;
}

/** What one unit of this programme IS. "eur" only for programmes the reference
 *  list documents as paying out in euros — then the balance is the value, with
 *  no rate and no conversion in between. Everything else is "points", which this
 *  screen refuses to price. An unknown programme name is points, never euros:
 *  guessing the other way would put a euro sign on a number that has none. */
export function programUnit(program: string): "eur" | "points" {
  const p = REWARD_PROGRAMS.find((r) => norm(r.name) === norm(program));
  return p && /cashback in euro/i.test(p.note ?? "") ? "eur" : "points";
}

/** The reference list's category ("Airline", "Hotel", …), or null for a
 *  programme the owner typed himself — we don't invent one for it. */
export function programCategory(program: string): string | null {
  return REWARD_PROGRAMS.find((r) => norm(r.name) === norm(program))?.category ?? null;
}

/** A programme id (a normalised name, so it carries spaces) turned into
 *  something legal in an HTML id attribute. */
const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, "-");

export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const MONTHS_NL = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/** "2026-05-12" → "12 mei 2026". */
export function dateNL(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return MONTHS_NL[m - 1] ? `${d} ${MONTHS_NL[m - 1]} ${y}` : iso;
}

export type PuntenRow = { balance: RewardsBalance; status: TrackedStatus; unit: "eur" | "points" };

/** Rows in the order they deserve attention: over time first, then due, then
 *  snoozed, then fresh; within a state the oldest number first, ties by name so
 *  the list never reshuffles on its own. */
const STATE_RANK: Record<TrackingState, number> = { overdue: 0, due: 1, snoozed: 2, fresh: 3 };

export function puntenRows(balances: readonly RewardsBalance[], asOf: string): PuntenRow[] {
  const statuses = trackingStatuses(rewardsTracked(balances), asOf); // index-aligned with balances
  return balances
    .map((balance, i) => ({ balance, status: statuses[i], unit: programUnit(balance.program) }))
    .sort(
      (a, b) =>
        STATE_RANK[a.status.state] - STATE_RANK[b.status.state] ||
        b.status.ageDays - a.status.ageDays ||
        a.status.label.localeCompare(b.status.label, "nl"),
    );
}

const STATE_LABEL: Record<TrackingState, string> = {
  fresh: "actueel",
  due: "bevestigen",
  overdue: "verouderd",
  snoozed: "later",
};

/** How old the number is, in the owner's words — never a claim about the real
 *  balance today, only about when he last confirmed it. */
function ageSentence(s: TrackedStatus): string {
  const age = s.ageDays === 0 ? "vandaag ingevoerd" : `${s.ageDays} ${s.ageDays === 1 ? "dag" : "dagen"} geleden ingevoerd`;
  if (s.state === "fresh") return `${age}. LaVega vraagt hier vanaf ${dateNL(s.dueDate)} weer naar.`;
  if (s.state === "snoozed") return `${age}. Je vroeg om later — LaVega vraagt weer vanaf ${dateNL(s.snoozedUntil ?? s.dueDate)}.`;
  if (s.state === "overdue") return `${age}, ${s.daysOverdue} ${s.daysOverdue === 1 ? "dag" : "dagen"} over de afgesproken termijn.`;
  return `${age}. Tijd om te bevestigen.`;
}

const INTERVALS: { days: number; label: string }[] = [
  { days: 30, label: "elke maand" },
  { days: 90, label: "elk kwartaal" },
  { days: 180, label: "elk half jaar" },
  { days: 365, label: "elk jaar" },
];

export default function Punten({
  balances, asOf, busy, onSave,
}: { balances: RewardsBalance[]; asOf: string; busy: boolean; onSave: (next: RewardsBalance[]) => void }) {
  const [program, setProgram] = useState(REWARD_PROGRAMS[0].name);
  const [points, setPoints] = useState("");
  const [updatedAt, setUpdatedAt] = useState(asOf);
  const [addError, setAddError] = useState("");
  // The one row whose "wat staat er nu?" box is open.
  const [ask, setAsk] = useState<{ id: string; text: string; error: string } | null>(null);

  const rows = puntenRows(balances, asOf);
  const attention = rows.filter((r) => r.status.state === "due" || r.status.state === "overdue").length;
  const addUnit = programUnit(program);

  function add() {
    const pts = parseBalanceReply(points);
    if (!program.trim() || !updatedAt) {
      setAddError("Vul een programma en een datum in.");
      return;
    }
    if (pts === null || pts < 0) {
      setAddError("Ik kon hier geen getal in vinden — vul alleen het saldo in, bijvoorbeeld 245000 of 245k.");
      return;
    }
    setAddError("");
    onSave(upsertBalance(balances, makeRewardsBalance({ program: program.trim(), points: Math.round(pts), updatedAt })));
    setPoints("");
  }

  function remove(id: string) {
    onSave(balances.filter((b) => b.id !== id));
  }

  function submitAsk(id: string) {
    const next = applyRewardsReply(balances, id, ask?.text ?? "", asOf);
    if (next === null) {
      setAsk({ id, text: ask?.text ?? "", error: "Ik kon daar geen enkel getal in vinden — stuur alleen het saldo." });
      return;
    }
    setAsk(null);
    onSave(next);
  }

  function changeInterval(id: string, days: number) {
    onSave(balances.map((b) => (b.id === id ? { ...b, intervalDays: days } : b)));
  }

  return (
    <section className="card" aria-label="Punten">
      <div className="view-head">
        <h2>Punten</h2>
        <span className="eyebrow">
          {rows.length} {rows.length === 1 ? "programma" : "programma's"}
          {attention > 0 ? ` · ${attention} te bevestigen` : ""}
        </span>
      </div>
      <p className="view-lead">
        Elk saldo hieronder is het getal dat jij zelf hebt ingevoerd, met de datum erbij. LaVega haalt
        niets op bij het programma — er is geen koppeling — en telt programma's niet bij elkaar op:
        een Avios en een Bonvoy-punt zijn niet hetzelfde ding.
      </p>
      <p className="field-note">
        <strong>Geen puntenwaarde in euro's.</strong> Wat één punt waard is, hangt af van hoe je hem
        inwisselt — als tegoed op je rekening is dat een fractie van wat een transfer naar een
        luchtvaartprogramma kan opleveren. Eén bedrag zou dus een verzonnen bedrag zijn. Cashback is de
        uitzondering: die staat al in euro's. Vraag de assistent rechtsonder naar actuele inwissel- en
        transferwaardes.
      </p>

      {rows.length === 0 ? (
        <div className="empty-guide">
          <p>Nog geen punten- of cashback-saldi.</p>
          <ul>
            <li>Zoek het saldo op in de app of de mail van het programma zelf.</li>
            <li>Voeg het hieronder toe met de datum waarop je het zag.</li>
            <li>LaVega vraagt je daarna elk kwartaal om het te bevestigen — dat interval kun je per programma aanpassen.</li>
          </ul>
        </div>
      ) : (
        <div className="punt-list">
          {rows.map(({ balance: b, status, unit }) => {
            const category = programCategory(b.program);
            const asking = ask && ask.id === b.id ? ask : null;
            return (
              <article className={`punt-card punt-${status.state}`} key={b.id}>
                <header className="punt-head">
                  <div className="punt-id">
                    <div className="punt-program">{b.program}</div>
                    <div className="punt-category">{category ?? "eigen programma"}</div>
                  </div>
                  <span className={`badge punt-badge-${status.state}`}>{STATE_LABEL[status.state]}</span>
                </header>

                <div className="punt-figure">
                  <span className="punt-value">
                    {unit === "eur" ? formatEuro(b.points) : b.points.toLocaleString("nl-NL")}
                  </span>
                  <span className="punt-unit">{unit === "eur" ? "cashback" : "punten"}</span>
                </div>
                <p className="punt-asof">
                  Stand van {dateNL(b.updatedAt)} — {ageSentence(status)}
                </p>
                <p className="punt-worth">
                  {unit === "eur"
                    ? "Waarde: dit bedrag zelf — dit programma keert uit in euro's, er zit geen omrekening tussen."
                    : "Waarde: niet vast te stellen zonder te weten waarvoor je ze inwisselt."}
                </p>

                {asking ? (
                  <div className="punt-ask">
                    <label htmlFor={`punt-ask-${slug(b.id)}`}>{status.question}</label>
                    <div className="punt-ask-row">
                      <input
                        id={`punt-ask-${slug(b.id)}`}
                        className="saldo-input"
                        inputMode="decimal"
                        placeholder={unit === "eur" ? "bijv. 42" : "bijv. 245000"}
                        value={asking.text}
                        disabled={busy}
                        onChange={(e) => setAsk({ id: b.id, text: e.target.value, error: "" })}
                      />
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submitAsk(b.id)}>
                        Opslaan
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => setAsk(null)}>
                        Annuleer
                      </button>
                    </div>
                    {asking.error ? <p className="punt-error">{asking.error}</p> : null}
                  </div>
                ) : null}

                <footer className="punt-actions">
                  {!asking && (
                    <button
                      type="button"
                      className="card-link"
                      disabled={busy}
                      onClick={() => setAsk({ id: b.id, text: "", error: "" })}
                    >
                      Saldo bijwerken
                    </button>
                  )}
                  {(status.state === "due" || status.state === "overdue") && (
                    <button
                      type="button"
                      className="card-link"
                      disabled={busy}
                      onClick={() => onSave(snoozeTracker(balances, b.id, addDaysISO(asOf, 30)))}
                    >
                      Niet nu
                    </button>
                  )}
                  <label className="punt-interval">
                    <span className="eyebrow">Vraag me</span>
                    <select
                      aria-label={`Herinnering ${b.program}`}
                      value={String(b.intervalDays ?? 90)}
                      disabled={busy}
                      onChange={(e) => changeInterval(b.id, Number(e.target.value))}
                    >
                      {INTERVALS.map((i) => (
                        <option key={i.days} value={String(i.days)}>
                          {i.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="card-link card-link-danger" disabled={busy} onClick={() => remove(b.id)}>
                    Verwijder
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <div className="view-head">
        <h3>Saldo toevoegen</h3>
        <span className="eyebrow">of een bestaand programma overschrijven</span>
      </div>
      <div className="stack-form punt-form">
        <div className="stack-form-row">
          <label>
            Programma
            <input list="reward-programs" value={program} disabled={busy} aria-label="Programma"
              onChange={(e) => setProgram(e.target.value)} />
            <datalist id="reward-programs">
              {REWARD_PROGRAMS.map((p) => <option key={p.name} value={p.name} />)}
            </datalist>
          </label>
          <label>
            {addUnit === "eur" ? "Cashback in hele euro's" : "Punten"}
            <input className="saldo-input" inputMode="decimal" value={points}
              disabled={busy} aria-label={addUnit === "eur" ? "Cashback in hele euro's" : "Punten"}
              placeholder={addUnit === "eur" ? "bijv. 42" : "bijv. 245000"}
              onChange={(e) => setPoints(e.target.value)} />
          </label>
          <label>
            Gezien op
            <input type="date" value={updatedAt} disabled={busy} aria-label="Bijgewerkt op"
              onChange={(e) => setUpdatedAt(e.target.value)} />
          </label>
        </div>
        <div className="stack-form-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={add}>Opslaan</button>
        </div>
        {addError ? <p className="punt-error">{addError}</p> : null}
      </div>
    </section>
  );
}
