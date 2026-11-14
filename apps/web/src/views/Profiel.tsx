import { Fragment, useEffect, useMemo, useState } from "react";
import type {
  Account,
  AdvisorProfileStore,
  EntityScope,
  EntitySummary,
  ImportSession,
  LearnedFact,
  Tx,
  Valuation,
  VaultDocument,
} from "@lavega/core";
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
import { CATALOGUE_ENTRIES } from "../catalogue-rates";
import { countryListIn, countryNameIn, regionLabelIn, regionsFor } from "../countries.js";
import {
  getCashbackAssumptionEnabled,
  setCashbackAssumptionEnabled,
  type OwnerName,
} from "../settings.js";
import {
  SHOW_CASHBACK_CORRECTION,
  SHOW_DOCUMENTS_CARD,
  SHOW_ENTITY_CLASSIFIER,
  SHOW_INVOICE_FORWARDING,
  SHOW_NET_WORTH_SHARE,
  SHOW_OWN_COLUMNS_IMPORT,
} from "../archive";
import { SCOPE_ORDER } from "../scope.js";
import { signOut, useAuthState, type AuthState } from "../authClient.js";
import posthog from "../posthog.js";
import type { ShellNotice } from "../shellNotice.js";
import { useAppLocale } from "../appLocale.js";
import { useTheme } from "../hooks/useTheme.js";
import { THEME_OPTIONS } from "../lib/theme.js";
import { shellCopy } from "../copy/shell.js";
import { intakeCopy } from "../copy/intake.js";
import { inviteState } from "../intake/inviteState.js";
import type { View } from "../appRoutes.js";
import { heldCashbackSentence } from "../copy/optimise.js";
import DocumentsCard, { type DocumentNotice } from "../components/documents/DocumentsCard.js";
import GenericImportCard, {
  type GenericImportRequest,
} from "../components/import/GenericImportCard.js";
import Import from "./Import";
import Koppelingen from "./Koppelingen";
import Backup from "./Backup";
import Button from "../components/ui/Button.js";
import Card, { CardHeader } from "../components/ui/Card.js";
import CardLink from "../components/ui/CardLink.js";
import SaldoInput from "../components/ui/SaldoInput.js";
import StatusLine from "../components/ui/StatusLine.js";
import SignInForm from "../components/SignInForm.js";

/* Profiel — five things, in this order: Algemeen (account e-mail, name, country and
 * region, language, appearance), Jouw plan (with the "what LaVega knows" link),
 * Importeren, Back-up and one Uitloggen. Cards that are hidden for now (own-columns
 * import, documents, cashback correction, net-worth sharing) sit behind flags in
 * archive.ts; the code stays so they can come back.
 *
 * Importeren and Back-up are the EXISTING components — the same code, a different
 * place — so there is one implementation of each. */

type ProfielProps = {
  /** Opens "what LaVega knows about you". Absent: the card is not shown. */
  onNavigate?: (view: View) => void;
  /** The intake has produced something to plan with (App's rule, unchanged).
   *  Unlocked, the top card opens the plan; locked, it starts the intake. */
  planUnlocked: boolean;
  /** The stored profile and whether the vault holds a transaction: locked, the
   *  plan card says "Ga verder" for a half-done intake. */
  intakeStore?: AdvisorProfileStore | null;
  hasTransactions?: boolean;
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
  /** Opt-in share of Totale positie into LaVega Investing's net worth. The card is
   *  hidden behind SHOW_NET_WORTH_SHARE; the props stay so it can come back. Owned by
   *  App: turning it off must fire the DELETE exactly once, from the same
   *  place the preference itself changes. `shareNetWorthEnabled` is the
   *  EFFECTIVE state the checkbox shows (App keeps the underlying preference
   *  on internally until the delete that turning it off triggers actually
   *  succeeds, so the checkbox itself must not wait for that to uncheck). */
  shareNetWorthEnabled: boolean;
  onShareNetWorthEnabledChange: (on: boolean) => void;
  /** True while a delete triggered by turning the switch off has not yet
   *  succeeded — shows the retry note; App keeps retrying on its own. */
  shareNetWorthPendingDelete: boolean;
  /** The owner's own name. A local preference; it never leaves this browser. */
  ownerName: OwnerName;
  onOwnerNameChange: (name: OwnerName) => void;
  onLock: () => void;
  /** Import (unchanged component, moved here from the homescreen). */
  entity: string;
  onEntityChange: (entity: string) => void;
  busy: boolean;
  problems: ShellNotice[];
  onImport: (file: File) => void;
  onRefreshBank: () => void;
  /** Back-up (unchanged component). */
  storage: VaultStorage;
  asOf: string;
  onRestored: () => void;
  /** Statement documents (WS3.4/WS3.5, issue #293): metadata only; the bytes
   *  live sealed in their own store. */
  documents?: VaultDocument[];
  documentNotice?: DocumentNotice | null;
  documentErased?: number | null;
  accounts?: readonly Account[];
  txs?: readonly Tx[];
  valuations?: readonly Valuation[];
  onDocumentUpload?: (file: File) => void;
  onDocumentLink?: (id: string, accountKey: string) => void;
  onDocumentReject?: (id: string) => void;
  onDocumentRemove?: (id: string) => void;
  onDocumentEraseAll?: () => void;
  /** Generic import sessions (WS3.6, issue #294). */
  importSessions?: ImportSession[];
  importNotice?: string | null;
  onGenericImport?: (request: GenericImportRequest) => void;
  onGenericRevert?: (sessionId: string) => void;
};

