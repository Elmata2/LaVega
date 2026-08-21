import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, Rule, Tx, ScheduledFlow, VatSettings, Invoice, RewardsBalance, LearnedFact, EntityProfile, EntityScope } from "@lavega/core";
import { ingest, reassignEntity, withCurrentBalances, isCardAccount, mergeImportedAccounts, ownAccounts, assignTxIds, scheduledFlowsForScope, scheduledInvoiceFlows, reconcileInvoices, applyCategorizations, findDuplicateAccounts, mergeAccounts, upsertFacts, renameFactSubject, productOf, makeFact, planTravel, countryCurrency, accountsInScope, entitySummaries, setEntityScope as classifyEntity, DEFAULT_ENTITY_SCOPE, TRAVEL_AGENT, NL_SAVINGS_RATES, RATES_AS_OF } from "@lavega/core";
import type { CategoryDecision } from "@lavega/core";
import { createFileImport, createEncryptedStorage, mapEbAccount, pickEbBalance, pickEbBalanceDate, mapEbTransaction, ebAccountKey, createRatesProvider, type RatesResult } from "@lavega/adapters";
import { CATALOGUE_RATES } from "./catalogue-rates";
import { API_BASE } from "./api.js";
import { gateState } from "./vault-gate.js";
import type { GateState } from "./vault-gate.js";
import { hasLegacyData } from "./migrate.js";
import { getBufferCents, setBufferCents, getHomeCountry, setHomeCountry, getHomeRegion, setHomeRegion, getOwnerName, setOwnerName, getEnabledModules, setEnabledModules, type OwnerName } from "./settings.js";
import { txIdsForAccount, txDiff } from "./accountActions.js";
import { txsForAccounts, flowsForScope, entityOptionsFor, screenOnSwitch, SCOPE_LABELS, type ParkedScreens, type ScopeScreen } from "./scope.js";
import { mergeScheduledFlows } from "./scheduled-flows.js";
import { travelFacts } from "./api.js";
import VaultGate from "./components/VaultGate";
import NavBar from "./components/NavBar";
import TopBar from "./components/TopBar";
import { enabledModules as resolveModules, navModules, type ModuleId } from "./components/moduleRegistry";
import Overzicht from "./views/Overzicht";
import Transacties from "./views/Transacties";
import Rekeningen from "./views/Rekeningen";
import Forecast from "./views/Forecast";
import Optimalisatie from "./views/Optimalisatie";
import Valuta from "./views/Valuta";
import Belasting from "./views/Belasting";
import Facturen from "./views/Facturen";
import Punten from "./views/Punten";
import Koppelingen from "./views/Koppelingen";
import Backup from "./views/Backup";
import Profiel from "./views/Profiel";
import type { N8nNotice, PendingInvoice } from "./n8n.js";

// Single storage instance for the app's lifetime; putAccounts/putTxs upsert
// (keyPath "key" / "id"), so re-importing the same account/tx is safe. Data is
// at rest only in the encrypted vault — the app never touches the legacy
// plaintext `lavega` DB directly (that's migrate.ts's job, once, at setup).
const storage = createEncryptedStorage();

// Public savings-rate benchmark (same source Optimalisatie uses).
const RATES_URL: string | undefined =
  import.meta.env.VITE_RATES_URL ?? (import.meta.env.DEV ? "http://localhost:8787/api/rates" : undefined);

/* "rules" has NO route any more: Regels is a setting, so it renders inline in
 * Profiel and nothing calls setView("rules"). Its branch below is gone. The
 * union still lists it only because components/TopBar.tsx types its page-title
 * table as Record<View, string> and still has a "Regels" entry — dropping the
 * member there is one line in a file this change does not own, and that title
 * map is a label lookup, not a way to reach the view.
 *
 * "koppelingen" and "backup" look equally orphaned and are NOT: Facturen sends
 * you to Koppelingen ("Koppelingen instellen", Facturen.tsx:480), and the
 * post-migration screen sends you to Back-up ("Maak nu een back-up",
 * VaultGate.tsx:284 → onBackup → setView("backup")). Both also render inline in
 * Profiel; these two are the deep links into them, so their branches stay. */
export type View = "overview" | "transactions" | "accounts" | "rules" | "forecast" | "optimalisatie" | "valuta" | "belasting" | "facturen" | "punten" | "koppelingen" | "backup" | "profiel";

