import { useMemo, useState } from "react";
import type {
  Account,
  CountryCode,
  CrossScopeAnswer,
  EntityProfile,
  Invoice,
  OwnName,
  ScheduledFlow,
  TaxFigures,
  TaxSheetProblem,
  TaxSheetRow,
  Tx,
  VatNote,
  VatPosition,
  VatSettings,
} from "@lavega/core";
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY,
  answerCrossScope,
  computeProfitTaxPrepayments,
  computeTaxReservations,
  nextVatPeriod,
  readSheetCsv,
  readTaxSheet,
  rebuildVatFlows,
  resolveVatSettings,
  suggestTaxSheetMapping,
  sumTaxFigures,
  taxPack,
  txsForEntity,
  vatPosition,
} from "@lavega/core";
import { formatEuroIn } from "../format.js";
import { useAppLocale } from "../appLocale.js";
import { adminCopy, type BelastingCopy } from "../copy/admin.js";
import type { Locale } from "../locale.js";
import { getHomeCountry, getTaxCountryOverride, setTaxCountryOverride } from "../settings";
import { countryNameIn } from "../countries.js";
import Module from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import ToonMeer from "../components/ToonMeer";
import Grens, { type GrensAnswerRow } from "./Grens";
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
  /** The flows of the scope on screen — the same subset every other view gets.
   *  Saving is a merge against exactly this list (App's saveScheduledFlows), so
   *  returning a list built from it can never delete a flow outside the scope. */
  scheduledFlows: ScheduledFlow[];
  /** All invoices. Their `vatAmount` is the BTW basis under the factuurstelsel —
   *  the only basis that sees an unpaid invoice's BTW debt. Optional so a caller
   *  that has none (a test, an older screen) behaves exactly as before. */
  invoices?: readonly Invoice[];
  /* ── DE DRIE PROPS VAN DE GRENSMODULE ──────────────────────────────────────
   *
   * `txs`/`accounts` hierboven zijn en blijven de GESCOPEERDE lijsten: de
   * btw-module rekent per onderneming-in-beeld, en die lijsten hier verruimen
   * zou een cijfer veranderen dat al draait.
   *
   * De grensmodule heeft precies het omgekeerde nodig. Ze meet wat er tussen de
   * zakelijke en de privékant bewoog, dus vanuit één helft is de tegenboeking
   * per definitie niet in beeld — en het resultaat zou dan niet leeg zijn maar
   * FOUT: elke kruising onbeantwoord, het totaal gehalveerd of verdubbeld,
   * zonder dat er iets op het scherm zegt dat er een helft ontbreekt. Vandaar
   * eigen, anders genoemde props: het type is aan beide kanten `Tx[]` en vangt
   * de vergissing niet, de NAAM op de aanroepplek wel.
   *
   * Dit is dezelfde redenering die App al één niveau lager maakt: `ownAccounts`
   * wordt daar uit de VOLLEDIGE rekeninglijst gebouwd "so a transfer between
   * accounts of different BVs is still recognized as an internal transfer"
   * (App.tsx). De grens is dat argument één niveau hoger. */
  allAccounts?: Account[];
  allTxs?: Tx[];
  entityProfiles?: EntityProfile[];
  /** Zijn eigen naam uit het profiel, al geparsed. Ontbreekt hij, dan matcht
   *  core nergens op een naam — dat is de bedoeling, niet een gat. */
  ownNames?: readonly OwnName[];
  busy: boolean;
  onSaveVatSettings: (s: VatSettings[]) => void;
  onSaveScheduledFlows: (f: ScheduledFlow[]) => void;
};

/** Which tax system this screen applies, and whether it had to guess.
 *
 *  An explicit choice on this screen wins. Otherwise the profile's country is
 *  used when LaVega has rules for it. Failing both, the Dutch rules are still
 *  rendered, because a blank tax screen is worse than a default one, but
 *  `unsupportedHome` carries the country we could NOT honour so the screen can
 *  say so out loud. Falling back silently was the old behaviour, and it left a
 *  Belgian owner reading Dutch tax rules with nothing to tell him. */
