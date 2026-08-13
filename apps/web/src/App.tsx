import { useEffect, useMemo, useState } from "react";
import type { Account, Rule, Tx, ScheduledFlow, VatSettings, Invoice, RewardsBalance, LearnedFact } from "@lavega/core";
import { ingest, reassignEntity, withCurrentBalances, isCardAccount, mergeImportedAccounts, ownAccounts, assignTxIds, scheduledFlowsForScope, scheduledInvoiceFlows, reconcileInvoices, applyCategorizations, findDuplicateAccounts, mergeAccounts, upsertFacts, makeFact, planTravel, countryCurrency, TRAVEL_AGENT, NL_SAVINGS_RATES, RATES_AS_OF } from "@lavega/core";
import type { CategoryDecision } from "@lavega/core";
import { createFileImport, createEncryptedStorage, mapEbAccount, pickEbBalance, mapEbTransaction, ebAccountKey, createRatesProvider, type RatesResult } from "@lavega/adapters";
import { API_BASE } from "./api.js";
import { gateState } from "./vault-gate.js";
import type { GateState } from "./vault-gate.js";
import { hasLegacyData } from "./migrate.js";
import { getBufferCents, setBufferCents, getHomeCountry } from "./settings.js";
import { txIdsForAccount, txDiff } from "./accountActions.js";
import { travelFacts } from "./api.js";
import TravelBlock from "./components/TravelBlock";
import { buildTabContext } from "./agent/tabContext.js";
import VaultGate from "./components/VaultGate";
import ChatWidget from "./components/ChatWidget";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Overzicht from "./views/Overzicht";
import Transacties from "./views/Transacties";
import Rekeningen from "./views/Rekeningen";
import Regels from "./views/Regels";
import Import from "./views/Import";
import Forecast from "./views/Forecast";
import Optimalisatie from "./views/Optimalisatie";
import Valuta from "./views/Valuta";
import Belasting from "./views/Belasting";
import Facturen from "./views/Facturen";
import Punten from "./views/Punten";
import Backup from "./views/Backup";

// Single storage instance for the app's lifetime; putAccounts/putTxs upsert
// (keyPath "key" / "id"), so re-importing the same account/tx is safe. Data is
// at rest only in the encrypted vault — the app never touches the legacy
// plaintext `lavega` DB directly (that's migrate.ts's job, once, at setup).
const storage = createEncryptedStorage();

// Public savings-rate benchmark (same source Optimalisatie uses).
const RATES_URL: string | undefined =
  import.meta.env.VITE_RATES_URL ?? (import.meta.env.DEV ? "http://localhost:8787/api/rates" : undefined);

export type View = "overview" | "transactions" | "accounts" | "rules" | "forecast" | "optimalisatie" | "valuta" | "belasting" | "facturen" | "punten" | "backup";

