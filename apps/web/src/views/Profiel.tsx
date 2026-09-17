import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Account, EntityScope, EntitySummary, LearnedFact, Rule } from "@lavega/core";
import type { ConversionMode } from "../settings.js";
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
import { countryListIn, countryNameIn, regionLabelIn, regionsFor } from "../countries.js";
import {
  getCashbackAssumptionEnabled,
  ownerDisplayName,
  setCashbackAssumptionEnabled,
  type OwnerName,
} from "../settings.js";
import { SCOPE_ORDER } from "../scope.js";
import { signIn, signOut, useAuthState } from "../authClient.js";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import { heldCashbackSentence } from "../copy/optimise.js";
import Import from "./Import";
import Regels from "./Regels";
import Koppelingen from "./Koppelingen";
import Backup from "./Backup";
import Button from "../components/ui/Button.js";
import Card, { CardHeader } from "../components/ui/Card.js";
import { Field } from "../components/ui/Field.js";
import SaldoInput from "../components/ui/SaldoInput.js";

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
  /** Whether a non-EUR balance/transaction counts toward the euro totals. Owned
   *  by App (see homeCountry above) so every view sees the same flip. */
  fxConversionMode: ConversionMode;
  onFxConversionModeChange: (mode: ConversionMode) => void;
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

/* Account — sign in against the configured LaVega server so the owner can test
 * the Enable Banking flow. Sign-up is deliberately absent: the server decides
 * who gets an account, not this page. Nothing renders while the state is
 * `loading`: a signed-out default would flash the login form at someone who
 * is already signed in, for the one render before the real check lands. */
