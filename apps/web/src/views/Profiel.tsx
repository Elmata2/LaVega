import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Account, EntityScope, EntitySummary, LearnedFact, Rule } from "@lavega/core";
import {
  accountType,
  assumptionDueForReview,
  CATALOGUE_KINDS_FOR,
  describeHeldCashback,
  factEntry,
  factId,
  factNumber,
  heldCashbackOf,
  isSpendable,
  lastTermsCheckedForIssuer,
  learnFacts,
  makeFact,
  productOf,
  TRAVEL_AGENT,
} from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import ModulePicker, { WidgetPicker } from "../components/ModulePicker";
import { WIDGETS, useOverviewWidgets, type ModuleId } from "../components/moduleRegistry";
import { CATALOGUE_ENTRIES } from "../catalogue-rates";
import { countryList, countryName, regionLabel, regionsFor } from "../countries.js";
import {
  getCashbackAssumptionEnabled,
  ownerDisplayName,
  setCashbackAssumptionEnabled,
  type OwnerName,
} from "../settings.js";
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

/* ── CASHBACK CORRIGEREN — de feedbackmodule (app review 4, punt 22) ─────────
 *
 * Hij vroeg om twee dingen bij de aanname "een gewone kaart heeft geen
 * cashback": een jaarlijkse sweep, en "een feedbackmodule in de instellingen
 * waar de gebruiker informatie kan corrigeren". Dit is die module.
 *
 * DRIE BESLISSINGEN, en alle drie zijn ze de reden dat hij hier zo klein is:
 *
 *  1. HET IS GEEN TWEEDE MECHANISME. Wat hij invult wordt een `LearnedFact` met
 *     bron "user", door dezelfde `learnFacts` als elke agent — en een
 *     gebruikersfeit verslaat elke agent, dat staat in `upsertFacts` en niet
 *     hier. Een eigen "correcties"-tabel ernaast zou betekenen dat er twee
 *     plekken zijn waar een cijfer vandaan kan komen, en dan wint op een dag de
 *     verkeerde.
 *
 *  2. ER GAAT NIETS NAAR EEN SERVER. "Feedback" betekent in de meeste apps: naar
 *     ons toe. Hier betekent het: naar zijn eigen kluis. Er is geen knop die iets
 *     verstuurt, en de tekst zegt dat ook, want anders vult niemand het in.
 *
 *  3. DE SCHAKELAAR STAAT HIER OOK. De aanname buigt de regel die deze app
 *     draagt ("onbekend is nooit nul"), en wie ooit twijfelt aan een nul op zijn
 *     scherm moet in één klik kunnen zien wat er zónder de aanname overblijft.
 *     Een aanname die je niet kunt uitzetten is niet te controleren.
 *
 * WAAROM DIT ZIJN EIGEN GEGEVENS UIT DE KLUIS LEEST in plaats van ze als prop te
 * krijgen: de rekeningen en de feiten hangen in App aan de schermen die ermee
 * rekenen, en die weg loopt niet langs Profiel. Lezen uit `storage` is dezelfde
 * kluis en geen tweede bron — maar het betekent wel dat een correctie die hier
 * wordt opgeslagen pas op Optimalisatie verschijnt nadat App zijn feiten opnieuw
 * inleest. Daarom de `onRestored()` aan het eind: dat is precies het signaal "de
 * kluis is onder je veranderd, lees hem opnieuw" dat Back-up ook geeft. */