export default function App() {
  const [gate, setGate] = useState<GateState>("loading");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [entity, setEntity] = useState("BV1");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [scheduledFlows, setScheduledFlows] = useState<ScheduledFlow[]>([]);
  const [vatSettings, setVatSettings] = useState<VatSettings[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [rewards, setRewards] = useState<RewardsBalance[]>([]);
  // What the agents have learned (and what he corrected). Lives in the vault.
  const [facts, setFacts] = useState<LearnedFact[]>([]);
  // Public savings benchmark for the travel block's "where to keep it" step.
  // Same provider Optimalisatie uses (localStorage-cached), so no double fetch
  // cost; falls back to the bundled snapshot when the rates server is down.
  const [rates, setRates] = useState<RatesResult>({ rates: [...NL_SAVINGS_RATES], asOf: RATES_AS_OF, source: "bundled" });
  const [aiAvailable, setAiAvailable] = useState(false);
  const homeCountry = getHomeCountry();
  // Whether the server has an ANTHROPIC_API_KEY (drives the chat widget's
  // "not configured" state). Fetched once; defaults false on any error.
  const [llmConfigured, setLlmConfigured] = useState(false);
  // A question pushed into the chat widget from elsewhere (e.g. the per-category
  // "vs. gemiddelde" button). The nonce re-triggers even for the same text.
  const [askText, setAskText] = useState<string | null>(null);
  const [askNonce, setAskNonce] = useState(0);
  function askAssistant(text: string) {
    setAskText(text);
    setAskNonce((n) => n + 1);
  }

  const [view, setView] = useState<View>("overview");
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
      const [loadedAccounts, loadedTxs, loadedRules, loadedFlows, loadedVat, loadedInvoices, loadedRewards, loadedFacts] = await Promise.all([
        storage.getAccounts(),
        storage.getTxs(),
        storage.getRules(),
        storage.getScheduledFlows(),
        storage.getVatSettings(),
        storage.getInvoices(),
        storage.getRewards(),
        storage.getFacts(),
      ]);
      setAccounts(loadedAccounts);
      setTxs(loadedTxs);
      setRules(loadedRules);
      setScheduledFlows(loadedFlows);
      setVatSettings(loadedVat);
      setInvoices(loadedInvoices);
      setRewards(loadedRewards);
      setFacts(loadedFacts);
    })();
  }, [gate]);

  // Public rate benchmark + whether the server has an API key. Both are public
  // facts about the environment, not user data, so they load once at startup and
  // failing is harmless (bundled rates / no AI actions offered).
  useEffect(() => {
    let alive = true;
    createRatesProvider({ url: RATES_URL })
      .getRates()
      .then((r) => alive && setRates(r))
      .catch(() => {});
    fetch(`${API_BASE}/api/agent/status`)
      .then((r) => r.json())
      .then((s) => alive && setAiAvailable(Boolean((s as { configured?: boolean }).configured)))
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
          const acc = mapEbAccount({ ...item.account, aspsp }, pickEbBalance(item.balances));
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
    setGate("unlock");
  }

  // Rules are UI-owned as a whole list (replace-all persistence), so every
  // add/remove goes through this single helper to keep state and storage in sync.
  async function saveRules(next: Rule[]) {
    setRules(next);
    await storage.putRules(next);
  }

  // Scheduled flows (incl. VAT set-asides) and per-BV VAT settings are UI-owned
  // as whole lists (replace-all persistence), same pattern as saveRules.
  async function saveScheduledFlows(next: ScheduledFlow[]) {
    setScheduledFlows(next);
    await storage.putScheduledFlows(next);
  }
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
    const [freshAccounts, freshTxs, freshRules, freshFlows, freshVat, freshInvoices, freshRewards] = await Promise.all([
      storage.getAccounts(),
      storage.getTxs(),
      storage.getRules(),
      storage.getScheduledFlows(),
      storage.getVatSettings(),
      storage.getInvoices(),
      storage.getRewards(),
    ]);
    setAccounts(freshAccounts);
    setTxs(freshTxs);
    setRules(freshRules);
    setScheduledFlows(freshFlows);
    setVatSettings(freshVat);
    setInvoices(freshInvoices);
    setRewards(freshRewards);
  }

  const entityOptions = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0))),
    [accounts],
  );

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

  // entityScope ("" = Alle bedrijven) pre-filters the accounts/txs every view
  // derives from; each view's own filters (fEntity, fAccount, search, ...)
  // still apply on top of this scope.
  const scopedAccounts = useMemo(
    () => (entityScope ? accounts.filter((a) => a.entity === entityScope) : accounts),
    [accounts, entityScope],
  );
  const scopedTxs = useMemo(() => {
    if (!entityScope) return txs;
    const scopedKeys = new Set(scopedAccounts.map((a) => a.key));
    return txs.filter((t) => scopedKeys.has(t.accountKey));
  }, [txs, entityScope, scopedAccounts]);

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
  const allScheduledFlows = useMemo(
    () => [...scheduledFlows, ...scheduledInvoiceFlows(invoices)],
    [scheduledFlows, invoices],
  );
  // Scheduled flows constrained to the active top-bar scope so Overzicht/Forecast
  // only see the reservations/invoices for the entity in view ("" = all).
  const scopedScheduledFlows = useMemo(
    () => scheduledFlowsForScope(allScheduledFlows, entityScope),
    [allScheduledFlows, entityScope],
  );

  // Minimal per-tab context for the chat widget. Passes everything already in
  // App scope that a tab's slice needs (scoped accounts/txs/flows, config,
  // buffer, asOf) — buildTabContext derives the aggregate/summary each tab is
  // allowed to send and drops raw txs. No extra network fetches: the live ECB
  // rate (valuta) and public savings benchmark (optimalisatie) aren't in scope
  // here, so those are omitted and the agent web-searches them.
  const chatCtx = useMemo(
    () =>
      buildTabContext(view, {
        accounts: currentScopedAccounts,
        txs: scopedTxs,
        rules,
        invoices,
        rewards,
        vatSettings,
        scheduledFlows: scopedScheduledFlows,
        bufferCents,
        asOf,
      }),
    [view, currentScopedAccounts, scopedTxs, rules, invoices, rewards, vatSettings, scopedScheduledFlows, bufferCents, asOf],
  );

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
  async function handleEntityCommit(account: Account) {
    await storage.putAccounts([account]);
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
  async function handleRefreshTravelTerms(destination: string) {
    setBusy(true);
    try {
      const plan = planTravel({ accounts, txs, rates: rates.rates, facts, destination, asOf });
      const providers = plan.unknownProviders;
      if (providers.length === 0) return;
      const today = new Date().toISOString().slice(0, 10);
      // Send what he corrected so the model is told not to contradict it.
      const knownFacts = facts
        .filter((f) => f.source === "user" && f.agent === TRAVEL_AGENT)
        .map((f) => ({ subject: f.subject, key: f.key, value: f.value }));

      // ONE PROVIDER PER REQUEST. The agent web-searches before it answers, so a
      // batch of four would be one multi-minute request that loses everything on
      // a timeout. Looking them up one at a time keeps each request short and
      // persists what already succeeded, so progress appears as it arrives.
      let learnedAny = false;
      let carried = facts;
      const failed: string[] = [];
      for (const provider of providers) {
        try {
          const terms = await travelFacts({
            homeCountry,
            destination,
            currency: countryCurrency(destination) ?? "",
            providers: [provider],
            knownFacts,
          });
          const learned: LearnedFact[] = [];
          for (const t of terms) {
            const put = (key: string, value: number | undefined) => {
              if (value === undefined) return; // unverified stays unknown, never 0
              learned.push(makeFact({ agent: TRAVEL_AGENT, subject: t.provider, key, value: String(value), source: "agent", updatedAt: today, note: t.note }));
            };
            put("fxFeePct", t.fxFeePct);
            put("cashbackPct", t.cashbackPct);
            put("pointsPerEuro", t.pointsPerEuro);
            put("transferFreeViaIdeal", t.transferFreeViaIdeal);
          }
          if (learned.length > 0) {
            carried = upsertFacts(carried, learned); // keep the merge rule intact
            setFacts(carried);
            await storage.putFacts(carried);
            learnedAny = true;
          } else {
            failed.push(provider);
          }
        } catch {
          failed.push(provider); // one provider failing must not sink the rest
        }
      }
      if (failed.length > 0) {
        setProblems([
          `Geen voorwaarden gevonden voor ${failed.join(", ")}${learnedAny ? " — de rest is wel bijgewerkt" : ""}. Je kunt ze zelf invullen met "aanpassen".`,
        ]);
      }
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
      <Sidebar view={view} onNavigate={setView} onLock={handleLock} />

      <div className="shell-body">
        <TopBar
          view={view}
          entityScope={entityScope}
          onEntityScopeChange={setEntityScope}
          entityOptions={entityOptions}
        />

        <main className="content">
          {view === "overview" && (
            <Import
              entity={entity}
              onEntityChange={setEntity}
              busy={busy}
              problems={problems}
              onImport={handleImport}
            />
          )}

          {view === "overview" && (
            <TravelBlock
              accounts={scopedAccounts}
              txs={scopedTxs}
              rates={rates.rates}
              facts={facts}
              asOf={asOf}
              homeCountry={homeCountry}
              busy={busy}
              aiAvailable={aiAvailable}
              onRefreshTerms={handleRefreshTravelTerms}
              onCorrectFact={(fact) => void saveFacts([fact])}
            />
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
              onAsk={askAssistant}
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
              onEntityCommit={handleEntityCommit}
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

          {view === "rules" && (
            <Regels
              rules={rules}
              busy={busy}
              ruleMatch={ruleMatch}
              onRuleMatchChange={setRuleMatch}
              ruleCategory={ruleCategory}
              onRuleCategoryChange={setRuleCategory}
              onSaveRules={saveRules}
            />
          )}

          {view === "forecast" && (
            <Forecast txs={scopedTxs} accounts={currentScopedAccounts} entityScope={entityScope} asOf={asOf} bufferCents={bufferCents} scheduledFlows={scopedScheduledFlows} />
          )}

          {view === "optimalisatie" && (
            <Optimalisatie
              txs={scopedTxs}
              accounts={currentScopedAccounts}
              asOf={asOf}
              busy={busy}
              onRateCommit={handleRateCommit}
            />
          )}

          {view === "valuta" && <Valuta accounts={accounts} />}

          {view === "belasting" && (
            <Belasting
              entities={entityScope ? [entityScope] : entityOptions}
              txs={scopedTxs}
              accounts={scopedAccounts}
              asOf={asOf}
              vatSettings={vatSettings}
              scheduledFlows={scheduledFlows}
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
            />
          )}

          {view === "punten" && <Punten balances={rewards} asOf={asOf} busy={busy} onSave={saveRewards} />}

          {view === "backup" && <Backup storage={storage} asOf={asOf} onRestored={handleRestored} />}
        </main>

        <ChatWidget view={view} context={chatCtx} configured={llmConfigured} prompt={askText} promptNonce={askNonce} />
      </div>
    </div>
  );
}