export default function App() {
  const [gate, setGate] = useState<GateState>("loading");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  // Which entity an import files its accounts under. Persoonlijk, because that
  // is what most statements are and because core's hard default for an
  // unclassified entity is personal — so the imported accounts land in the half
  // the app opens on instead of in a "BV1" nobody asked for. He can retype it
  // before importing, and change it per account in Rekeningen afterwards.
  const [entity, setEntity] = useState("Persoonlijk");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [scheduledFlows, setScheduledFlows] = useState<ScheduledFlow[]>([]);
  const [vatSettings, setVatSettings] = useState<VatSettings[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [rewards, setRewards] = useState<RewardsBalance[]>([]);
  // Invoice rows fetched from his own n8n and not yet decided on. Held HERE,
  // not in the Facturen view: that webhook empties its queue as it responds, so
  // these rows are the only copy in existence and must not die when the view
  // unmounts on a navigation. Deliberately not persisted — the vault is the
  // only place invoice amounts are allowed to rest, and until he confirms a
  // row it isn't an invoice yet. Vergrendel therefore clears them too, which
  // the view says out loud.
  const [pendingInvoices, setPendingInvoices] = useState<PendingInvoice[]>([]);
  // Meldingen uit n8n: mail die WEL over een factuur ging maar er geen is (staat
  // klaar bij de leverancier, aanmaning, onleesbaar). Ze horen hier om dezelfde
  // reden als de rijen hierboven: de webhook leegt zichzelf, dus dit is de enige
  // kopie. Ze bevatten geen bedrag en kunnen dus nooit een boeking worden.
  const [pendingNotices, setPendingNotices] = useState<N8nNotice[]>([]);
  // What the agents have learned (and what he corrected). Lives in the vault.
  const [facts, setFacts] = useState<LearnedFact[]>([]);
  // The owner's own privé/zakelijk classification, one row per entity. Lives in
  // the vault (storage.getEntityProfiles). An entity with no row is personal —
  // core's hard default, never a guess: `suggestEntityScope` only prefills the
  // picker in the profile, it never resolves on its own.
  const [entityProfiles, setEntityProfiles] = useState<EntityProfile[]>([]);
  // Public savings benchmark for the travel block's "where to keep it" step.
  // Same provider Optimalisatie uses (localStorage-cached), so no double fetch
  // cost; falls back to the bundled snapshot when the rates server is down.
  const [rates, setRates] = useState<RatesResult>({ rates: [...NL_SAVINGS_RATES], asOf: RATES_AS_OF, source: "bundled" });
  // The country that drives the tax rules and the market whose card terms the
  // travel agent looks up. A local preference, edited in the profile — held in
  // state so changing it re-renders everything that reads it.
  const [homeCountry, setHomeCountryState] = useState<string>(() => getHomeCountry());
  // The level beneath it: "Texas" and "New York" are not the same tax question,
  // and a country code cannot carry that. "" = he has not said, which nothing
  // may read as a region. Typed by hand, always — LaVega never infers location.
  const [homeRegion, setHomeRegionState] = useState<string>(() => getHomeRegion());
  function handleHomeCountryChange(code: string) {
    setHomeCountry(code);
    setHomeCountryState(getHomeCountry()); // read back: setHomeCountry rejects a non-ISO code
    // A region belongs to a country. Keeping "Texas" while the country becomes
    // Duitsland would leave a value on screen that means nothing anywhere.
    setHomeRegion("");
    setHomeRegionState("");
  }
  function handleHomeRegionChange(region: string) {
    setHomeRegion(region);
    setHomeRegionState(getHomeRegion()); // read back: the store trims and caps
  }
  // The owner's own name, shown at the top of his profile. A local preference —
  // it stays in this browser, out of the vault, and out of every model prompt.
  const [ownerName, setOwnerNameState] = useState<OwnerName>(() => getOwnerName());
  function handleOwnerNameChange(next: OwnerName) {
    setOwnerNameState(next); // keep the field exactly as typed, spaces and all
    setOwnerName(next);
  }
  // Whether the server has an ANTHROPIC_API_KEY (drives the AI features'
  // "not configured" state). Fetched once; defaults false on any error.
  const [llmConfigured, setLlmConfigured] = useState(false);
  // A question raised elsewhere in the UI (e.g. the per-category "vs.
  // gemiddelde" button). The floating chat widget that consumed it is
  // deliberately not rendered for now (his UI review: "remove it, decide later
  // what it becomes"), so the question is parked here until it comes back —
  // the component file and this wiring stay so that is a one-line change.
  // Providers the server said it is still looking up. The travel block needs
  // this to say "still searching" instead of "nothing came back" — two very
  // different sentences that used to be one.
  const [pendingTerms, setPendingTerms] = useState<string[]>([]);
  /** How many providers the last ask covered, so the indicator can count up
   *  ("2 van 4 gevonden") instead of only counting what is left. */
  const [termsAsked, setTermsAsked] = useState(0);
  /** The lookups ran their course without finishing. Said out loud rather than
   *  leaving a spinner turning forever, which is its own kind of lie. */
  const [termsGaveUp, setTermsGaveUp] = useState(false);
  const [askText, setAskText] = useState<string | null>(null);
  const [askNonce, setAskNonce] = useState(0);
  function askAssistant(text: string) {
    setAskText(text);
    setAskNonce((n) => n + 1);
  }

  // The owner's own module selection: which modules sit in the top nav. A local
  // preference (settings.ts); the registry resolves an unset/stale stored list
  // and guarantees Overzicht is in it.
  const [modules, setModules] = useState<ModuleId[]>(() => resolveModules(getEnabledModules()));
  function handleModulesChange(next: ModuleId[]) {
    const resolved = resolveModules(next);
    setModules(resolved);
    setEnabledModules(resolved);
  }
  // Bumped by "Widget toevoegen" in the header so the profile scrolls to the
  // picker instead of the top of a long settings page.
  const [addWidget, setAddWidget] = useState(0);
  function handleAddWidget() {
    setView("profiel");
    setAddWidget((n) => n + 1);
  }

  const [view, setView] = useState<View>("overview");
  // The shell's own filter: whose money is on screen. Starts on the classification
  // core defaults to, so a vault that has never been classified opens showing
  // everything it has rather than an empty page.
  const [scope, setScope] = useState<EntityScope>(DEFAULT_ENTITY_SCOPE);
  // The per-COMPANY scope inside that half ("" = every company in this scope).
  // The chrome no longer sets it (per-company splitting is not a priority), but
  // the plumbing is intact and every view still receives it — Transacties and
  // Rekeningen still filter per company, and Belasting still works per BV.
  const [entityScope, setEntityScope] = useState("");
  // Built once at mount (empty deps — never re-reads the clock), so the
  // forecast stays deterministic for the lifetime of the session.
  const asOf = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [fEntity, setFEntity] = useState("");
  const [fAccount, setFAccount] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fCategory, setFCategory] = useState("");

  /* The switch is a round trip, not a reset. Each half keeps the module it was
   * left on and its own view filters; crossing over parks one screen and
   * restores the other. See scope.ts for why — an empty Zakelijk used to send
   * him to Rekeningen and never bring the Overzicht back, and a filter naming a
   * personal account used to ride along and empty the business half.
   *
   * A ref, not state: the parked screens are read and written at the moment of
   * the switch and nothing renders from them, so they must never cause a
   * render of their own. */
  const parkedScreens = useRef<ParkedScreens>({});
  function currentScreen(): ScopeScreen {
    return { view, fEntity, fAccount, fSearch, fFrom, fTo, fCategory };
  }
  function handleScopeChange(next: EntityScope) {
    if (next === scope) return;
    parkedScreens.current[scope] = currentScreen();
    const screen = screenOnSwitch(parkedScreens.current, next, currentScreen());
    setView(screen.view);
    setFEntity(screen.fEntity);
    setFAccount(screen.fAccount);
    setFSearch(screen.fSearch);
    setFFrom(screen.fFrom);
    setFTo(screen.fTo);
    setFCategory(screen.fCategory);
    setScope(next);
  }

  const [ruleMatch, setRuleMatch] = useState("");
  const [ruleCategory, setRuleCategory] = useState("");
  // Alert buffer (cents): warn when the forecast dips below this, so shortfalls
  // surface early instead of only at €0. Persisted as a local preference.
  const [bufferCents, setBufferCentsState] = useState<number>(() => getBufferCents());
  function handleBufferChange(cents: number) {
    const c = Math.max(0, Math.round(cents));
    setBufferCentsState(c);
    setBufferCents(c);
  }

  // Ask the server once whether the AI assistant is configured (key present).
  // Independent of the vault gate — it sends no account data, just a status GET.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/agent/status`);
        if (!res.ok) return;
        const data = (await res.json()) as { configured?: boolean };
        if (!cancelled) setLlmConfigured(!!data.configured);
      } catch {
        /* default false — widget shows the "not configured" state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Decide which gate screen to show: unlock an existing vault, migrate
  // existing plaintext data into a fresh vault, or set up a brand-new one.
  useEffect(() => {
    (async () => {
      const [status, legacy] = await Promise.all([storage.status(), hasLegacyData()]);
      setGate(gateState(status, legacy));
    })();
  }, []);

  // Load persisted data once the vault is unlocked, so a reload (or a fresh
  // unlock after Vergrendel) shows prior imports. Gated on `gate` — never runs
  // against a locked/empty vault, which would just throw.
  useEffect(() => {
    if (gate !== "ready") return;
    (async () => {
      const [loadedAccounts, loadedTxs, loadedRules, loadedFlows, loadedVat, loadedInvoices, loadedRewards, loadedFacts, loadedProfiles] = await Promise.all([
        storage.getAccounts(),
        storage.getTxs(),
        storage.getRules(),
        storage.getScheduledFlows(),
        storage.getVatSettings(),
        storage.getInvoices(),
        storage.getRewards(),
        storage.getFacts(),
        storage.getEntityProfiles(),
      ]);
      setAccounts(loadedAccounts);
      setTxs(loadedTxs);
      setRules(loadedRules);
      setScheduledFlows(loadedFlows);
      setVatSettings(loadedVat);
      setInvoices(loadedInvoices);
      setRewards(loadedRewards);
      setFacts(loadedFacts);
      setEntityProfiles(loadedProfiles);
    })();
  }, [gate]);

  // Public savings-rate benchmark for the travel block's "where to keep it"
  // step. Public data, not user data; failing is harmless (bundled snapshot).
  useEffect(() => {
    let alive = true;
    createRatesProvider({ url: RATES_URL, catalogueRates: CATALOGUE_RATES })
      .getRates()
      .then((r) => alive && setRates(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // After returning from an Enable Banking authorisation, the browser lands on
  // the SPA with ?eb=<session> (or ?eb_error=). Once the vault is unlocked, pull
  // the accounts+transactions, map them (same shape as a file import) and store
  // them. Reads fresh from storage to avoid stale state right after unlock.
  useEffect(() => {
    if (gate !== "ready") return;
    const params = new URLSearchParams(window.location.search);
    const ebError = params.get("eb_error");
    const ebSession = params.get("eb");
    if (!ebError && !ebSession) return;
    window.history.replaceState({}, "", window.location.pathname); // don't re-run on refresh
    setView("overview");
    if (ebError) {
      setProblems([`Bankkoppeling mislukt: ${ebError}`]);
      return;
    }
    (async () => {
      setBusy(true);
      try {
        const res = await fetch(`${API_BASE}/api/eb/accounts?session_id=${encodeURIComponent(ebSession as string)}`);
        const data = await res.json();
        if (!res.ok || data.error) {
          setProblems([`Bankkoppeling mislukt: ${data.error ?? res.status}`]);
          return;
        }
        const aspsp: string = data.aspsp ?? "";
        const newAccounts: Account[] = [];
        const rawTxs: Array<Omit<Tx, "id">> = [];
        for (const item of data.items ?? []) {
          /* De DATUM erbij, en niet alleen het bedrag. Rekeningen zegt per
           * rekening "stand van <dag>", en zonder deze derde parameter stond daar
           * "datum onbekend" terwijl Enable Banking hem gewoon meestuurt — wij
           * gooiden weg wat de bank vertelde en zeiden daarna dat we het niet
           * wisten. Ontbreekt hij bij de bank, dan blijft hij leeg: de dag van
           * ophalen invullen zou een saldo van drie weken oud als dat van vandaag
           * laten lezen. */
          const acc = mapEbAccount(
            { ...item.account, aspsp },
            pickEbBalance(item.balances),
            pickEbBalanceDate(item.balances) ?? undefined,
          );
          acc.entity = entity;
          newAccounts.push(acc);
          const key = ebAccountKey(item.account);
          for (const t of item.transactions ?? []) rawTxs.push(mapEbTransaction(t, key, acc.currency));
        }
        const [curAccounts, curTxs] = await Promise.all([storage.getAccounts(), storage.getTxs()]);
        const mergedAccounts = mergeImportedAccounts(curAccounts, newAccounts);
        const mergedTxs = ingest(curTxs, assignTxIds(rawTxs));
        await storage.putAccounts(mergedAccounts);
        await storage.putTxs(mergedTxs);
        const [fa, ft] = await Promise.all([storage.getAccounts(), storage.getTxs()]);
        setAccounts(fa);
        setTxs(ft);
        // Reconcile invoices against the freshly linked bank txs (same as file import).
        const curInvoices = await storage.getInvoices();
        const reconciled = reconcileInvoices(curInvoices, ft);
        if (JSON.stringify(reconciled) !== JSON.stringify(curInvoices)) await saveInvoices(reconciled);
        setProblems([`Bank gekoppeld: ${newAccounts.length} rekening(en)${aspsp ? ` via ${aspsp}` : ""}, ${rawTxs.length} transacties.`]);
      } catch (e) {
        setProblems([`Bankkoppeling mislukt: ${e instanceof Error ? e.message : String(e)}`]);
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate]);

  // Sidebar "Vergrendel": drop the derived key + in-memory data (nothing
  // sensitive stays rendered) and show the unlock screen again.
  function handleLock() {
    storage.lock();
    setAccounts([]);
    setTxs([]);
    setRules([]);
    setScheduledFlows([]);
    setVatSettings([]);
    setInvoices([]);
    setRewards([]);
    setFacts([]);
    setEntityProfiles([]);
    setPendingInvoices([]);
    setPendingNotices([]);
    setGate("unlock");
  }

  // Rules are UI-owned as a whole list (replace-all persistence), so every
  // add/remove goes through this single helper to keep state and storage in sync.
  async function saveRules(next: Rule[]) {
    setRules(next);
    await storage.putRules(next);
  }

  // Per-BV VAT settings are UI-owned as a whole list (replace-all persistence),
  // same pattern as saveRules. Scheduled flows are NOT — see saveScheduledFlows,
  // which has to merge because every view is handed only its own scope's flows.
  async function saveVatSettings(next: VatSettings[]) {
    setVatSettings(next);
    await storage.putVatSettings(next);
  }
  // Invoices are UI-owned as a whole list (replace-all persistence), same pattern
  // as saveRules/saveScheduledFlows.
  async function saveInvoices(next: Invoice[]) {
    setInvoices(next);
    await storage.putInvoices(next);
  }
  // Rewards balances are UI-owned as a whole list (replace-all persistence),
  // same pattern as saveInvoices. No reconcile — rewards are independent of
  // bank data (manual balances, no auto-sync).
  async function saveRewards(next: RewardsBalance[]) {
    setRewards(next);
    await storage.putRewards(next);
  }

  // Persist the full tx list after an in-memory edit. `putTxs` is upsert-by-id
  // (not replace-all like putRules), which is correct here because the AI-
  // categorize flow passes the COMPLETE list back from `applyCategorizations`,
  // so upserting every id is equivalent to a replace. Used to persist the
  // `manual` category stamped on decided txs.
  async function saveTxs(next: Tx[]) {
    setTxs(next);
    await storage.putTxs(next);
  }

  // Apply confirmed AI-category decisions against the FULL tx + rules lists
  // (not just the scoped view Transacties shows), then persist. Adding one
  // deduped rule per (counterparty, category) means future imports of the same
  // merchant auto-categorize without another AI call.
  async function handleApplyCategories(decisions: CategoryDecision[]) {
    const next = applyCategorizations(txs, rules, decisions);
    await saveTxs(next.txs);
    if (next.rules.length !== rules.length) await saveRules(next.rules);
  }

  // After storage.restore() swaps in a different vault's data (Task 5), reload
  // everything from it — restore() itself only touches storage, never React state.
  async function handleRestored() {
    const [freshAccounts, freshTxs, freshRules, freshFlows, freshVat, freshInvoices, freshRewards, freshProfiles] = await Promise.all([
      storage.getAccounts(),
      storage.getTxs(),
      storage.getRules(),
      storage.getScheduledFlows(),
      storage.getVatSettings(),
      storage.getInvoices(),
      storage.getRewards(),
      storage.getEntityProfiles(),
    ]);
    setAccounts(freshAccounts);
    setTxs(freshTxs);
    setRules(freshRules);
    setScheduledFlows(freshFlows);
    setVatSettings(freshVat);
    setInvoices(freshInvoices);
    setRewards(freshRewards);
    setEntityProfiles(freshProfiles);
  }

  // Classify one entity as privé or zakelijk. Replace-all persistence, same
  // pattern as saveRules; the core mutator keeps it one row per entity.
  async function handleClassifyEntity(entityName: string, next: EntityScope) {
    const profiles = classifyEntity(entityProfiles, entityName, next);
    setEntityProfiles(profiles);
    await storage.putEntityProfiles(profiles);
  }

  // The accounts of the half in view. Built from the FULL list, so switching
  // the top-bar switch is the only thing that decides which half you see.
  const scopeAccounts = useMemo(
    () => accountsInScope(accounts, scope, entityProfiles),
    [accounts, scope, entityProfiles],
  );

  // One row per entity with its resolved classification — what the profile's
  // "Persoonlijk of zakelijk" list edits. Built from ALL accounts, never the
  // scoped subset: an entity must stay editable after you move it to the half
  // you are not currently looking at.
  const entitySummaryRows = useMemo(() => entitySummaries(accounts, entityProfiles), [accounts, entityProfiles]);

  // The companies inside the active half — what the per-company controls that
  // survive (Transacties' filter, Belasting's per-BV modules) are built from.
  const entityOptions = useMemo(() => entityOptionsFor(scopeAccounts), [scopeAccounts]);

  // Own-account identifiers for "Eigen overboeking" detection. Built from the
  // FULL accounts list (not the entity-scoped subset) so a transfer between
  // accounts of different BVs is still recognized as an internal transfer.
  const own = useMemo(() => ownAccounts(accounts), [accounts]);

  // Accounts that look like the SAME real account imported twice. Computed on
  // the full list (a duplicate pair can straddle two entities if one side was
  // filed under the wrong BV); Rekeningen narrows the banner to the scope.
  const duplicateGroups = useMemo(() => findDuplicateAccounts(accounts), [accounts]);

  // Self-heal the Transacties entity filter and the top-bar entity scope: if
  // the selected entity no longer exists (e.g. its last account was
  // reassigned away in Rekeningen), reset to "Alle" so neither control keeps
  // filtering to nothing while showing a stale selection.
  useEffect(() => {
    // Reset the per-view entity filter when it's gone OR when a top-bar scope
    // pill is active (the scope already constrains the entity and the dropdown
    // is hidden, so a stale fEntity would silently filter Transacties to 0 rows).
    if (fEntity && (entityScope !== "" || !entityOptions.includes(fEntity))) setFEntity("");
    if (entityScope && !entityOptions.includes(entityScope)) setEntityScope("");
    // Drop a stale account filter that's no longer selectable — the account was
    // removed, or a scope pill now excludes it — else it silently filters to 0.
    const acc = accounts.find((a) => a.key === fAccount);
    if (fAccount && (!acc || (entityScope !== "" && acc.entity !== entityScope))) setFAccount("");
  }, [accounts, entityOptions, fEntity, fAccount, entityScope]);

  // Two nested scopes pre-filter the accounts/txs every view derives from: the
  // top-bar half (persoonlijk/zakelijk) and, inside it, entityScope ("" = every
  // company in this half). Each view's own filters (fEntity, fAccount, search,
  // ...) still apply on top of both.
  const scopedAccounts = useMemo(
    () => (entityScope ? scopeAccounts.filter((a) => a.entity === entityScope) : scopeAccounts),
    [scopeAccounts, entityScope],
  );
  // A transaction follows its account's classification — it is never classified
  // on its own, so the two can't disagree.
  const scopedTxs = useMemo(() => txsForAccounts(scopedAccounts, txs), [txs, scopedAccounts]);

  // A stored balance is only "as of" its balanceDate (no date => already
  // current); roll every account forward to `asOf` with its later txs so
  // Overzicht/Forecast always display/sum the current position. Rekeningen
  // still gets the RAW scopedAccounts below — it edits stored values, not
  // this derived view.
  const currentScopedAccounts = useMemo(
    () => withCurrentBalances(scopedAccounts, scopedTxs, asOf),
    [scopedAccounts, scopedTxs, asOf],
  );

  // The forecast/alerts input = the persisted scheduled flows (VAT set-asides,
  // manual plans) PLUS the flows projected from `expected` invoices. Merging here
  // means invoices show up in Overzicht/Forecast with no extra forecast wiring;
  // paid/cancelled invoices project no flow, so a settled invoice drops out.
  //
  // The invoice half is DERIVED, never stored: it is recomputed from `invoices`
  // on every render, which is why a paid invoice simply stops producing one. It
  // is hoisted into its own memo because the save path needs the very same list
  // to be sure it never writes one of these back into the vault.
  const invoiceFlows = useMemo(() => scheduledInvoiceFlows(invoices), [invoices]);
  const allScheduledFlows = useMemo(
    () => [...scheduledFlows, ...invoiceFlows],
    [scheduledFlows, invoiceFlows],
  );
  // Scheduled flows constrained to BOTH scopes, so Overzicht/Forecast never
  // show a company's VAT reservation while you are looking at your private
  // money. A flow carries its own entity (it can exist before that entity has
  // an account), so it is classified directly rather than through `accounts`.
  const scopedScheduledFlows = useMemo(
    () => scheduledFlowsForScope(flowsForScope(allScheduledFlows, scope, entityProfiles), entityScope),
    [allScheduledFlows, scope, entityProfiles, entityScope],
  );

  // Save a view's scheduled flows. Deliberately NOT replace-all like saveRules:
  // a view only ever receives `scopedScheduledFlows`, so its list says nothing
  // about the flows outside that scope and writing it whole would delete them.
  // `mergeScheduledFlows` is given exactly what the view was shown, so a flow it
  // dropped is a real deletion and a flow it never saw is left alone — and the
  // invoice-derived flows it hands back are not stored. Declared after the memos
  // it reads; it only ever runs from an event handler, never during a render.
  async function saveScheduledFlows(next: ScheduledFlow[]) {
    const merged = mergeScheduledFlows(scheduledFlows, scopedScheduledFlows, next, invoiceFlows);
    setScheduledFlows(merged);
    await storage.putScheduledFlows(merged);
  }

  // NOTE: the per-tab chat context (agent/tabContext.ts) is not built here any
  // more — the floating chat widget it fed is not rendered while its future is
  // being decided. Nothing about the redaction boundary changed; the builder
  // and the widget are both still in the tree, just unmounted.

  // The single data path: FileImport -> ingest -> persist -> reload -> consolidate.
  async function handleImport(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const result = await createFileImport().load({ filename: file.name, text, entity });
      setProblems(result.problems);

      const mergedTxs = ingest(txs, result.txs);
      // Re-importing a statement for an account you already have must not wipe
      // the Type/Entiteit/manual saldo you set in Rekeningen — merge those
      // forward. A fresh statement balance (MT940/.STA) still wins.
      const mergedAccounts = mergeImportedAccounts(accounts, result.accounts);
      await storage.putAccounts(mergedAccounts);
      await storage.putTxs(mergedTxs);

      const [freshAccounts, freshTxs] = await Promise.all([
        storage.getAccounts(),
        storage.getTxs(),
      ]);
      setAccounts(freshAccounts);
      setTxs(freshTxs);

      // Reconcile stored invoices against the freshly imported txs: an `expected`
      // invoice whose settling bank transaction now appears flips to `paid` (and
      // thus drops out of the forecast, no double-count). Persist only on change.
      const curInvoices = await storage.getInvoices();
      const reconciled = reconcileInvoices(curInvoices, freshTxs);
      if (JSON.stringify(reconciled) !== JSON.stringify(curInvoices)) await saveInvoices(reconciled);
    } catch (err) {
      setProblems([`Importeren mislukt: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setBusy(false);
    }
  }

  // Reassign an account's entity: update in memory on every keystroke (so the
  // Overzicht/Transacties regroup live), but persist only once on blur. A fresh
  // putAccounts per keystroke opens its own IndexedDB connection, and IndexedDB
  // orders writes by transaction-creation time — so a burst of keystrokes could
  // let an earlier write land after the final value and silently revert it.
  // Committing on blur means exactly one write per edit, in order.
  function handleEntityChange(key: string, newEntity: string) {
    setAccounts(reassignEntity(accounts, key, newEntity));
  }
  // The product name an account had BEFORE the edit in progress. Facts are keyed
  // by that generated name ("ING betaalpas"), so changing a bank or a type
  // renames the product and would orphan everything learned about it — the
  // owner's own corrections first of all. Captured on the first keystroke and
  // kept until commit, so typing a bank letter by letter still compares against
  // the name it had when the edit started, not against a half-typed one.
  const productBeforeEdit = useRef(new Map<string, string>());

  // Persist one account after an inline edit (entity, bank, name). Same reason
  // the entity edit commits on blur: one ordered write per edit, never one per
  // keystroke (IndexedDB orders by transaction-creation time, so a burst could
  // land out of order and revert the final value).
  async function handleAccountCommit(account: Account) {
    await storage.putAccounts([account]);

    const before = productBeforeEdit.current.get(account.key);
    productBeforeEdit.current.delete(account.key);
    const after = productOf(account);
    if (!before || !after || before === after) return;
    // Carry the facts along rather than silently starting from "onbekend".
    const next = renameFactSubject(facts, TRAVEL_AGENT, before, after);
    setFacts(next);
    await storage.putFacts(next);
  }

  // Patch an account in memory while typing. `renamed` rides along from the
  // rename cell so a later re-import knows this bank/name was typed by hand.
  function handleAccountFieldChange(key: string, patch: Partial<Account>) {
    if ("bank" in patch || "type" in patch || "name" in patch) {
      const current = accounts.find((a) => a.key === key);
      const product = current ? productOf(current) : "";
      if (product && !productBeforeEdit.current.has(key)) productBeforeEdit.current.set(key, product);
    }
    setAccounts(accounts.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }

  // Manually set an account's current saldo (CSV imports carry none). Accepts a
  // Dutch comma or dot decimal; blank clears it back to "onbekend" (null). Parse,
  // update state, persist that one account — feeds the Totaalpositie. A typed
  // value is "current as of today", so it also anchors balanceDate to asOf;
  // blank clears both back to unknown/unanchored.
  async function handleSaldoCommit(key: string, value: string) {
    const trimmed = value.trim().replace(",", ".");
    const raw = trimmed === "" ? null : Number(trimmed);
    if (raw !== null && !Number.isFinite(raw)) return; // ignore garbage input
    const account = accounts.find((a) => a.key === key);
    // For a credit card the typed value is the amount OWED, so store it as a
    // negative (debt) in the net position — the user types a plain positive.
    const balance = raw === null ? null : account && isCardAccount(account) ? -Math.abs(raw) : raw;
    const balanceDate = balance === null ? undefined : asOf;
    const next = accounts.map((a) => (a.key === key ? { ...a, balance, balanceDate } : a));
    setAccounts(next);
    const changed = next.find((a) => a.key === key);
    if (changed) await storage.putAccounts([changed]);
  }

  // Set an account's soort (type) — a select commits immediately (no draft/blur
  // needed, unlike free-text saldo/entiteit), same persist pattern as the others.
  async function handleTypeCommit(key: string, type: string) {
    const next = accounts.map((a) => (a.key === key ? { ...a, type } : a));
    setAccounts(next);
    const changed = next.find((a) => a.key === key);
    if (changed) await storage.putAccounts([changed]);
  }

  // Manually set/override an account's annual interest rate (%) for the
  // Optimisatie tab. Accepts a Dutch comma or dot (and a stray "%"); blank
  // clears the override back to auto (detected/assumed). Same persist pattern.
  async function handleRateCommit(key: string, value: string) {
    const trimmed = value.trim().replace(",", ".").replace("%", "");
    const rate = trimmed === "" ? undefined : Number(trimmed);
    if (rate !== undefined && !Number.isFinite(rate)) return; // ignore garbage
    const next = accounts.map((a) => (a.key === key ? { ...a, interestRate: rate } : a));
    setAccounts(next);
    const changed = next.find((a) => a.key === key);
    if (changed) await storage.putAccounts([changed]);
  }

  // Delete an account and every transaction imported with it. Irreversible (no
  // soft-delete), so Rekeningen confirms inline first. Transactions go FIRST:
  // if the second call fails, a leftover account row is visible and simply
  // deletable again, while orphaned transactions belong to nothing and would
  // still count toward the totals.
  async function handleDeleteAccount(key: string) {
    setBusy(true);
    try {
      const ids = txIdsForAccount(txs, key);
      if (ids.length > 0) await storage.deleteTxs(ids);
      await storage.deleteAccount(key);
      setTxs(txs.filter((t) => t.accountKey !== key));
      setAccounts(accounts.filter((a) => a.key !== key));
    } finally {
      setBusy(false);
    }
  }

  // Merge a duplicate account into its survivor: one real account that got
  // imported two ways (CSV keys by raw number, MT940/Enable Banking by IBAN).
  // The core merge re-keys the duplicate's transactions and collapses the
  // overlapping range by content, so a period present in both statements is
  // never double-counted. Persist exactly the diff it produced.
  async function handleMergeDuplicates(survivorKey: string, duplicateKey: string) {
    setBusy(true);
    try {
      const merged = mergeAccounts(accounts, txs, survivorKey, duplicateKey);
      const { removedIds, upserts } = txDiff(txs, merged.txs);
      if (removedIds.length > 0) await storage.deleteTxs(removedIds);
      if (upserts.length > 0) await storage.putTxs(upserts);
      const survivor = merged.accounts.find((a) => a.key === survivorKey);
      if (survivor) await storage.putAccounts([survivor]);
      await storage.deleteAccount(duplicateKey);
      setTxs(merged.txs);
      setAccounts(merged.accounts);
    } finally {
      setBusy(false);
    }
  }

  // Persist learned facts through the ONE merge rule (upsertFacts): whatever he
  // corrected himself is never overwritten by an agent refresh.
  async function saveFacts(incoming: LearnedFact[]) {
    const next = upsertFacts(facts, incoming);
    setFacts(next);
    await storage.putFacts(next);
  }

  // Ask the travel agent for the current terms of the providers whose terms we
  // don't know yet. Only provider NAMES and a country pair leave the browser —
  // the ranking that needs his balances already happened locally.
  /** Re-ask the server whether it has an AI key. The mount-time check runs once
   *  with empty deps, so a tab opened before the key was configured keeps
   *  reporting "deze server heeft geen AI-sleutel" forever — which is a true
   *  sentence about a stale fact, and indistinguishable from a broken feature.
   *  Re-checking when he actually reaches for AI costs one tiny GET. */
  async function recheckLlm(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/agent/status`);
      if (!res.ok) return llmConfigured;
      const data = (await res.json()) as { configured?: boolean };
      setLlmConfigured(!!data.configured);
      return !!data.configured;
    } catch {
      return llmConfigured; // offline: keep what we knew, do not claim worse
    }
  }

  /** Re-ask the cached endpoint until nothing is pending. Each pass writes what
   *  has landed, so the count moves and he can see it working. Bounded: a lookup
   *  that has not finished in this long is not going to, and a spinner that
   *  never stops says less than an honest "we gave up". */
  const POLL_MS = 15_000;
  const POLL_CEILING_MS = 6 * 60_000;

  async function pollTravelTerms(
    destination: string,
    providers: string[],
    knownFacts: { subject: string; key: string; value: string }[],
  ) {
    const until = Date.now() + POLL_CEILING_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let reply: Awaited<ReturnType<typeof travelFacts>>;
      try {
        reply = await travelFacts({
          homeCountry,
          destination,
          currency: countryCurrency(destination) ?? "",
          providers,
          knownFacts,
        });
      } catch {
        return; // offline or the server went away: stop, do not claim progress
      }
      const today = new Date().toISOString().slice(0, 10);
      const learned: LearnedFact[] = [];
      for (const t of reply.terms) {
        const asOfFigure = t.checkedAt && /^\d{4}-\d{2}-\d{2}$/.test(t.checkedAt) ? t.checkedAt : today;
        const put = (key: string, value: number | undefined) => {
          if (value === undefined) return;
          learned.push(makeFact({ agent: TRAVEL_AGENT, subject: t.provider, key, value: String(value), source: "agent", updatedAt: asOfFigure, note: t.note }));
        };
        put("fxFeePct", t.fxFeePct);
        put("convertFeePct", t.convertFeePct);
        put("cashbackPct", t.cashbackPct);
        put("pointsPerEuro", t.pointsPerEuro);
        put("transferFreeViaIdeal", t.transferFreeViaIdeal);
      }
      if (learned.length > 0) await saveFacts(learned);
      setPendingTerms(reply.pending);
      if (reply.pending.length === 0) return;
    }
    setTermsGaveUp(true);
  }

  async function handleRefreshTravelTerms(destination: string) {
    // He may have added the key since this tab loaded. Ask again before telling
    // him it cannot be done.
    await recheckLlm();
    setBusy(true);
    try {
      const plan = planTravel({ accounts, txs, rates: rates.rates, facts, destination, asOf });
      // Ask about EVERY provider, not just the ones with no figure yet — the
      // server holds the freshness clock, and only asking about unknowns meant
      // a fee, once learned, could never be refreshed again. Corrections are
      // still safe: upsertFacts never lets an agent overwrite a user fact.
      const providers = plan.spend.map((o) => o.provider).filter(Boolean);
      if (providers.length === 0) return;
      const today = new Date().toISOString().slice(0, 10);
      // Send what he corrected so the model is told not to contradict it.
      const knownFacts = facts
        .filter((f) => f.source === "user" && f.agent === TRAVEL_AGENT)
        .map((f) => ({ subject: f.subject, key: f.key, value: f.value }));

      // One fast call: the server answers from its shared cache of PUBLIC card
      // tariffs and starts background lookups for whatever it doesn't have yet.
      // Nothing here waits on the model, so the button never hangs — a gap just
      // means "press it again in a minute".
      const { terms, pending } = await travelFacts({
        homeCountry,
        destination,
        currency: countryCurrency(destination) ?? "",
        providers,
        knownFacts,
      });

      const learned: LearnedFact[] = [];
      for (const t of terms) {
        // Date the figure by WHEN IT WAS TRUE, not when we happened to receive
        // it. A comparison table states its own last-checked date (bank.nl says
        // 2026-01-15); stamping that as "today" would tell him a seven-month-old
        // koersopslag was found this morning — the same lie the precedence
        // ladder was just fixed to stop believing. No stated date means an agent
        // lookup, which is as of now.
        const asOfFigure = t.checkedAt && /^\d{4}-\d{2}-\d{2}$/.test(t.checkedAt) ? t.checkedAt : today;
        const put = (key: string, value: number | undefined) => {
          if (value === undefined) return; // unverified stays unknown, never 0
          learned.push(makeFact({ agent: TRAVEL_AGENT, subject: t.provider, key, value: String(value), source: "agent", updatedAt: asOfFigure, note: t.note }));
        };
        put("fxFeePct", t.fxFeePct);
        put("convertFeePct", t.convertFeePct);
        put("cashbackPct", t.cashbackPct);
        put("pointsPerEuro", t.pointsPerEuro);
        put("transferFreeViaIdeal", t.transferFreeViaIdeal);
      }
      if (learned.length > 0) await saveFacts(learned);

      setPendingTerms(pending);
      setTermsAsked(providers.length);
      setTermsGaveUp(false);
      // The HTTP call is done in ~200ms; the LOOKUPS keep running on the server
      // for 40s to a few minutes. Tracking the request left the screen still
      // while the real work was happening, which is exactly what made him guess
      // whether anything was working. So poll the cheap cached endpoint until
      // the pending list drains, and stop rather than spin forever.
      // A LOOKUP IN PROGRESS IS NOT A PROBLEM. This used to push the pending list
      // into setProblems, which is the page-wide warning channel — so a yellow
      // banner about the reisblok followed him onto Rekeningen and Valuta, where
      // it meant nothing. He called it ugly and he is right: the banner is for
      // things that need him, and waiting does not.
      //
      // The reisblok carries its own searching state (a spinner, and a sentence
      // when a lookup comes back empty), which is where progress belongs — next
      // to the thing being looked up.
      if (pending.length > 0) void pollTravelTerms(destination, providers, knownFacts);
    } catch (err) {
      setProblems([`Voorwaarden opzoeken mislukt: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setBusy(false);
    }
  }

  // Until the vault is unlocked/set up/migrated, render only the gate — never
  // the app shell (whose data-reads would throw against a locked/empty vault).
  if (gate !== "ready") {
    return (
      <VaultGate
        gate={gate}
        storage={storage}
        onReady={() => setGate("ready")}
        onBackup={() => {
          setGate("ready");
          setView("backup");
        }}
      />
    );
  }

  return (
    <div className="shell">
      <NavBar view={view} modules={navModules(modules)} onNavigate={setView} onOpenProfile={() => setView("profiel")} />

      <div className="shell-body">
        <TopBar view={view} scope={scope} onScopeChange={handleScopeChange} onAddWidget={handleAddWidget} />

        <main className="content">
          {/* Import moved into the profile, so import/bank-link messages would
              otherwise only be visible on that page. They are the outcome of
              something the user just did (a file import, a bank return), so
              they follow him: the profile's own Import block shows them there,
              this banner shows them anywhere else. */}
          {problems.length > 0 && view !== "profiel" && (
            <p role="alert" className="text-warn shell-problems">
              {problems.join(", ")}
            </p>
          )}

          {/* An entity with no classification counts as Persoonlijk, so on a
              vault where nothing has been classified yet, Zakelijk is empty.
              Empty is a legitimate answer, but an empty app reads as a broken
              one — say which it is, and where to fix it. */}
          {scopedAccounts.length === 0 && accounts.length > 0 && view !== "profiel" && (
            <p className="text-muted shell-problems">
              Geen rekeningen staan als <strong>{SCOPE_LABELS[scope]}</strong> ingesteld — daarom is dit
              scherm leeg. Zet dat per rekening bij{" "}
              <button type="button" className="card-link" onClick={() => setView("accounts")}>
                Rekeningen
              </button>
              .
            </p>
          )}

          {view === "overview" && (
            <Overzicht
              accounts={currentScopedAccounts}
              txs={scopedTxs}
              rules={rules}
              own={own}
              asOf={asOf}
              bufferCents={bufferCents}
              scheduledFlows={scopedScheduledFlows}
              onBufferChange={handleBufferChange}
              onNavigate={setView}
              travel={{
                accounts: scopedAccounts,
                txs: scopedTxs,
                rates: rates.rates,
                facts,
                asOf,
                homeCountry,
                busy,
                aiAvailable: llmConfigured,
                onRefreshTerms: handleRefreshTravelTerms,
                pendingTerms,
                termsAsked,
                termsGaveUp,
                onRecheckAi: () => void recheckLlm(),
                onCorrectFact: (fact) => void saveFacts([fact]),
              }}
              onSelectCategory={(c) => {
                // Match exactly what the Per-categorie totals showed: only the
                // category filter (plus any active top-bar entity scope); clear
                // the per-view filters so the list isn't silently over-narrowed.
                setFCategory(c);
                setFEntity("");
                setFAccount("");
                setFSearch("");
                setFFrom("");
                setFTo("");
                setView("transactions");
              }}
            />
          )}

          {view === "transactions" && (
            <Transacties
              accounts={scopedAccounts}
              scopedTxs={scopedTxs}
              rules={rules}
              own={own}
              entityOptions={entityOptions}
              entityScope={entityScope}
              fEntity={fEntity}
              onFEntityChange={setFEntity}
              fAccount={fAccount}
              onFAccountChange={setFAccount}
              fSearch={fSearch}
              onFSearchChange={setFSearch}
              fFrom={fFrom}
              onFFromChange={setFFrom}
              fTo={fTo}
              onFToChange={setFTo}
              fCategory={fCategory}
              onFCategoryChange={setFCategory}
              configured={llmConfigured}
              onApplyCategories={handleApplyCategories}
            />
          )}

          {view === "accounts" && (
            <Rekeningen
              accounts={scopedAccounts}
              txs={scopedTxs}
              busy={busy}
              onEntityChange={handleEntityChange}
              onAccountCommit={handleAccountCommit}
              onAccountFieldChange={handleAccountFieldChange}
              onSaldoCommit={handleSaldoCommit}
              onTypeCommit={handleTypeCommit}
              onDeleteAccount={handleDeleteAccount}
              duplicateGroups={duplicateGroups}
              onMergeDuplicates={handleMergeDuplicates}
              onSelectAccount={(key) => {
                // Show just this account's transactions — clear the other
                // filters so the list isn't silently narrowed by a stale one.
                setFAccount(key);
                setFEntity("");
                setFSearch("");
                setFCategory("");
                setFFrom("");
                setFTo("");
                setView("transactions");
              }}
            />
          )}

          {view === "forecast" && (
            <Forecast txs={scopedTxs} accounts={currentScopedAccounts} entityScope={entityScope} asOf={asOf} bufferCents={bufferCents} scheduledFlows={scopedScheduledFlows} />
          )}

          {view === "optimalisatie" && (
            <Optimalisatie
              txs={scopedTxs}
              accounts={currentScopedAccounts}
              rules={rules}
              own={own}
              asOf={asOf}
              busy={busy}
              facts={facts}
              onRateCommit={handleRateCommit}
            />
          )}

          {/* Scoped like every other view: standing in Zakelijk and being offered a
              conversion out of a personal account is a leak across the very line
              the switch exists to draw. */}
          {view === "valuta" && <Valuta accounts={scopedAccounts} />}

          {view === "belasting" && (
            <Belasting
              entities={entityScope ? [entityScope] : entityOptions}
              txs={scopedTxs}
              accounts={scopedAccounts}
              asOf={asOf}
              vatSettings={vatSettings}
              scheduledFlows={scopedScheduledFlows}
              invoices={invoices}
              busy={busy}
              onSaveVatSettings={saveVatSettings}
              onSaveScheduledFlows={saveScheduledFlows}
            />
          )}

          {view === "facturen" && (
            <Facturen
              entities={entityOptions}
              invoices={invoices}
              txs={txs}
              asOf={asOf}
              busy={busy}
              defaultEntity={entity}
              onSaveInvoices={saveInvoices}
              pending={pendingInvoices}
              onPendingChange={setPendingInvoices}
              notices={pendingNotices}
              onNoticesChange={setPendingNotices}
              onNavigate={setView}
            />
          )}

          {view === "punten" && <Punten balances={rewards} asOf={asOf} busy={busy} onSave={saveRewards} />}

          {view === "koppelingen" && <Koppelingen />}

          {view === "backup" && <Backup storage={storage} asOf={asOf} onRestored={handleRestored} />}

          {view === "profiel" && (
            <Profiel
              enabledModules={modules}
              onModulesChange={handleModulesChange}
              focusModules={addWidget}
              entities={entitySummaryRows}
              onClassifyEntity={handleClassifyEntity}
              homeCountry={homeCountry}
              onHomeCountryChange={handleHomeCountryChange}
              homeRegion={homeRegion}
              onHomeRegionChange={handleHomeRegionChange}
              ownerName={ownerName}
              onOwnerNameChange={handleOwnerNameChange}
              onLock={handleLock}
              entity={entity}
              onEntityChange={setEntity}
              busy={busy}
              problems={problems}
              onImport={handleImport}
              rules={rules}
              ruleMatch={ruleMatch}
              onRuleMatchChange={setRuleMatch}
              ruleCategory={ruleCategory}
              onRuleCategoryChange={setRuleCategory}
              onSaveRules={saveRules}
              storage={storage}
              asOf={asOf}
              onRestored={handleRestored}
            />
          )}
        </main>
      </div>
    </div>
  );
}
