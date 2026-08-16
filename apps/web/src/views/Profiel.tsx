import { Fragment, useEffect, useMemo, useRef } from "react";
import type { EntityScope, EntitySummary, Rule } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import ModulePicker from "../components/ModulePicker";
import type { ModuleId } from "../components/moduleRegistry";
import { countryList, countryName, regionLabel, regionsFor } from "../countries.js";
import { ownerDisplayName, type OwnerName } from "../settings.js";
import { SCOPE_LABELS, SCOPE_ORDER } from "../scope.js";
import Import from "./Import";
import Regels from "./Regels";
import Koppelingen from "./Koppelingen";
import Backup from "./Backup";

/* Profiel — everything that is a setting rather than a place you work.
 *
 * The nav was overcrowded because it showed the whole catalogue. So the nav now
 * shows only the modules the owner picked, and this page holds the picker plus
 * the four things that were never workspaces at all: Regels, Koppelingen,
 * Back-up and Import. Those are rendered here as the EXISTING components — the
 * same code, the same behaviour, a different place — so there is one
 * implementation of each, not two.
 *
 * Also here: the country that drives the tax rules and where LaVega looks up
 * card terms, and Vergrendelen. */

type ProfielProps = {
  /** Module picker. */
  enabledModules: ModuleId[];
  onModulesChange: (next: ModuleId[]) => void;
  /** Bumped by "Widget toevoegen" in the header, which opens this same picker. */
  focusModules: number;
  /** One row per entity, with the classification the Persoonlijk | Zakelijk
   *  switch in the header reads. */
  entities: EntitySummary[];
  onClassifyEntity: (entity: string, scope: EntityScope) => void;
  /** Country/region that drives the tax rules and the card-terms lookups. */
  homeCountry: string;
  onHomeCountryChange: (code: string) => void;
  /** The level under the country. "" means he has not said — never a default. */
  homeRegion: string;
  onHomeRegionChange: (region: string) => void;
  /** The owner's own name. A local preference; it never leaves this browser. */
  ownerName: OwnerName;
  onOwnerNameChange: (name: OwnerName) => void;
  onLock: () => void;
  /** Import (unchanged component, moved here from the homescreen). */
  entity: string;
  onEntityChange: (entity: string) => void;
  busy: boolean;
  problems: string[];
  onImport: (file: File) => void;
  /** Regels (unchanged component). */
  rules: Rule[];
  ruleMatch: string;
  onRuleMatchChange: (match: string) => void;
  ruleCategory: string;
  onRuleCategoryChange: (category: string) => void;
  onSaveRules: (next: Rule[]) => void;
  /** Back-up (unchanged component). */
  storage: VaultStorage;
  asOf: string;
  onRestored: () => void;
};