function CashbackCorrigeren({
  storage,
  asOf,
  onRestored,
}: {
  storage: VaultStorage;
  asOf: string;
  onRestored: () => void;
}) {
  const [cards, setCards] = useState<Account[] | null>(null);
  const [facts, setFacts] = useState<LearnedFact[]>([]);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [assumptionOn, setAssumptionOn] = useState<boolean>(() => getCashbackAssumptionEnabled());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [loadedAccounts, loadedFacts] = await Promise.all([
          storage.getAccounts(),
          storage.getFacts(),
        ]);
        if (!alive) return;
        setCards(loadedAccounts.filter(isSpendable));
        setFacts(loadedFacts);
      } catch (e) {
        // De echte oorzaak, niet "er ging iets mis": een vergrendelde kluis en
        // een kapotte index vragen om een andere volgende stap.
        if (alive) setLoadProblem(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [storage]);

  /* Eén regel per PRODUCT, niet per rekening. Feiten zijn gekeyd op de
     productnaam ("ING betaalpas"), dus twee ING-betaalrekeningen zijn hier één
     vraag met één antwoord — twee regels zouden suggereren dat je ze los kunt
     zetten, en de tweede zou de eerste stil overschrijven. */
  const rows = useMemo(() => {
    const byProduct = new Map<
      string,
      { product: string; bank: string; kind: "betaalpas" | "creditcard"; names: string[] }
    >();
    for (const a of cards ?? []) {
      const product = productOf(a);
      if (!product) continue;
      const kind = accountType(a) === "Creditcard" ? "creditcard" : "betaalpas";
      const row = byProduct.get(product) ?? {
        product,
        bank: String(a.bank ?? ""),
        kind,
        names: [],
      };
      row.names.push(a.name || a.key);
      byProduct.set(product, row);
    }
    return [...byProduct.values()];
  }, [cards]);

  async function saveCorrection(product: string) {
    setSaved(null);
    setProblem(null);
    const raw = (drafts[product] ?? "").trim();
    if (raw === "") {
      setProblem(`Vul eerst een percentage in bij ${product}.`);
      return;
    }
    const incoming = makeFact({
      agent: TRAVEL_AGENT,
      subject: product,
      key: "cashbackPct",
      value: raw,
      source: "user",
      updatedAt: asOf,
    });
    // `learnFacts` en niet `upsertFacts`: dat is dezelfde samenvoeging, maar het
    // vertelt WAAROM iets geweigerd wordt. Een correctie die stil verdwijnt is
    // erger dan een correctie die niet kan.
    const { facts: next, rejected } = learnFacts(facts, [incoming]);
    if (rejected.length > 0) {
      setProblem(`${product}: ${rejected[0].reason}.`);
      return;
    }
    try {
      await storage.putFacts(next);
    } catch (e) {
      setProblem(`Opslaan in de kluis lukte niet: ${e instanceof Error ? e.message : String(e)}.`);
      return;
    }
    setFacts(next);
    setDrafts((d) => ({ ...d, [product]: "" }));
    setSaved(product);
    onRestored();
  }

  async function clearCorrection(product: string) {
    setSaved(null);
    setProblem(null);
    const id = factId(TRAVEL_AGENT, product, "cashbackPct");
    const next = facts.filter((f) => f.id !== id);
    try {
      await storage.putFacts(next);
    } catch (e) {
      setProblem(`Wissen lukte niet: ${e instanceof Error ? e.message : String(e)}.`);
      return;
    }
    setFacts(next);
    onRestored();
  }

  function toggleAssumption(on: boolean) {
    setCashbackAssumptionEnabled(on);
    setAssumptionOn(on);
  }

  return (
    <section className="card" aria-label="Cashback corrigeren">
      <div className="card-header">
        <h2>Cashback corrigeren</h2>
        <span className="eyebrow">
          {rows.length} {rows.length === 1 ? "kaart" : "kaarten"}
        </span>
      </div>
      <p className="cell-sub">
        Bij een gewone Nederlandse betaalpas of grootbankcreditcard neemt LaVega aan dat er geen
        cashback is. Dat is een aanname van ons en geen zin uit een document, dus je kunt hem hier
        terugdraaien: vul het percentage in dat jouw kaart echt geeft. Wat jij invult gaat vóór
        alles wat LaVega zelf vindt, ook na een volgende zoekopdracht.
      </p>
      <p className="cell-sub">
        Er gaat niets naar een server. Je correctie blijft in je eigen kluis, op dit apparaat.
      </p>
      {/* DE KEERZIJDE VAN DE REGEL, en die is net zo hard: een uitgesproken nul
          is een BEKENDE nul. Wie in de voorwaarden van zijn eigen kaart heeft
          gelezen dat er geen cashback is, hoort dat te kunnen vastleggen — dan
          staat er geen aanname meer maar zijn eigen vaststelling, en die
          verdwijnt niet als de aanname ooit wordt teruggedraaid. */}
      <p className="cell-sub">
        Weet je zeker dat een kaart niets teruggeeft? Vul dan <strong>0</strong> in. Dat is geen
        aanname meer maar jouw eigen vaststelling, en die blijft staan ook als je de aanname
        hieronder uitzet.
      </p>

      <label>
        <input
          type="checkbox"
          checked={assumptionOn}
          aria-label="Neem aan dat een gewone kaart geen cashback geeft"
          onChange={(e) => toggleAssumption(e.target.checked)}
        />{" "}
        Neem aan dat een gewone kaart geen cashback geeft
      </label>
      <p className="cell-sub">
        {assumptionOn
          ? "Staat aan. Zet hem uit om te zien wat er overblijft als LaVega alleen toont wat het echt gelezen heeft — dan staat er bij deze kaarten weer “onbekend”."
          : "Staat uit. Bij kaarten zonder gelezen cijfer staat nu “onbekend” in plaats van nul, en de vergelijking op Optimalisatie kan daar geen bedrag bij noemen."}
      </p>

      {loadProblem !== null ? (
        <p role="alert" className="text-warn">
          LaVega kon je rekeningen niet uit de kluis lezen: {loadProblem}. Zonder die lijst is er
          niets om te corrigeren.
        </p>
      ) : cards === null ? (
        <p className="text-muted">Bezig met lezen uit je kluis…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">
          Nog geen betaalrekening of creditcard in je kluis. Importeer er één, dan verschijnt hij
          hier.
        </p>
      ) : (
        <ul className="scope-list">
          {rows.map((row) => {
            const entry = factEntry(facts, TRAVEL_AGENT, row.product, "cashbackPct");
            const pctNow = factNumber(facts, TRAVEL_AGENT, row.product, "cashbackPct");
            const known = heldCashbackOf({
              issuer: row.bank,
              kind: row.kind,
              productName: row.product,
              fact:
                pctNow !== null && entry
                  ? { pct: pctNow, source: entry.source, updatedAt: entry.updatedAt }
                  : null,
              assumptionOn,
              // Dezelfde omweg als op Optimalisatie: zijn eigen kaart heeft geen
              // catalogusrij, dus de peildatum komt van de rijen van DEZE bank in
              // DIT soort product. Zonder die datum heet elke aanname voor altijd
              // "nog nooit nagekeken" en zegt de jaarlijkse blik niets meer.
              lastCheckedAt: lastTermsCheckedForIssuer(
                CATALOGUE_ENTRIES,
                row.bank,
                CATALOGUE_KINDS_FOR[row.kind],
              ),
            });
            const due =
              known.tier === "aangenomen" && assumptionDueForReview(known.lastCheckedAt, asOf);
            return (
              <li
                key={row.product}
                className="scope-item"
                data-testid={`cashback-fix-${row.product}`}
              >
                <div className="scope-item-text">
                  <span className="scope-item-name">{row.product}</span>
                  <span className="mp-what">
                    {describeHeldCashback(known)}
                    {due && " · een jaar of langer niet nagekeken"}
                    {row.names.length > 1 && ` · geldt voor ${row.names.length} rekeningen`}
                  </span>
                </div>
                <div>
                  <label>
                    <input
                      className="saldo-input"
                      inputMode="decimal"
                      aria-label={`Cashback ${row.product}`}
                      placeholder={pctNow === null ? "%" : String(pctNow)}
                      value={drafts[row.product] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [row.product]: e.target.value }))}
                    />
                  </label>{" "}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveCorrection(row.product)}
                  >
                    Opslaan
                  </button>{" "}
                  {entry !== null && entry.source === "user" && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void clearCorrection(row.product)}
                    >
                      Wis mijn correctie
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {problem !== null && (
        <p role="alert" className="text-warn">
          {problem}
        </p>
      )}
      {saved !== null && <p data-testid="cashback-opgeslagen">Opgeslagen voor {saved}.</p>}
    </section>
  );
}

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
  // The widget preference is read here rather than passed in: the switch lives
  // on this page and the cards live on the homescreen, two branches of the tree
  // that share nothing above them but App itself. See moduleRegistry.
  const [widgets, setWidgets] = useOverviewWidgets();
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
          Zet aan wat jij gebruikt. Wat aan staat verschijnt in de balk bovenin; wat uit staat
          verdwijnt daaruit — je gegevens blijven staan en je kunt het hier altijd weer aanzetten.
        </p>
        <ModulePicker enabled={enabledModules} onChange={onModulesChange} />
      </section>

      {/* The homescreen cards that are a choice rather than a fixture. Same
          switch as the modules above, one screen lower, because "welke tab" and
          "welke kaart" are the same question asked about a different surface.
          Both start off: he asked for a widget he can click on "instead of it
          always being default there". */}
      <section className="card" aria-label="Widgets">
        <div className="card-header">
          <h2>Widgets op je overzicht</h2>
          <span className="eyebrow">
            {widgets.length} van {WIDGETS.length} aan
          </span>
        </div>
        <p className="cell-sub">
          Deze twee kaarten staan uit tot je ze hier aanzet. Wat uit staat verschijnt niet op je
          startpagina — je gegevens blijven staan en je kunt het hier altijd weer aanzetten.
        </p>
        <WidgetPicker enabled={widgets} onChange={setWidgets} />
      </section>

      <section className="card" aria-label="Persoonlijk of zakelijk">
        <div className="card-header">
          <h2>Persoonlijk of zakelijk</h2>
          <span className="eyebrow">
            {entities.length} {entities.length === 1 ? "eenheid" : "eenheden"}
          </span>
        </div>
        <p className="cell-sub">
          De schakelaar bovenin toont één helft van je geld. Hier bepaal je zelf welke helft een
          bedrijf of rekening bij hoort. Wat je niet indeelt telt als persoonlijk — LaVega gokt dat
          nooit voor je.
        </p>

        {entities.length === 0 ? (
          <p className="text-muted">
            Nog geen rekeningen. Importeer er één, dan verschijnt hij hier.
          </p>
        ) : (
          <ul className="scope-list">
            {entities.map((e) => (
              <li key={e.entity} className="scope-item">
                <div className="scope-item-text">
                  <span className="scope-item-name">{e.entity}</span>
                  <span className="mp-what">
                    {e.accountKeys.length} {e.accountKeys.length === 1 ? "rekening" : "rekeningen"}
                    {!e.explicit &&
                      ` · niet ingedeeld, telt als ${SCOPE_LABELS.personal.toLowerCase()}`}
                    {!e.explicit &&
                      e.suggested !== e.scope &&
                      ` · de naam leest als ${SCOPE_LABELS[e.suggested].toLowerCase()}`}
                  </span>
                </div>

                <div
                  className="scope-switch"
                  role="group"
                  aria-label={`${e.entity}: persoonlijk of zakelijk`}
                >
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
          Bepaalt welke belastingregels LaVega gebruikt en in welke markt het de voorwaarden van je
          kaarten opzoekt. De belastingmodules zijn op dit moment alleen voor Nederland uitgewerkt.
        </p>
        <p className="cell-sub">
          Je vult dit zelf in. LaVega leidt nooit af waar je bent — geen locatie, geen IP, geen
          tijdzone.
        </p>
        <div className="facturen-form">
          <label>
            Land{" "}
            <select
              value={homeCountry}
              onChange={(e) => onHomeCountryChange(e.target.value)}
              aria-label="Land"
            >
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

      <Import
        entity={entity}
        onEntityChange={onEntityChange}
        busy={busy}
        problems={problems}
        onImport={onImport}
      />

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

      <CashbackCorrigeren storage={storage} asOf={asOf} onRestored={onRestored} />

      <Backup storage={storage} asOf={asOf} onRestored={onRestored} />

      <section className="card" aria-label="Vergrendelen">
        <h2>Vergrendelen</h2>
        <p className="cell-sub">
          Sluit de kluis en wist alles uit het geheugen van deze browser. Je hebt je wachtwoord
          nodig om weer binnen te komen.
        </p>
        <button type="button" className="btn" onClick={onLock}>
          Vergrendel
        </button>
      </section>
    </>
  );
}