/* Account, inside Algemeen — sign in against the configured LaVega server so the
 * owner can test the Enable Banking flow. Sign-up lives in the landing page's auth
 * dialog, not here, and the server still requires a verified email. Signed in, this
 * is one e-mail line; the one sign-out control sits at the bottom of the page.
 * Nothing renders while the state is `loading`: a signed-out default would flash the
 * login form at someone who is already signed in, for the one render before the
 * real check lands. */
function AccountPart({ state, refresh }: { state: AuthState; refresh: () => void }) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  if (state.kind === "loading") return null;
  return (
    <div data-testid="general-account">
      {state.kind === "unconfigured" && (
        <p className="cell-sub">{c.profiel.account.unconfigured}</p>
      )}
      {state.kind === "signed-out" && (
        <SignInForm locale={locale} intro={c.profiel.account.signedOutIntro} onSuccess={refresh} />
      )}
      {state.kind === "signed-in" && (
        <p>
          <span className="text-muted">{c.profiel.account.emailLabel}</span>{" "}
          <span data-testid="general-email">{state.email}</span>
        </p>
      )}
    </div>
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
        <StatusLine tone="problem" role="alert">
          {c.profiel.cashback.loadProblemPrefix}
          {loadProblem}
          {c.profiel.cashback.loadProblemSuffix}
        </StatusLine>
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
        <StatusLine tone="problem" role="alert">
          {problem}
        </StatusLine>
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
  planUnlocked,
  intakeStore = null,
  hasTransactions = false,
  entities,
  onClassifyEntity,
  homeCountry,
  onHomeCountryChange,
  homeRegion,
  onHomeRegionChange,
  shareNetWorthEnabled,
  onShareNetWorthEnabledChange,
  shareNetWorthPendingDelete,
  ownerName,
  onOwnerNameChange,
  onLock,
  entity,
  onEntityChange,
  busy,
  problems,
  onImport,
  onRefreshBank,
  storage,
  asOf,
  onRestored,
  documents = [],
  documentNotice = null,
  documentErased = null,
  accounts = [],
  txs = [],
  valuations = [],
  onDocumentUpload,
  onDocumentLink,
  onDocumentReject,
  onDocumentRemove,
  onDocumentEraseAll,
  importSessions = [],
  importNotice = null,
  onGenericImport,
  onGenericRevert,
  onNavigate,
}: ProfielProps) {
  const [locale, setLocale] = useAppLocale();
  const [theme, setTheme] = useTheme();
  const c = shellCopy[locale];
  const { state: authState, refresh: refreshAuth } = useAuthState();
  // 249 countries; built once rather than on every keystroke elsewhere on the page.
  const countries = useMemo(() => countryListIn(locale), [locale]);
  const regions = regionsFor(homeCountry);

  /* The one sign-out. With an account session it signs out of the account and
   * then locks the vault; without one it only locks. */
  async function handleSignOut() {
    // Still "loading" counts as a possible session: try the account sign-out.
    // The vault locks whatever happens to the request.
    try {
      if (authState.kind === "signed-in" || authState.kind === "loading") {
        await signOut();
        posthog.reset();
      }
    } catch {
      // The server could not be reached: the vault still locks.
    } finally {
      refreshAuth();
      onLock();
    }
  }

  const invite = intakeCopy[locale].home.invite;
  const resuming = (() => {
    const state = inviteState(intakeStore, asOf, hasTransactions);
    return state?.kind === "intake" && state.resumeAt !== null;
  })();
  return (
    <>
      {/* Algemeen: who you are and how this screen looks. The name is a local
          preference like the buffer and the country: this browser only, never in
          the vault, never in a back-up, and deliberately never in anything a
          model is given. */}
      <Card as="section" aria-label={c.profiel.general.ariaLabel} data-testid="profiel-general">
        <h2>{c.profiel.general.heading}</h2>
        <AccountPart state={authState} refresh={refreshAuth} />

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
        <p className="cell-sub">{c.profiel.head.note}</p>

        <div className="facturen-form mt-3">
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
        <p className="cell-sub">{c.profiel.countryRegion.purpose}</p>

        <h3 className="mt-3">{c.profiel.languageSwitch.cardLabel}</h3>
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

        <h3 className="mt-3">{c.profiel.appearance.heading}</h3>
        <div
          className="module-tabs theme-switch"
          role="radiogroup"
          aria-label={c.profiel.appearance.groupLabel}
        >
          {THEME_OPTIONS.map((option) => (
            <label
              key={option}
              className={`module-tab theme-option${theme === option ? " module-tab-on" : ""}`}
            >
              <input
                type="radio"
                name="lavega-theme"
                value={option}
                checked={theme === option}
                onChange={() => setTheme(option)}
              />
              <span className={`theme-swatch theme-swatch-${option}`} aria-hidden="true" />
              {c.profiel.appearance[option]}
            </label>
          ))}
        </div>
      </Card>

      <Card as="section" aria-label={c.nav.moduleLabels.plan} className="profiel-plan">
        <h2>{c.nav.moduleLabels.plan}</h2>
        <p>{planUnlocked ? c.profiel.plan.line : invite.intro}</p>
        <Button variant="primary" onClick={() => onNavigate?.(planUnlocked ? "plan" : "intake")}>
          {planUnlocked ? c.profiel.plan.open : resuming ? invite.resume : invite.start}
        </Button>
        {onNavigate && (
          <p className="mt-3 mb-0">
            <CardLink onClick={() => onNavigate("about-you")}>
              {intakeCopy[locale].aboutYou.profielCard.open}
            </CardLink>
          </p>
        )}
      </Card>

      <Import
        entity={entity}
        onEntityChange={onEntityChange}
        busy={busy}
        problems={problems}
        onImport={onImport}
        onRefreshBank={onRefreshBank}
      />

      <Backup storage={storage} asOf={asOf} onRestored={onRestored} />

      {/* Hidden unless the owner already opted in (or a delete is pending): then it stays
          visible so the choice can be seen and revoked. */}
      {(SHOW_NET_WORTH_SHARE || shareNetWorthEnabled || shareNetWorthPendingDelete) && (
        <Card as="section" aria-label={c.profiel.netWorthShare.ariaLabel}>
          <CardHeader>
            <h2>{c.profiel.netWorthShare.heading}</h2>
          </CardHeader>
          <p className="cell-sub">{c.profiel.netWorthShare.description}</p>
          <p className="cell-sub">{c.profiel.netWorthShare.privacyNote}</p>
          <p className="cell-sub">{c.profiel.netWorthShare.perDeviceNote}</p>
          <label>
            <input
              type="checkbox"
              checked={shareNetWorthEnabled}
              aria-label={c.profiel.netWorthShare.toggleLabel}
              onChange={(e) => onShareNetWorthEnabledChange(e.target.checked)}
            />{" "}
            {c.profiel.netWorthShare.toggleLabel}
          </label>
          <p className="cell-sub">
            {shareNetWorthEnabled
              ? c.profiel.netWorthShare.onStatus
              : c.profiel.netWorthShare.offStatus}
          </p>
          {shareNetWorthPendingDelete && (
            <StatusLine tone="warning" role="alert">
              {c.profiel.netWorthShare.pendingDeleteStatus}
            </StatusLine>
          )}
        </Card>
      )}

      {/* Hidden for now (archive.ts flags). The cards stay in the code. */}
      {SHOW_OWN_COLUMNS_IMPORT && onGenericImport != null && (
        <GenericImportCard
          accounts={[...accounts]}
          existingTxs={[...txs]}
          sessions={importSessions}
          busy={busy}
          notice={importNotice}
          onImport={onGenericImport}
          onRevert={onGenericRevert ?? (() => {})}
        />
      )}

      {SHOW_DOCUMENTS_CARD && onDocumentUpload != null && (
        <DocumentsCard
          documents={documents}
          accounts={[...accounts]}
          txs={[...txs]}
          valuations={valuations}
          asOf={asOf}
          busy={busy}
          notice={documentNotice}
          erased={documentErased}
          onUpload={onDocumentUpload}
          onLink={onDocumentLink ?? (() => {})}
          onReject={onDocumentReject ?? (() => {})}
          onRemove={onDocumentRemove ?? (() => {})}
          onEraseAll={onDocumentEraseAll ?? (() => {})}
        />
      )}

      {SHOW_INVOICE_FORWARDING && <Koppelingen />}

      {SHOW_CASHBACK_CORRECTION && (
        <CashbackCorrigeren storage={storage} asOf={asOf} onRestored={onRestored} />
      )}

      {SHOW_ENTITY_CLASSIFIER && (
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
      )}

      <Card as="section" aria-label={c.profiel.lock.ariaLabel}>
        <h2>{c.profiel.lock.heading}</h2>
        <p className="cell-sub">{c.profiel.lock.description}</p>
        <Button onClick={() => void handleSignOut()}>{c.profiel.lock.button}</Button>
      </Card>
      <p className="cell-sub" data-testid="build-stamp">
        LaVega build {__LAVEGA_BUILD__}
      </p>
    </>
  );
}