function resolveTaxCountry(): { code: CountryCode; unsupportedHome: string | null } {
  const chosen = COUNTRY_OPTIONS.find((o) => o.code === getTaxCountryOverride())?.code;
  if (chosen) return { code: chosen, unsupportedHome: null };
  const home = getHomeCountry();
  const fromHome = COUNTRY_OPTIONS.find((o) => o.code === home)?.code;
  if (fromHome) return { code: fromHome, unsupportedHome: null };
  return { code: DEFAULT_COUNTRY, unsupportedHome: home };
}

/* ── THE SEAM BETWEEN A FILE HE PICKED AND THE TAX ENGINE ──────────────────
 *
 * `taxSheet.ts` was complete and tested and imported by nothing, so his own
 * bookkeeping — the only BTW basis that is neither a proxy nor a guess — could
 * not reach this screen (design 2026-08-20, defect a). This is the whole reader,
 * exported so the path text -> rows -> figures -> BTW figure is testable without
 * a file picker.
 *
 * The column mapping is the guess from the header (Dutch/German/English
 * synonyms); `problems` is what it could not find, and the screen shows that
 * rather than hiding it. */
export function readBookkeepingSheet(
  text: string,
): { rows: TaxSheetRow[]; problems: TaxSheetProblem[] } {
  const table = readSheetCsv(text);
  return readTaxSheet(table, suggestTaxSheetMapping(table.header));
}

/** Why a better basis was not used. One sentence, naming the real cause — never
 *  an instruction, and never a number LaVega cannot point at.
 *
 *  EXPORTED om dezelfde reden als `readBookkeepingSheet` hierboven: de woordtest
 *  moet alle acht `VatNote`-takken kunnen lezen, en twee ervan zijn met props
 *  alleen niet te bereiken (`boekhouding-andere-periode` hangt aan een bestand
 *  dat hij kiest). Een zin die achter een onbereikbare tak zit, wordt door
 *  gerenderde HTML nooit gecontroleerd. */
export function noteText(note: VatNote, p: VatPosition, locale: Locale): string {
  const c = adminCopy[locale].belasting;
  return c.vat.notes[note]({
    total: p.coverage.total,
    missing: p.coverage.total - p.coverage.withVat,
  });
}

/** Renders a `TaxSheetProblem` (packages/core/src/taxSheet.ts) in the reader's
 *  language, via the copy this screen already carries. */
function problemText(problem: TaxSheetProblem, c: BelastingCopy["vat"]): string {
  switch (problem.kind) {
    case "missing-columns":
      return c.sheetProblem.missingColumns(
        problem.fields.map((f) => c.sheetFieldLabels[f]).join(", "),
      );
    case "undated-rows":
      return c.sheetProblem.undatedRows(problem.count);
    default: {
      const exhaustive: never = problem;
      return exhaustive;
    }
  }
}

