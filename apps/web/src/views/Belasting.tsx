import { useMemo, useState } from "react";
import type { Account, CountryCode, ScheduledFlow, Tx, VatSettings } from "@lavega/core";
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY,
  computeProfitTaxPrepayments,
  computeTaxReservations,
  computeVatSetAside,
  nextVatPeriod,
  rebuildVatFlows,
  taxPack,
} from "@lavega/core";
import { formatEuro } from "../format";
import { getHomeCountry } from "../settings";
import Module from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import "../styles/views.css";

/* Belasting — one module per tax that is ACTUALLY relevant (UI review,
 * 2026-08-16).
 *
 * Which modules appear is decided by the country in the profile
 * (`getHomeCountry`) resolved against the rule packs in
 * packages/core/src/taxpacks/. NL has a VAT pack and deliberately no profit-tax
 * prepayment (the Belastingdienst sets the voorlopige aanslag itself), so NL
 * gets one tax module; DE also prepays profit tax, so DE gets two. Nothing here
 * names a country and nothing invents a tax LaVega cannot compute — a third
 * country is a new pack, and this view follows it without a change.
 *
 * The grey instruction paragraph under the title is gone. What it explained
 * that still matters (the estimate is a margin proxy, the packs are indicative)
 * now sits on the module it belongs to. */

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

/** The profile's country, narrowed to a country LaVega actually has rules for.
 *  An unknown code falls back rather than throwing — `taxPack` does the same,
 *  and a blank tax screen is worse than the default rules. */
