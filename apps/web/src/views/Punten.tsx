import { useState } from "react";
import type { RewardsBalance } from "@lavega/core";
import { makeRewardsBalance, isStale, REWARD_PROGRAMS } from "@lavega/core";

/** Replace the balance with the same id, or append it. */
export function upsertBalance(list: RewardsBalance[], b: RewardsBalance): RewardsBalance[] {
  const i = list.findIndex((x) => x.id === b.id);
  if (i === -1) return [...list, b];
  const next = [...list];
  next[i] = b;
  return next;
}

export default function Punten({
  balances, asOf, busy, onSave,
}: { balances: RewardsBalance[]; asOf: string; busy: boolean; onSave: (next: RewardsBalance[]) => void }) {
  const [program, setProgram] = useState(REWARD_PROGRAMS[0].name);
  const [points, setPoints] = useState("");
  const [updatedAt, setUpdatedAt] = useState(asOf);

  function add() {
    const pts = Number(points.replace(/\./g, "").replace(",", "."));
    if (!program.trim() || !Number.isFinite(pts) || pts <= 0 || !updatedAt) return;
    onSave(upsertBalance(balances, makeRewardsBalance({ program: program.trim(), points: Math.round(pts), updatedAt })));
    setPoints("");
  }
  function remove(id: string) {
    onSave(balances.filter((b) => b.id !== id));
  }

  return (
    <section className="card" aria-label="Punten">
      <div className="card-header">
        <h2>Punten</h2>
        <span className="eyebrow">loyalty &amp; rewards</span>
      </div>
      <p className="cell-sub">
        Houd je punten- en cashback-saldi bij. Je vult de saldi zelf bij — er is geen koppeling die
        punten automatisch ophaalt.
      </p>
      <p className="cell-sub">
        Wat je punten waard zijn en de beste inwissel/transfer: vraag de LaVega-assistent rechtsonder
        — die zoekt actuele waardes live op.
      </p>

      <div className="facturen-form">
        <label>Programma{" "}
          <input list="reward-programs" value={program} disabled={busy} aria-label="Programma"
            onChange={(e) => setProgram(e.target.value)} />
          <datalist id="reward-programs">
            {REWARD_PROGRAMS.map((p) => <option key={p.name} value={p.name} />)}
          </datalist>
        </label>{" "}
        <label>Punten{" "}
          <input className="saldo-input" type="number" min={0} step={1} value={points}
            disabled={busy} aria-label="Punten" onChange={(e) => setPoints(e.target.value)} />
        </label>{" "}
        <label>Bijgewerkt{" "}
          <input type="date" value={updatedAt} disabled={busy} aria-label="Bijgewerkt op"
            onChange={(e) => setUpdatedAt(e.target.value)} />
        </label>{" "}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={add}>Opslaan</button>
      </div>

      {balances.length === 0 ? (
        <p>Nog geen punten-saldi.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Programma</th><th>Punten</th><th>Bijgewerkt</th><th></th></tr>
            </thead>
            <tbody>
              {balances.map((b) => {
                const stale = isStale(b, asOf);
                return (
                  <tr key={b.id}>
                    <td>{b.program}</td>
                    <td>{b.points.toLocaleString("nl-NL")}</td>
                    <td>{b.updatedAt}{stale ? <span className="badge" style={{ marginLeft: "var(--sp-1)" }}>verouderd</span> : null}</td>
                    <td><button type="button" className="btn" disabled={busy} onClick={() => remove(b.id)}>verwijder</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