export default function Profiel({
  enabledModules,
  onModulesChange,
  focusModules,
  entities,
  onClassifyEntity,
  homeCountry,
  onHomeCountryChange,
  homeRegion,
  onHomeRegionChange,
  ownerName,
  onOwnerNameChange,
  onLock,
  entity,
  onEntityChange,
  busy,
  problems,
  onImport,
  rules,
  ruleMatch,
  onRuleMatchChange,
  ruleCategory,
  onRuleCategoryChange,
  onSaveRules,
  storage,
  asOf,
  onRestored,
}: ProfielProps) {
  const modulesRef = useRef<HTMLElement>(null);
  // 249 countries; built once rather than on every keystroke elsewhere on the page.
  const countries = useMemo(() => countryList(), []);
  const regions = regionsFor(homeCountry);
  const fullName = ownerDisplayName(ownerName);
  // The initials are drawn, not fetched: a remote avatar would tell that server
  // who is using LaVega. No name, no initials — an empty circle, not a guess.
  const initials = [ownerName.first, ownerName.last]
    .map((s) => s.trim().charAt(0).toUpperCase())
    .filter(Boolean)
    .join("");

  // "Widget toevoegen" lands on this page; bring the picker into view rather
  // than dropping the user at the top of a long settings page. Guarded: jsdom
  // has no scrollIntoView.
  useEffect(() => {
    if (focusModules === 0) return;
    modulesRef.current?.scrollIntoView?.({ block: "start" });
  }, [focusModules]);

  return (
    <>
      {/* The owner, at the very top, so the page reads as his own screen and not
          as a settings menu. The name is a local preference like the buffer and
          the country: this browser only, never in the vault, never in a
          back-up, and deliberately never in anything a model is given. */}
      <section className="card profile-head" aria-label="Profiel">
        <span className="profile-head-avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="profile-head-text">
          <h2 className="profile-head-name">{fullName || "Nog geen naam ingevuld"}</h2>
          <p className="cell-sub">
            Alleen voor dit scherm. Je naam blijft in deze browser — niet in de kluis, niet in een
            back-up, en hij wordt nooit meegestuurd naar een model.
          </p>
          <div className="profile-head-fields">
            <label>
              Voornaam{" "}
              <input
                value={ownerName.first}
                aria-label="Voornaam"
                autoComplete="off"
                onChange={(e) => onOwnerNameChange({ ...ownerName, first: e.target.value })}
              />
            </label>{" "}
            <label>
              Achternaam{" "}
              <input
                value={ownerName.last}
                aria-label="Achternaam"
                autoComplete="off"
                onChange={(e) => onOwnerNameChange({ ...ownerName, last: e.target.value })}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="card" aria-label="Modules" ref={modulesRef}>
        <div className="card-header">
          <h2>Modules</h2>
          <span className="eyebrow">{enabledModules.length} in je navigatie</span>
        </div>
        <p className="cell-sub">
          Zet aan wat jij gebruikt. Wat aan staat verschijnt in de balk bovenin; wat uit staat verdwijnt
          daaruit — je gegevens blijven staan en je kunt het hier altijd weer aanzetten.
        </p>
        <ModulePicker enabled={enabledModules} onChange={onModulesChange} />
      </section>

      <section className="card" aria-label="Persoonlijk of zakelijk">
        <div className="card-header">
          <h2>Persoonlijk of zakelijk</h2>
          <span className="eyebrow">{entities.length} {entities.length === 1 ? "eenheid" : "eenheden"}</span>
        </div>
        <p className="cell-sub">
          De schakelaar bovenin toont één helft van je geld. Hier bepaal je zelf welke helft een bedrijf of
          rekening bij hoort. Wat je niet indeelt telt als persoonlijk — LaVega gokt dat nooit voor je.
        </p>

        {entities.length === 0 ? (
          <p className="text-muted">Nog geen rekeningen. Importeer er één, dan verschijnt hij hier.</p>
        ) : (
          <ul className="scope-list">
            {entities.map((e) => (
              <li key={e.entity} className="scope-item">
                <div className="scope-item-text">
                  <span className="scope-item-name">{e.entity}</span>
                  <span className="mp-what">
                    {e.accountKeys.length} {e.accountKeys.length === 1 ? "rekening" : "rekeningen"}
                    {!e.explicit && ` · niet ingedeeld, telt als ${SCOPE_LABELS.personal.toLowerCase()}`}
                    {!e.explicit && e.suggested !== e.scope && ` · de naam leest als ${SCOPE_LABELS[e.suggested].toLowerCase()}`}
                  </span>
                </div>

                <div className="scope-switch" role="group" aria-label={`${e.entity}: persoonlijk of zakelijk`}>
                  {SCOPE_ORDER.map((s, i) => (
                    <Fragment key={s}>
                      {i > 0 && <span className="scope-rule" aria-hidden="true" />}
                      <button
                        type="button"
                        className={`scope-option${e.scope === s ? " scope-on" : ""}`}
                        aria-pressed={e.scope === s}
                        aria-label={`${e.entity} ${SCOPE_LABELS[s].toLowerCase()}`}
                        onClick={() => onClassifyEntity(e.entity, s)}
                      >
                        {SCOPE_LABELS[s]}
                      </button>
                    </Fragment>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-label="Land en regio">
        <h2>Land en regio</h2>
        <p className="cell-sub">
          Bepaalt welke belastingregels LaVega gebruikt en in welke markt het de voorwaarden van je kaarten
          opzoekt. De belastingmodules zijn op dit moment alleen voor Nederland uitgewerkt.
        </p>
        <p className="cell-sub">
          Je vult dit zelf in. LaVega leidt nooit af waar je bent — geen locatie, geen IP, geen tijdzone.
        </p>
        <div className="facturen-form">
          <label>
            Land{" "}
            <select value={homeCountry} onChange={(e) => onHomeCountryChange(e.target.value)} aria-label="Land">
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            {regionLabel(homeCountry)}{" "}
            {/* A list where we have a verified one, free text everywhere else:
                belasting in Texas is niet belasting in New York, maar een
                verzonnen keuzelijst voor de andere 247 landen zou een gok voor
                een feit laten doorgaan. */}
            <input
              value={homeRegion}
              list={regions.length > 0 ? "home-regions" : undefined}
              aria-label={`${regionLabel(homeCountry)} in ${countryName(homeCountry)}`}
              placeholder={regions.length > 0 ? "Kies of typ" : "Optioneel"}
              autoComplete="off"
              onChange={(e) => onHomeRegionChange(e.target.value)}
            />
            {regions.length > 0 && (
              <datalist id="home-regions">
                {regions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            )}
          </label>
        </div>
        <p className="cell-sub">
          {regions.length > 0
            ? `LaVega kent de lijst voor ${countryName(homeCountry)}; je mag ook zelf iets intypen.`
            : `Voor ${countryName(homeCountry)} heeft LaVega geen geverifieerde regiolijst — typ hem zelf, of laat hem leeg.`}
        </p>
      </section>

      <Import entity={entity} onEntityChange={onEntityChange} busy={busy} problems={problems} onImport={onImport} />

      <Koppelingen />

      <Regels
        rules={rules}
        busy={busy}
        ruleMatch={ruleMatch}
        onRuleMatchChange={onRuleMatchChange}
        ruleCategory={ruleCategory}
        onRuleCategoryChange={onRuleCategoryChange}
        onSaveRules={onSaveRules}
      />

      <Backup storage={storage} asOf={asOf} onRestored={onRestored} />

      <section className="card" aria-label="Vergrendelen">
        <h2>Vergrendelen</h2>
        <p className="cell-sub">
          Sluit de kluis en wist alles uit het geheugen van deze browser. Je hebt je wachtwoord nodig om weer
          binnen te komen.
        </p>
        <button type="button" className="btn" onClick={onLock}>
          Vergrendel
        </button>
      </section>
    </>
  );
}