function homeCountryCode(): CountryCode {
  const raw = getHomeCountry();
  return COUNTRY_OPTIONS.find((o) => o.code === raw)?.code ?? DEFAULT_COUNTRY;
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
  // then the country pack's defaults, so a fresh entity is immediately usable.
  // Committed to storage only on "Bereken & bewaar" (mirrors the rest of the
  // app's draft-then-persist pattern).
  const [drafts, setDrafts] = useState<Record<string, VatSettings>>({});
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const country = homeCountryCode();
  const pack = useMemo(() => taxPack(country), [country]);
  // Hoisted so the narrowing survives into the callbacks below.
  const profitTax = pack.profitTax;

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

  function defaultSettings(entity: string): VatSettings {
    return {
      entity,
      frequency: pack.vat.frequencies.includes("quarterly") ? "quarterly" : pack.vat.frequencies[0],
      defaultRatePct: pack.vat.defaultRatePct,
      mixedRates: false,
      country,
    };
  }

  /** The settings in force for an entity. The COUNTRY always comes from the
   *  profile — that is the single switch this whole screen is driven by — while
   *  the rate/frequency he set himself are left alone. A frequency this country
   *  does not allow is replaced rather than filed. */
  function resolve(entity: string): VatSettings {
    const base = drafts[entity] ?? savedByEntity.get(entity) ?? defaultSettings(entity);
    const frequency = pack.vat.frequencies.includes(base.frequency) ? base.frequency : pack.vat.frequencies[0];
    return { ...base, country, frequency };
  }

  function patch(entity: string, partial: Partial<VatSettings>) {
    setSavedNote(null);
    setDrafts((prev) => ({ ...prev, [entity]: { ...resolve(entity), ...partial } }));
  }

  function entityTxs(entity: string): Tx[] {
    return txs.filter((t) => keyToEntity.get(t.accountKey) === entity);
  }

  // Persist the (draft) settings for the visible entities and recompute their
  // tax ScheduledFlows — the VAT set-aside AND, in a country that prepays
  // profit tax, its prepayments/settlement. Flows/settings for entities NOT
  // shown (e.g. filtered out by a top-bar scope) are preserved untouched.
  function berekenEnBewaar() {
    const shown = new Set(entities);

    const preservedSettings = vatSettings.filter((s) => !shown.has(s.entity));
    const nextSettings = [...preservedSettings, ...entities.map((e) => resolve(e))];
    onSaveVatSettings(nextSettings);

    const freshFlows: ScheduledFlow[] = [];
    for (const e of entities) {
      freshFlows.push(...computeTaxReservations({ txs: entityTxs(e), settings: resolve(e), asOf }));
    }
    onSaveScheduledFlows(rebuildVatFlows(scheduledFlows, entities, freshFlows));
    setSavedNote(
      freshFlows.length === 0
        ? "Bewaard. Er is niets te reserveren met de huidige gegevens — geen bedrag is dus ook geen nul in je forecast."
        : `Bewaard. ${freshFlows.length} reservering${freshFlows.length === 1 ? "" : "en"} staan nu in je forecast en zijn van je beschikbare saldo afgetrokken.`,
    );
  }

  if (entities.length === 0) {
    return (
      <>
        <div className="view-head">
          <h2>Belasting · {pack.label}</h2>
          <span className="eyebrow">regels per {pack.rulesAsOf}</span>
        </div>
        <section className="card" aria-label="Belasting">
          <p>Nog geen entiteiten — importeer eerst rekeningen.</p>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="view-head">
        <h2>Belasting · {pack.label}</h2>
        <span className="eyebrow">
          {profitTax ? "2 belastingen" : "1 belasting"} · regels per {pack.rulesAsOf}
        </span>
      </div>

      <ModuleGrid className="grid-2" label="Belastingen">
        {/* ── Module 1: de omzetbelasting van dit land ──────────────────── */}
        <Module
          title={pack.vat.label}
          height="tall"
          footer={
            <span>
              Tarieven in {pack.label}: {pack.vat.rates.map((r) => `${r}%`).join(" / ")}. Zonder eigen boekhouding is
              dit een marge-benadering (netto ≈ marge × tarief ⁄ (100 + tarief)), geen aangifte.
            </span>
          }
        >
          {entities.map((entity) => {
            const s = resolve(entity);
            const { periodLabel, deadline } = nextVatPeriod(s.frequency, asOf, s.country);
            const preview = computeVatSetAside(entityTxs(entity), s, asOf);
            return (
              <div className="tax-entity" key={entity}>
                <div className="tax-entity-head">
                  <span className="tax-entity-name">{entity}</span>
                  <span className={`tax-entity-figure ${preview ? "text-neg" : ""}`}>
                    {preview ? formatEuro(preview.amountCents / 100) : s.mixedRates ? "geen schatting" : "—"}
                  </span>
                </div>
                <p className="cell-sub">
                  {periodLabel} · uiterlijk {deadline}
                  {preview ? " — dit bedrag staat op die datum in je forecast." : ""}
                  {!preview && s.mixedRates
                    ? " — gemengde tarieven: LaVega schat niets en zet ook geen nul; vul het bedrag handmatig in."
                    : ""}
                </p>
                <div className="tax-fields">
                  <label>
                    Frequentie
                    <select
                      value={s.frequency}
                      disabled={busy}
                      aria-label={`${pack.vat.label}-frequentie ${entity}`}
                      onChange={(e) => patch(entity, { frequency: e.target.value as VatSettings["frequency"] })}
                    >
                      {pack.vat.frequencies.map((f) => (
                        <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tarief %
                    <input
                      className="saldo-input"
                      type="number"
                      step={1}
                      min={0}
                      value={s.defaultRatePct}
                      disabled={busy}
                      aria-label={`${pack.vat.label}-tarief ${entity}`}
                      onChange={(e) => patch(entity, { defaultRatePct: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Handmatig €
                    <input
                      className="saldo-input"
                      type="number"
                      step={0.01}
                      min={0}
                      placeholder="auto"
                      value={s.manualCents != null ? s.manualCents / 100 : ""}
                      disabled={busy}
                      aria-label={`Handmatig ${pack.vat.label}-bedrag ${entity}`}
                      onChange={(e) =>
                        patch(entity, {
                          manualCents: e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100),
                        })
                      }
                    />
                  </label>
                  <label>
                    Gemengde tarieven
                    <input
                      type="checkbox"
                      checked={s.mixedRates}
                      disabled={busy}
                      aria-label={`Gemengde tarieven ${entity}`}
                      onChange={(e) => patch(entity, { mixedRates: e.target.checked })}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </Module>

        {/* ── Module 2: alleen in een land dat winstbelasting vooruit laat
             betalen. NL heeft die niet, dus NL ziet deze module niet. ─────── */}
        {profitTax && (
          <Module
            title={profitTax.label}
            height="tall"
            footer={<span>{profitTax.rateBasis}</span>}
          >
            <p className="view-lead">{profitTax.what}</p>
            {entities.map((entity) => {
              const s = resolve(entity);
              const flows = computeProfitTaxPrepayments(entityTxs(entity), s, asOf);
              const total = flows.reduce((sum, f) => sum + f.amountCents, 0);
              return (
                <div className="tax-entity" key={entity}>
                  <div className="tax-entity-head">
                    <span className="tax-entity-name">{entity}</span>
                    <span className={`tax-entity-figure ${total > 0 ? "text-neg" : ""}`}>
                      {flows.length > 0 ? formatEuro(total / 100) : "—"}
                    </span>
                  </div>
                  {flows.length === 0 ? (
                    <p className="cell-sub">
                      Nog niets te reserveren: LaVega ziet dit jaar geen winst in de banktransacties van deze
                      entiteit, en verzint er geen. Zodra het {pack.label === "Duitsland" ? "Finanzamt" : "de fiscus"} een
                      bedrag oplegt, vul je dat hieronder in.
                    </p>
                  ) : (
                    <div className="tax-flows">
                      {flows.map((f) => (
                        <div className="tax-flow" key={f.id}>
                          <span>
                            {f.label} · {f.dueDate}{" "}
                            {f.status === "expected" && <span className="badge">schatting</span>}
                          </span>
                          <span className="text-neg">{formatEuro(f.amountCents / 100)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="tax-fields" style={{ marginTop: "var(--sp-3)" }}>
                    <label>
                      Tarief %
                      <input
                        className="saldo-input"
                        type="number"
                        step={0.1}
                        min={0}
                        placeholder={String(profitTax.defaultRatePct)}
                        value={s.profitTaxRatePct ?? ""}
                        disabled={busy}
                        aria-label={`Winstbelastingtarief ${entity}`}
                        onChange={(e) =>
                          patch(entity, { profitTaxRatePct: e.target.value === "" ? undefined : Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Opgelegd bedrag €
                      <input
                        className="saldo-input"
                        type="number"
                        step={0.01}
                        min={0}
                        placeholder="nog geen aanslag"
                        value={s.profitTaxManualCents != null ? s.profitTaxManualCents / 100 : ""}
                        disabled={busy}
                        aria-label={`Opgelegde winstbelasting ${entity}`}
                        onChange={(e) =>
                          patch(entity, {
                            profitTaxManualCents:
                              e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </Module>
        )}

        {/* ── Wat dit land WEL heeft maar LaVega niet berekent. Hoort erbij:
             de lijst hierboven is anders niet te beoordelen. ──────────────── */}
        <Module title="Wat LaVega hier niet berekent" span={profitTax ? 2 : 1}>
          <ul className="tax-caveats">
            {pack.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Module>
      </ModuleGrid>

      <div className="stack-form-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={berekenEnBewaar}>
          Bereken &amp; bewaar
        </button>
      </div>
      {savedNote && <p className="cell-sub">{savedNote}</p>}
    </>
  );
}
