import { useMemo, useState } from "react";
import type { Account, ScheduledFlow, Tx, VatSettings } from "@lavega/core";
import { computeVatSetAside, nextBtwDeadline, rebuildVatFlows } from "@lavega/core";
import { formatEuro } from "../format";

type BelastingProps = {
  entities: string[];
  txs: Tx[];
  // Needed to scope txs per entity (Tx only carries accountKey, not entity).
  accounts: Account[];
  asOf: string;
  vatSettings: VatSettings[];
  scheduledFlows: ScheduledFlow[];
  busy: boolean;
  onSaveVatSettings: (s: VatSettings[]) => void;
  onSaveScheduledFlows: (f: ScheduledFlow[]) => void;
};

const FREQ_LABELS: Record<VatSettings["frequency"], string> = {
  monthly: "Maandelijks",
  quarterly: "Per kwartaal",
  yearly: "Jaarlijks",
};

function defaultSettings(entity: string): VatSettings {
  return { entity, frequency: "quarterly", defaultRatePct: 21, mixedRates: false };
}

export default function Belasting({
  entities,
  txs,
  accounts,
  asOf,
  vatSettings,
  scheduledFlows,
  busy,
  onSaveVatSettings,
  onSaveScheduledFlows,
}: BelastingProps) {
  // Local, editable overrides per entity. Falls back to the saved settings and
  // then a sensible default, so a fresh entity is immediately usable. Committed
  // to storage only on "Bereken & bewaar" (mirrors the rest of the app's
  // draft-then-persist pattern).
  const [drafts, setDrafts] = useState<Record<string, VatSettings>>({});

  const savedByEntity = useMemo(() => {
    const m = new Map<string, VatSettings>();
    for (const s of vatSettings) m.set(s.entity, s);
    return m;
  }, [vatSettings]);

  const keyToEntity = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.key, a.entity);
    return m;
  }, [accounts]);

  function resolve(entity: string): VatSettings {
    return drafts[entity] ?? savedByEntity.get(entity) ?? defaultSettings(entity);
  }

  function patch(entity: string, partial: Partial<VatSettings>) {
    setDrafts((prev) => {
      const current = prev[entity] ?? savedByEntity.get(entity) ?? defaultSettings(entity);
      return { ...prev, [entity]: { ...current, ...partial } };
    });
  }

  function entityTxs(entity: string): Tx[] {
    return txs.filter((t) => keyToEntity.get(t.accountKey) === entity);
  }

  // Persist the (draft) settings for the visible entities and recompute their
  // VAT ScheduledFlows: drop each shown entity's old source:"vat" flow, add the
  // freshly computed one when non-null. Flows/settings for entities NOT shown
  // (e.g. filtered out by a top-bar scope) are preserved untouched.
  function berekenEnBewaar() {
    const shown = new Set(entities);

    const preservedSettings = vatSettings.filter((s) => !shown.has(s.entity));
    const nextSettings = [...preservedSettings, ...entities.map((e) => resolve(e))];
    onSaveVatSettings(nextSettings);

    const freshFlows: ScheduledFlow[] = [];
    for (const e of entities) {
      const f = computeVatSetAside(entityTxs(e), resolve(e), asOf);
      if (f) freshFlows.push(f);
    }
    onSaveScheduledFlows(rebuildVatFlows(scheduledFlows, entities, freshFlows));
  }

  return (
    <section className="card" aria-label="Belasting">
      <div className="card-header">
        <h2>Belasting · BTW</h2>
        <span className="eyebrow">indicatieve schatting</span>
      </div>
      <p className="cell-sub">
        LaVega schat per BV het BTW-bedrag dat je opzij moet zetten, plaatst het op de
        aangiftedeadline in de forecast en trekt het af van je beschikbare saldo. De
        schatting is een marge-benadering (netto-BTW ≈ marge × tarief ⁄ (100 + tarief)) —
        geen exacte aangifte. Zet handmatig of gebruik "Gemengde tarieven" bij afwijkende
        tarieven.
      </p>

      {entities.length === 0 ? (
        <p>Nog geen entiteiten — importeer eerst rekeningen.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Entiteit</th>
                  <th>Frequentie</th>
                  <th>BTW %</th>
                  <th>Gemengd</th>
                  <th>Handmatig €</th>
                  <th>Volgende deadline</th>
                  <th>Geschat opzij</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((entity) => {
                  const s = resolve(entity);
                  const { periodLabel, deadline } = nextBtwDeadline(s.frequency, asOf);
                  const preview = computeVatSetAside(entityTxs(entity), s, asOf);
                  return (
                    <tr key={entity}>
                      <td>{entity}</td>
                      <td>
                        <select
                          value={s.frequency}
                          disabled={busy}
                          aria-label={`BTW-frequentie ${entity}`}
                          onChange={(e) => patch(entity, { frequency: e.target.value as VatSettings["frequency"] })}
                        >
                          {(Object.keys(FREQ_LABELS) as VatSettings["frequency"][]).map((f) => (
                            <option key={f} value={f}>
                              {FREQ_LABELS[f]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="saldo-input"
                          type="number"
                          step={1}
                          min={0}
                          value={s.defaultRatePct}
                          disabled={busy}
                          aria-label={`BTW-tarief ${entity}`}
                          onChange={(e) =>
                            patch(entity, { defaultRatePct: e.target.value === "" ? 0 : Number(e.target.value) })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={s.mixedRates}
                          disabled={busy}
                          aria-label={`Gemengde tarieven ${entity}`}
                          onChange={(e) => patch(entity, { mixedRates: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          className="saldo-input"
                          type="number"
                          step={0.01}
                          min={0}
                          placeholder="auto"
                          value={s.manualCents != null ? s.manualCents / 100 : ""}
                          disabled={busy}
                          aria-label={`Handmatig BTW-bedrag ${entity}`}
                          onChange={(e) =>
                            patch(entity, {
                              manualCents: e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100),
                            })
                          }
                        />
                      </td>
                      <td>
                        <span className="cell-sub">{periodLabel}</span>
                        <br />
                        {deadline}
                      </td>
                      <td className={preview ? "text-neg" : ""}>
                        {preview ? formatEuro(preview.amountCents / 100) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button type="button" className="btn btn-primary" disabled={busy} onClick={berekenEnBewaar}>
            Bereken &amp; bewaar
          </button>
        </>
      )}
    </section>
  );
}