export default function Belasting({
  entities,
  txs,
  accounts,
  asOf,
  vatSettings,
  scheduledFlows,
  invoices = [],
  allAccounts,
  allTxs,
  entityProfiles = [],
  ownNames,
  busy,
  onSaveVatSettings,
  onSaveScheduledFlows,
}: BelastingProps) {
  // Local, editable overrides per entity. Falls back to the saved settings and
  // then the country pack's defaults, so a fresh entity is immediately usable.
  // Committed to storage only on "Bereken & bewaar" (mirrors the rest of the
  // app's draft-then-persist pattern).
  const [locale] = useAppLocale();
  const c = adminCopy[locale].belasting;
  const [drafts, setDrafts] = useState<Record<string, VatSettings>>({});
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // His bookkeeping, per entity, for as long as this tab is open. It is NOT
  // written to storage: the vault is encrypted and plain localStorage is not the
  // vault, so real turnover figures do not go there. The screen says so.
  const [sheets, setSheets] = useState<
    Record<string, { rows: TaxSheetRow[]; problems: TaxSheetProblem[]; name: string }>
  >({});

  const [taxCountry, setTaxCountry] = useState(resolveTaxCountry);
  const country = taxCountry.code;
  const pack = useMemo(() => taxPack(country), [country]);
  // Hoisted so the narrowing survives into the callbacks below.
  const profitTax = pack.profitTax;
  const countryLabel = pack.country === "DE" ? c.header.countryLabel.DE : c.header.countryLabel.NL;
  const caveats = pack.country === "DE" ? c.header.caveatsByCountry.DE : c.header.caveatsByCountry.NL;

  const savedByEntity = useMemo(() => {
    const m = new Map<string, VatSettings>();
    for (const s of vatSettings) m.set(s.entity, s);
    return m;
  }, [vatSettings]);

  /** The settings in force for an entity. The COUNTRY always comes from the
   *  profile — that is the single switch this whole screen is driven by — while
   *  the rate/frequency he set himself are left alone. A frequency this country
   *  does not allow is replaced rather than filed.
   *
   *  DE REGEL ZELF STAAT IN CORE (`resolveVatSettings`), en niet meer hier. Dit
   *  scherm is niet langer het enige dat hem stelt: de btw-kaart op het overzicht
   *  moet exact dezelfde periode en hetzelfde stelsel gebruiken, anders noemen
   *  twee schermen op dezelfde dag een ander kwartaal. Wat hier blijft staan is
   *  het enige wat écht van dit scherm is: de nog niet bewaarde bewerking. */
  function resolve(entity: string): VatSettings {
    return resolveVatSettings({
      entity,
      saved: drafts[entity] ?? savedByEntity.get(entity),
      country,
    });
  }

  function patch(entity: string, partial: Partial<VatSettings>) {
    setSavedNote(null);
    setDrafts((prev) => ({ ...prev, [entity]: { ...resolve(entity), ...partial } }));
  }

  /** De transacties van één onderneming. Ook dit staat in core
   *  (`txsForEntity`), om dezelfde reden als `resolve`: de btw-kaart op het
   *  overzicht moet over precies dezelfde transacties rekenen als dit scherm. */
  function entityTxs(entity: string): Tx[] {
    return txsForEntity(txs, accounts, entity);
  }

  /** His own figures for exactly the filing window this entity is in. */
  function figuresFor(entity: string, s: VatSettings): TaxFigures | undefined {
    const sheet = sheets[entity];
    if (!sheet || sheet.rows.length === 0) return undefined;
    const { periodStart, periodEnd } = nextVatPeriod(s.frequency, asOf, s.country);
    return sumTaxFigures(sheet.rows, periodStart, periodEnd);
  }

  async function pickSheet(entity: string, file: File | undefined) {
    if (!file) return;
    const { rows, problems } = readBookkeepingSheet(await file.text());
    setSheets((prev) => ({ ...prev, [entity]: { rows, problems, name: file.name } }));
    setSavedNote(null);
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
      const s = resolve(e);
      freshFlows.push(
        ...computeTaxReservations({
          txs: entityTxs(e),
          settings: s,
          asOf,
          figures: figuresFor(e, s),
          invoices,
        }),
      );
    }
    onSaveScheduledFlows(rebuildVatFlows(scheduledFlows, entities, freshFlows));
    setSavedNote(
      freshFlows.length === 0 ? c.actions.savedNothing : c.actions.savedSome(freshFlows.length),
    );
  }

  /* ── ZIJN ANTWOORD OVER EEN STROOM WEGSCHRIJVEN ────────────────────────────
   *
   * DE VAL DIE HIER OMZEILD WORDT, want hij is niet zichtbaar en kost een
   * antwoord: `berekenEnBewaar` hierboven bouwt de instellingen opnieuw op voor
   * de ondernemingen die NU IN BEELD zijn (`entities.map(resolve)`) en laat de
   * rest onaangeroerd staan. Een grensantwoord gaat over een PAAR dat de twee
   * helften doorkruist, dus de zakelijke onderneming waar het op bewaard wordt
   * staat vaak niet in `entities` — sta je in Persoonlijk, dan is BV1 er niet
   * bij. Zou het antwoord meeliften op die knop, dan werd het bij de eerstvolgende
   * opslagronde stilzwijgend weggelaten en bleef de module dezelfde vraag stellen.
   *
   * Daarom een EIGEN opslagpad, direct op het moment dat hij antwoordt:
   *
   *  1. samenvoegen in de VOLLEDIGE `vatSettings`-lijst (replace-all, zoals elke
   *     andere opslag in dit scherm), zodat rijen buiten beeld blijven staan;
   *  2. bestaat er nog geen rij voor die onderneming, dan wordt er één gemaakt
   *     via `resolveVatSettings` — de standaardwaarden van het land, niets
   *     verzonnen;
   *  3. `answerCrossScope` doet de samenvoeging zelf, met de ene regel die er
   *     toe doet: een antwoord van hem wordt nooit door een agent overschreven;
   *  4. EN het loopt ook door het lokale concept heen. Dat is stap 4 en niet een
   *     detail: als hij vóór het antwoorden het tarief aanpaste, ligt er een
   *     `drafts[entity]` uit die tijd. `resolve()` geeft dat concept voorrang op
   *     wat er bewaard staat, dus zonder deze stap zou de eerstvolgende
   *     "Bereken & bewaar" het antwoord met het oudere concept overschrijven.
   *
   * WAAROM OP DE ZAKELIJKE ONDERNEMING: bij elke kruising is precies één kant
   * zakelijk (core koppelt alleen tegengestelde kanten), dus die keuze is
   * eenduidig en overleeft het hernoemen of verdwijnen van de privékant. Grens
   * bepaalt de onderneming en geeft hem mee; dit scherm bepaalt waar hij landt. */
  function bewaarGrensAntwoorden(rows: GrensAnswerRow[]) {
    if (rows.length === 0) return;
    // Op TRIM vergeleken, niet op de letterlijke string. Core levert de naam
    // getrimd terug (`account.entity.trim()`) terwijl `entityOptionsFor` in
    // apps/web/src/scope.ts dat niet doet, dus een import met "BV1 " zou hier
    // anders een tweede instellingenrij naast "BV1" zetten. Alleen trim, geen
    // hoofdletterregel: die zou van dit scherm iets anders maken dan van
    // `resolve()` ernaast, en één scherm hoort één regel te volgen.
    const key = (e: string) => e.trim();
    const byEntity = new Map<string, CrossScopeAnswer[]>();
    for (const r of rows) {
      const list = byEntity.get(key(r.entity));
      if (list) list.push(r.answer);
      else byEntity.set(key(r.entity), [r.answer]);
    }

    const next = vatSettings.map((s) => {
      const incoming = byEntity.get(key(s.entity));
      if (!incoming) return s;
      byEntity.delete(key(s.entity));
      return { ...s, crossScopeAnswers: answerCrossScope(s.crossScopeAnswers ?? [], incoming) };
    });
    for (const [entity, incoming] of byEntity) {
      next.push({
        ...resolveVatSettings({ entity, saved: undefined, country }),
        crossScopeAnswers: answerCrossScope([], incoming),
      });
    }
    onSaveVatSettings(next);

    // Stap 4: hetzelfde antwoord in een eventueel openstaand concept.
    setDrafts((prev) => {
      let touched = false;
      const out = { ...prev };
      for (const r of rows) {
        const target = Object.keys(out).find((e) => key(e) === key(r.entity));
        const draft = target === undefined ? undefined : out[target];
        if (!draft || target === undefined) continue;
        out[target] = {
          ...draft,
          crossScopeAnswers: answerCrossScope(draft.crossScopeAnswers ?? [], [r.answer]),
        };
        touched = true;
      }
      return touched ? out : prev;
    });
  }

  /** Alle bewaarde antwoorden bij elkaar. `CrossScopeAnswer.target` is een hash
   *  en dus vault-breed uniek, dus samenvoegen kan niet botsen — welke rij een
   *  antwoord droeg, doet er bij het LEZEN niet toe. */
  const crossScopeAnswers = useMemo(
    () => vatSettings.flatMap((s) => s.crossScopeAnswers ?? []),
    [vatSettings],
  );

  if (entities.length === 0) {
    return (
      <>
        <div className="view-head">
          <h2>
            {c.header.title} · {countryLabel}
          </h2>
          <span className="eyebrow">
            {c.header.rulesAsOfPrefix} {pack.rulesAsOf}
          </span>
        </div>
        <section className="card" aria-label={c.header.title}>
          <p>{c.header.entitiesEmpty}</p>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="view-head">
        {/* HET ⓘ VERVANGT DE VOLLE-BREEDTE MODULE "Niet berekend" ONDERAAN.
            Die lijst is anders niet te beoordelen (zie de kop van dit bestand),
            maar hoeft niet standaard open te staan om dat te blijven doen —
            zelfde patroon als StatistiekBlock.tsx: de kop blijft zichtbaar
            zoals hij was, het ⓘ komt ernaast, de lijst zelf vouwt op. */}
        <ToonMeer
          variant="info"
          heading={
            <h2>
              {c.header.title} · {countryLabel}
            </h2>
          }
          summary={c.header.caveatsSummary}
        >
          <ul className="tax-caveats">
            {caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </ToonMeer>
        <span className="eyebrow">
          {c.header.taxCount(profitTax ? 2 : 1)} · {c.header.rulesAsOfPrefix} {pack.rulesAsOf}
        </span>
      </div>

      <section className="card tax-system" aria-label={c.header.taxSystemLabel}>
        <label htmlFor="tax-system">{c.header.taxSystemLabel}</label>
        <select
          id="tax-system"
          value={country}
          onChange={(e) => {
            setTaxCountryOverride(e.target.value);
            setTaxCountry(resolveTaxCountry());
          }}
        >
          {COUNTRY_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {countryNameIn(locale, o.code)}
            </option>
          ))}
        </select>
        <p className="mp-what">{c.header.taxSystemHint}</p>
        {taxCountry.unsupportedHome && (
          <p className="text-warn">
            {c.header.unsupportedCountry(countryNameIn(locale, taxCountry.unsupportedHome))}
          </p>
        )}
      </section>

      <ModuleGrid className="grid-2" label={c.header.gridLabel}>
        {/* ── Module 1: de omzetbelasting van dit land ──────────────────── */}
        <Module
          title={pack.vat.label}
          height="tall"
          footer={
            <span>
              {c.vat.footer({
                countryLabel,
                ratesList: pack.vat.rates.map((r) => `${r}%`).join(" / "),
              })}
            </span>
          }
        >
          {entities.map((entity) => {
            const s = resolve(entity);
            const sheet = sheets[entity];
            const p = vatPosition({
              txs: entityTxs(entity),
              settings: s,
              asOf,
              figures: figuresFor(entity, s),
              invoices,
            });
            const { period, stage, basis, netCents, direction, coverage, note } = p;
            const known = netCents !== null;
            return (
              <div className="tax-entity" key={entity}>
                <div className="tax-entity-head">
                  <span className="tax-entity-name">{entity}</span>
                  <span
                    className={`tax-entity-figure ${!known ? "" : direction === "terugvragen" ? "text-pos" : "text-neg"}`}
                  >
                    {known ? formatEuroIn(locale, Math.abs(netCents) / 100) : c.vat.noAmount}
                  </span>
                </div>

                {/* HET ANTWOORD, EN NIET MEER DAN DAT — periode, richting,
                    deadline, en of dit een stand is of een afgesloten aangifte.
                    Dat laatste blijft hier zichtbaar en gaat niet mee de
                    ToonMeer in: een schatting die als afgesloten cijfer leest is
                    dezelfde "half advies"-fout die TravelBlock.tsx al eens
                    beschrijft bij de kaartprijs. Alles wat dit cijfer
                    ONDERBOUWT — waar het vandaan komt, de dekking, de
                    kanttekeningen — staat erna, opgevouwen. */}
                <p className="cell-sub">
                  {c.vat.periodSummary({
                    periodLabel: period.periodLabel,
                    directionLabel: c.vat.directionLabels[direction],
                    deadline: period.deadline,
                    loopt: stage === "loopt",
                    asOf,
                  })}
                </p>

                <ToonMeer summary={c.vat.detailsSummary}>
                  {/* Is the window over? This is the difference between a stand and
                      an aangifte, and it is also what makes the flow `expected`
                      instead of `confirmed`. */}
                  <p className="cell-sub">
                    {c.vat.periodStatus({
                      periodLabel: period.periodLabel,
                      periodEnd: period.periodEnd,
                      asOf,
                      loopt: stage === "loopt",
                    })}
                  </p>

                  {/* WHAT it was built from. A figure without its source is not
                      rendered here, because the type cannot produce one. */}
                  <p className="cell-sub">
                    {c.vat.sourceLine({
                      basisLabel: c.vat.basisLabels[basis],
                      rulesAsOf: p.rulesAsOf,
                    })}
                    {p.chargedCents !== null && p.paidCents !== null
                      ? c.vat.sourceAmounts({
                          chargedEuro: formatEuroIn(locale, p.chargedCents / 100),
                          paidEuro: formatEuroIn(locale, p.paidCents / 100),
                        })
                      : ""}
                  </p>

                  {coverage.total > 0 && (
                    <p className="cell-sub">
                      {c.vat.coverageLine({ withVat: coverage.withVat, total: coverage.total })}
                    </p>
                  )}

                  {/* WAAROM DIT ER STAAT: hij zette het stelsel goed, voerde een factuur
                      mét btw in die correct werd gelezen, en zag 0 staan — "is dat
                      goed of niet weet ik niet". De 0 klopte: zijn factuur viel in
                      een ander tijdvak. Maar een cijfer dat waar is en niet te
                      beoordelen, is een cijfer waar niemand iets aan heeft. Deze
                      regel maakt het verschil zichtbaar tussen "je hebt geen btw"
                      en "je factuur staat ergens anders". */}
                  {coverage.outside > 0 && (
                    <p className="cell-sub" data-testid={`btw-buiten-${entity}`}>
                      {c.vat.outsidePeriod({
                        outside: coverage.outside,
                        nearestOutside: coverage.nearestOutside,
                        total: coverage.total,
                      })}
                    </p>
                  )}
                  {note && <p className="cell-sub">{noteText(note, p, locale)}</p>}

                  {direction === "terugvragen" && (
                    <p className="cell-sub">{c.vat.refundNotInForecast}</p>
                  )}

                  {known && netCents > 0 && (
                    <p className="cell-sub">{c.vat.willReserve(period.deadline)}</p>
                  )}
                </ToonMeer>

                <div className="tax-fields">
                  <label>
                    {c.vat.fields.frequencyLabel}
                    <select
                      value={s.frequency}
                      disabled={busy}
                      aria-label={c.vat.ariaLabels.frequency(pack.vat.label, entity)}
                      onChange={(e) =>
                        patch(entity, { frequency: e.target.value as VatSettings["frequency"] })
                      }
                    >
                      {pack.vat.frequencies.map((f) => (
                        <option key={f} value={f}>
                          {c.vat.frequencyLabels[f]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {c.vat.fields.stelselLabel}
                    <select
                      value={s.vatBasis ?? ""}
                      disabled={busy}
                      aria-label={c.vat.ariaLabels.stelsel(entity)}
                      onChange={(e) =>
                        patch(entity, {
                          vatBasis:
                            e.target.value === ""
                              ? undefined
                              : (e.target.value as "factuurstelsel" | "kasstelsel"),
                        })
                      }
                    >
                      <option value="">{c.vat.fields.stelselUnset}</option>
                      <option value="factuurstelsel">{c.vat.fields.stelselFactuur}</option>
                      <option value="kasstelsel">{c.vat.fields.stelselKas}</option>
                    </select>
                  </label>
                  <label>
                    {c.vat.fields.ratePctLabel}
                    <input
                      className="saldo-input"
                      type="number"
                      step={1}
                      min={0}
                      value={s.defaultRatePct}
                      disabled={busy}
                      aria-label={c.vat.ariaLabels.ratePct(pack.vat.label, entity)}
                      onChange={(e) =>
                        patch(entity, {
                          defaultRatePct: e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    {c.vat.fields.manualAmountLabel}
                    <input
                      className="saldo-input"
                      type="number"
                      step={0.01}
                      min={0}
                      placeholder={c.vat.fields.manualAmountPlaceholder}
                      value={s.manualCents != null ? s.manualCents / 100 : ""}
                      disabled={busy}
                      aria-label={c.vat.ariaLabels.manualAmount(pack.vat.label, entity)}
                      onChange={(e) =>
                        patch(entity, {
                          manualCents:
                            e.target.value === ""
                              ? undefined
                              : Math.round(Number(e.target.value) * 100),
                        })
                      }
                    />
                  </label>
                  <label>
                    {c.vat.fields.mixedRatesLabel}
                    <input
                      type="checkbox"
                      checked={s.mixedRates}
                      disabled={busy}
                      aria-label={c.vat.ariaLabels.mixedRates(entity)}
                      onChange={(e) => patch(entity, { mixedRates: e.target.checked })}
                    />
                  </label>
                  <label>
                    {c.vat.fields.sheetLabel}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={busy}
                      aria-label={c.vat.ariaLabels.sheetImport(entity)}
                      onChange={(e) => void pickSheet(entity, e.target.files?.[0])}
                    />
                  </label>
                </div>

                {sheet && (
                  <p className="cell-sub">
                    {c.vat.sheetStatus({
                      fileName: sheet.name,
                      rowCount: sheet.rows.length,
                      isBasis: basis === "sheet",
                      periodLabel: period.periodLabel,
                      problemsText:
                        sheet.problems.length > 0
                          ? sheet.problems.map((p) => problemText(p, c.vat)).join("; ")
                          : "",
                    })}
                  </p>
                )}
              </div>
            );
          })}
        </Module>

        {/* ── Module 2: alleen in een land dat winstbelasting vooruit laat
             betalen. NL heeft die niet, dus NL ziet deze module niet. ─────── */}
        {profitTax && (
          <Module title={profitTax.label} height="tall" footer={<span>{profitTax.rateBasis}</span>}>
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
                      {flows.length > 0 ? formatEuroIn(locale, total / 100) : c.profitTax.noAmount}
                    </span>
                  </div>
                  {flows.length === 0 ? (
                    <p className="cell-sub">
                      {c.profitTax.nothingToReserve(
                        pack.country === "DE" ? c.profitTax.authorityDE : c.profitTax.authorityOther,
                      )}
                    </p>
                  ) : (
                    <div className="tax-flows">
                      {flows.map((f) => (
                        <div className="tax-flow" key={f.id}>
                          <span>
                            {f.label} · {f.dueDate}{" "}
                            {f.status === "expected" && (
                              <span className="badge">{c.profitTax.estimateBadge}</span>
                            )}
                          </span>
                          <span className="text-neg">
                            {formatEuroIn(locale, f.amountCents / 100)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="tax-fields" style={{ marginTop: "var(--sp-3)" }}>
                    <label>
                      {c.profitTax.fields.ratePctLabel}
                      <input
                        className="saldo-input"
                        type="number"
                        step={0.1}
                        min={0}
                        placeholder={String(profitTax.defaultRatePct)}
                        value={s.profitTaxRatePct ?? ""}
                        disabled={busy}
                        aria-label={c.profitTax.ariaLabels.ratePct(entity)}
                        onChange={(e) =>
                          patch(entity, {
                            profitTaxRatePct:
                              e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      {c.profitTax.fields.imposedAmountLabel}
                      <input
                        className="saldo-input"
                        type="number"
                        step={0.01}
                        min={0}
                        placeholder={c.profitTax.fields.imposedAmountPlaceholder}
                        value={s.profitTaxManualCents != null ? s.profitTaxManualCents / 100 : ""}
                        disabled={busy}
                        aria-label={c.profitTax.ariaLabels.imposedAmount(entity)}
                        onChange={(e) =>
                          patch(entity, {
                            profitTaxManualCents:
                              e.target.value === ""
                                ? undefined
                                : Math.round(Number(e.target.value) * 100),
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

        {/* ── Module 3: de grens tussen privé en zakelijk. GEEN BELASTING, en
             daarom blijft de eyebrow hierboven "1 belasting"/"2 belastingen"
             ongemoeid: dit is een meting, en hem meetellen als belasting zou de
             eerste kleine onwaarheid van het scherm zijn.

             Staat er alleen als de aanroeper de VOLLEDIGE lijsten meegeeft. Een
             scherm dat hem met de gescopeerde lijsten zou tekenen, toont een
             nul met een geloofwaardig verhaal erachter — zie de opmerking bij
             `allAccounts` hierboven. Ontbreken ze, dan is er geen module in
             plaats van een verkeerde. ──────────────────────────────────────── */}
        {allAccounts && allTxs && (
          <Grens
            allAccounts={allAccounts}
            allTxs={allTxs}
            entityProfiles={entityProfiles}
            asOf={asOf}
            ownNames={ownNames}
            answers={crossScopeAnswers}
            busy={busy}
            onSaveAnswers={bewaarGrensAntwoorden}
          />
        )}
      </ModuleGrid>

      <div className="stack-form-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={berekenEnBewaar}>
          {c.actions.saveButton}
        </button>
      </div>
      {savedNote && <p className="cell-sub">{savedNote}</p>}
    </>
  );
}