function AccountBlock() {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const { state, refresh } = useAuthState();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email, password);
      setPassword("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    refresh();
  }

  if (state.kind === "loading") return null;

  return (
    <Card as="section" aria-label={c.profiel.account.ariaLabel}>
      <h2>{c.profiel.account.heading}</h2>
      {state.kind === "unconfigured" && (
        <p className="cell-sub">{c.profiel.account.unconfigured}</p>
      )}
      {state.kind === "signed-out" && (
        <>
          <p className="cell-sub">{c.profiel.account.signedOutIntro}</p>
          <form onSubmit={(e) => void handleSignIn(e)}>
            <Field>
              <label htmlFor="account-email">{c.profiel.account.emailLabel}</label>
              <input
                id="account-email"
                type="email"
                value={email}
                disabled={busy}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field>
              <label htmlFor="account-password">{c.profiel.account.passwordLabel}</label>
              <input
                id="account-password"
                type="password"
                value={password}
                disabled={busy}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error !== "" && (
              <p role="alert" className="text-warn">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy || !email || !password}>
              {c.profiel.account.signIn}
            </Button>
          </form>
        </>
      )}
      {state.kind === "signed-in" && (
        <>
          <p className="cell-sub">{state.email}</p>
          <Button onClick={() => void handleSignOut()}>{c.profiel.account.signOut}</Button>
        </>
      )}
    </Card>
  );
}

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
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
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
      setProblem(
        `${c.profiel.cashback.emptyPercentPrefix}${product}${c.profiel.cashback.emptyPercentSuffix}`,
      );
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
      setProblem(
        `${c.profiel.cashback.saveFailedPrefix}${e instanceof Error ? e.message : String(e)}.`,
      );
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
      setProblem(
        `${c.profiel.cashback.clearFailedPrefix}${e instanceof Error ? e.message : String(e)}.`,
      );
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
    <Card as="section" aria-label={c.profiel.cashback.ariaLabel}>
      <CardHeader>
        <h2>{c.profiel.cashback.heading}</h2>
        <span className="eyebrow">
          {rows.length}{" "}
          {rows.length === 1 ? c.profiel.cashback.cardSingular : c.profiel.cashback.cardPlural}
        </span>
      </CardHeader>
      <p className="cell-sub">{c.profiel.cashback.intro}</p>
      <p className="cell-sub">{c.profiel.cashback.privacyNote}</p>
      {/* DE KEERZIJDE VAN DE REGEL, en die is net zo hard: een uitgesproken nul
          is een BEKENDE nul. Wie in de voorwaarden van zijn eigen kaart heeft
          gelezen dat er geen cashback is, hoort dat te kunnen vastleggen — dan
          staat er geen aanname meer maar zijn eigen vaststelling, en die
          verdwijnt niet als de aanname ooit wordt teruggedraaid. */}
      <p className="cell-sub">
        {c.profiel.cashback.zeroNoteBefore}
        <strong>{c.profiel.cashback.zeroNoteBold}</strong>
        {c.profiel.cashback.zeroNoteAfter}
      </p>

      <label>
        <input
          type="checkbox"
          checked={assumptionOn}
          aria-label={c.profiel.cashback.assumptionLabel}
          onChange={(e) => toggleAssumption(e.target.checked)}
        />{" "}
        {c.profiel.cashback.assumptionLabel}
      </label>
      <p className="cell-sub">
        {assumptionOn
          ? c.profiel.cashback.assumptionOnStatus
          : c.profiel.cashback.assumptionOffStatus}
      </p>

      {loadProblem !== null ? (
        <p role="alert" className="text-warn">
          {c.profiel.cashback.loadProblemPrefix}
          {loadProblem}
          {c.profiel.cashback.loadProblemSuffix}
        </p>
      ) : cards === null ? (
        <p className="text-muted">{c.profiel.cashback.loading}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">{c.profiel.cashback.empty}</p>
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
                    {heldCashbackSentence(describeHeldCashback(known), locale)}
                    {due && c.profiel.cashback.dueSuffix}
                    {row.names.length > 1 &&
                      `${c.profiel.cashback.namesSuffixPrefix}${row.names.length}${c.profiel.cashback.namesSuffixSuffix}`}
                  </span>
                </div>
                <div>
                  <label>
                    <SaldoInput
                      inputMode="decimal"
                      aria-label={`${c.profiel.cashback.cashbackInputAriaLabelPrefix} ${row.product}`}
                      placeholder={pctNow === null ? "%" : String(pctNow)}
                      value={drafts[row.product] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [row.product]: e.target.value }))}
                    />
                  </label>{" "}
                  <Button variant="primary" onClick={() => void saveCorrection(row.product)}>
                    {c.profiel.cashback.save}
                  </Button>{" "}
                  {entry !== null && entry.source === "user" && (
                    <Button onClick={() => void clearCorrection(row.product)}>
                      {c.profiel.cashback.clearCorrection}
                    </Button>
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
      {saved !== null && (
        <p data-testid="cashback-opgeslagen">
          {c.profiel.cashback.savedPrefix}
          {saved}.
        </p>
      )}
    </Card>
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
  fxConversionMode,
  onFxConversionModeChange,
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
  const [locale, setLocale] = useAppLocale();
  const c = shellCopy[locale];
  const modulesRef = useRef<HTMLElement>(null);
  // The widget preference is read here rather than passed in: the switch lives
  // on this page and the cards live on the homescreen, two branches of the tree
  // that share nothing above them but App itself. See moduleRegistry.
  const [widgets, setWidgets] = useOverviewWidgets();
  // 249 countries; built once rather than on every keystroke elsewhere on the page.
  const countries = useMemo(() => countryListIn(locale), [locale]);
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
      <Card as="section" aria-label={c.profiel.languageSwitch.ariaLabel}>
        <h2>{c.profiel.languageSwitch.cardLabel}</h2>
        <div className="scope-switch" role="group" aria-label={c.profiel.languageSwitch.ariaLabel}>
          <button
            type="button"
            className={`scope-option${locale === "nl" ? " scope-on" : ""}`}
            aria-pressed={locale === "nl"}
            onClick={() => setLocale("nl")}
          >
            {c.profiel.languageSwitch.nl}
          </button>
          <span className="scope-rule" aria-hidden="true" />
          <button
            type="button"
            className={`scope-option${locale === "en" ? " scope-on" : ""}`}
            aria-pressed={locale === "en"}
            onClick={() => setLocale("en")}
          >
            {c.profiel.languageSwitch.en}
          </button>
        </div>
      </Card>

      <AccountBlock />

      {/* The owner, at the very top, so the page reads as his own screen and not
          as a settings menu. The name is a local preference like the buffer and
          the country: this browser only, never in the vault, never in a
          back-up, and deliberately never in anything a model is given. */}
      <Card
        as="section"
        className="flex items-start gap-4 [@media(max-width:640px)]:flex-col"
        aria-label={c.profiel.head.ariaLabel}
      >
        <span
          className="inline-flex items-center justify-center flex-none w-[56px] h-[56px] rounded-pill border border-line bg-surface-2 text-ink font-display text-[1.15rem] font-semibold tracking-[0.02em]"
          aria-hidden="true"
          data-testid="profile-head-avatar"
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="mb-1" data-testid="profile-head-name">
            {fullName || c.profiel.head.noName}
          </h2>
          <p className="cell-sub">{c.profiel.head.note}</p>
          <div className="mt-3">
            <label>
              {c.profiel.head.firstName}{" "}
              <input
                value={ownerName.first}
                aria-label={c.profiel.head.firstName}
                autoComplete="off"
                onChange={(e) => onOwnerNameChange({ ...ownerName, first: e.target.value })}
              />
            </label>{" "}
            <label>
              {c.profiel.head.lastName}{" "}
              <input
                value={ownerName.last}
                aria-label={c.profiel.head.lastName}
                autoComplete="off"
                onChange={(e) => onOwnerNameChange({ ...ownerName, last: e.target.value })}
              />
            </label>
          </div>
        </div>
      </Card>

      <Card as="section" aria-label={c.profiel.modules.ariaLabel} ref={modulesRef}>
        <CardHeader>
          <h2>{c.profiel.modules.heading}</h2>
          <span className="eyebrow">
            {enabledModules.length} {c.profiel.modules.countSuffix}
          </span>
        </CardHeader>
        <p className="cell-sub">{c.profiel.modules.description}</p>
        <ModulePicker enabled={enabledModules} onChange={onModulesChange} />
      </Card>

      {/* The homescreen cards that are a choice rather than a fixture. Same
          switch as the modules above, one screen lower, because "welke tab" and
          "welke kaart" are the same question asked about a different surface.
          Both start off: he asked for a widget he can click on "instead of it
          always being default there". */}
      <Card as="section" aria-label={c.profiel.widgets.ariaLabel}>
        <CardHeader>
          <h2>{c.profiel.widgets.heading}</h2>
          <span className="eyebrow">
            {widgets.length} {c.profiel.widgets.of} {WIDGETS.length} {c.profiel.widgets.on}
          </span>
        </CardHeader>
        <p className="cell-sub">{c.profiel.widgets.description}</p>
        <WidgetPicker enabled={widgets} onChange={setWidgets} />
      </Card>

      <Card as="section" aria-label={c.profiel.scopeSection.ariaLabel}>
        <CardHeader>
          <h2>{c.profiel.scopeSection.heading}</h2>
          <span className="eyebrow">
            {entities.length}{" "}
            {entities.length === 1
              ? c.profiel.scopeSection.unitSingular
              : c.profiel.scopeSection.unitPlural}
          </span>
        </CardHeader>
        <p className="cell-sub">{c.profiel.scopeSection.description}</p>

        {entities.length === 0 ? (
          <p className="text-muted">{c.profiel.scopeSection.noAccounts}</p>
        ) : (
          <ul className="scope-list">
            {entities.map((e) => (
              <li key={e.entity} className="scope-item">
                <div className="scope-item-text">
                  <span className="scope-item-name">{e.entity}</span>
                  <span className="mp-what">
                    {e.accountKeys.length}{" "}
                    {e.accountKeys.length === 1
                      ? c.profiel.scopeSection.accountSingular
                      : c.profiel.scopeSection.accountPlural}
                    {!e.explicit &&
                      `${c.profiel.scopeSection.unclassifiedPrefix}${c.scope.personal.toLowerCase()}`}
                    {!e.explicit &&
                      e.suggested !== e.scope &&
                      `${c.profiel.scopeSection.nameReadsAsPrefix}${c.scope[e.suggested].toLowerCase()}`}
                  </span>
                </div>

                <div
                  className="scope-switch"
                  role="group"
                  aria-label={`${e.entity}: ${c.profiel.scopeSection.groupAriaLabelSuffix}`}
                >
                  {SCOPE_ORDER.map((s, i) => (
                    <Fragment key={s}>
                      {i > 0 && <span className="scope-rule" aria-hidden="true" />}
                      <button
                        type="button"
                        className={`scope-option${e.scope === s ? " scope-on" : ""}`}
                        aria-pressed={e.scope === s}
                        aria-label={`${e.entity} ${c.scope[s].toLowerCase()}`}
                        onClick={() => onClassifyEntity(e.entity, s)}
                      >
                        {c.scope[s]}
                      </button>
                    </Fragment>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" aria-label={c.profiel.countryRegion.ariaLabel}>
        <h2>{c.profiel.countryRegion.heading}</h2>
        <p className="cell-sub">{c.profiel.countryRegion.purpose}</p>
        <p className="cell-sub">{c.profiel.countryRegion.neverInferred}</p>
        <div className="facturen-form">
          <label>
            {c.profiel.countryRegion.countryLabel}{" "}
            <select
              value={homeCountry}
              onChange={(e) => onHomeCountryChange(e.target.value)}
              aria-label={c.profiel.countryRegion.countryLabel}
            >
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            {regionLabelIn(locale, homeCountry)}{" "}
            {/* A list where we have a verified one, free text everywhere else:
                belasting in Texas is niet belasting in New York, maar een
                verzonnen keuzelijst voor de andere 247 landen zou een gok voor
                een feit laten doorgaan. */}
            <input
              value={homeRegion}
              list={regions.length > 0 ? "home-regions" : undefined}
              aria-label={`${regionLabelIn(locale, homeCountry)} in ${countryNameIn(locale, homeCountry)}`}
              placeholder={
                regions.length > 0
                  ? c.profiel.countryRegion.chooseOrType
                  : c.profiel.countryRegion.optional
              }
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
            ? `${c.profiel.countryRegion.knownListNotePrefix}${countryNameIn(locale, homeCountry)}${c.profiel.countryRegion.knownListNoteSuffix}`
            : `${c.profiel.countryRegion.noListNotePrefix}${countryNameIn(locale, homeCountry)}${c.profiel.countryRegion.noListNoteSuffix}`}
        </p>
      </Card>

      <Card as="section" aria-label={c.profiel.fx.ariaLabel}>
        <CardHeader>
          <h2>{c.profiel.fx.heading}</h2>
        </CardHeader>
        <label>
          <input
            type="checkbox"
            checked={fxConversionMode === "convert"}
            aria-label={c.profiel.fx.convertLabel}
            onChange={(e) => onFxConversionModeChange(e.target.checked ? "convert" : "separate")}
          />{" "}
          {c.profiel.fx.convertLabel}
        </label>
        <p className="cell-sub">{c.profiel.fx.description}</p>
      </Card>

      <Import
        entity={entity}
        onEntityChange={onEntityChange}
        busy={busy}
        problems={problems}
        onImport={onImport}
      />

      <Koppelingen storage={storage} />

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

      <Card as="section" aria-label={c.profiel.lock.ariaLabel}>
        <h2>{c.profiel.lock.heading}</h2>
        <p className="cell-sub">{c.profiel.lock.description}</p>
        <Button onClick={onLock}>{c.profiel.lock.button}</Button>
      </Card>
      <p className="cell-sub" data-testid="build-stamp">
        LaVega build {__LAVEGA_BUILD__}
      </p>
    </>
  );
}
