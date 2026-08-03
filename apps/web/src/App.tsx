import { useEffect, useMemo, useState } from "react";
import type { Account, Rule, Tx } from "@lavega/core";
import { ingest, reassignEntity, withCurrentBalances } from "@lavega/core";
import { createFileImport, createEncryptedStorage } from "@lavega/adapters";
import { gateState } from "./vault-gate.js";
import type { GateState } from "./vault-gate.js";
import { hasLegacyData } from "./migrate.js";
import VaultGate from "./components/VaultGate";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Overzicht from "./views/Overzicht";
import Transacties from "./views/Transacties";
import Rekeningen from "./views/Rekeningen";
import Regels from "./views/Regels";
import Import from "./views/Import";
import Forecast from "./views/Forecast";
import Backup from "./views/Backup";

// Single storage instance for the app's lifetime; putAccounts/putTxs upsert
// (keyPath "key" / "id"), so re-importing the same account/tx is safe. Data is
// at rest only in the encrypted vault — the app never touches the legacy
// plaintext `lavega` DB directly (that's migrate.ts's job, once, at setup).
const storage = createEncryptedStorage();

export type View = "overview" | "transactions" | "accounts" | "rules" | "forecast" | "backup";

export default function App() {
  const [gate, setGate] = useState<GateState>("loading");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [entity, setEntity] = useState("BV1");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);

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
  const [ruleMatch, setRuleMatch] = useState("");
  const [ruleCategory, setRuleCategory] = useState("");

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
      const [loadedAccounts, loadedTxs, loadedRules] = await Promise.all([
        storage.getAccounts(),
        storage.getTxs(),
        storage.getRules(),
      ]);
      setAccounts(loadedAccounts);
      setTxs(loadedTxs);
      setRules(loadedRules);
    })();
  }, [gate]);

  // Sidebar "Vergrendel": drop the derived key + in-memory data (nothing
  // sensitive stays rendered) and show the unlock screen again.
  function handleLock() {
    storage.lock();
    setAccounts([]);
    setTxs([]);
    setRules([]);
    setGate("unlock");
  }

  // Rules are UI-owned as a whole list (replace-all persistence), so every
  // add/remove goes through this single helper to keep state and storage in sync.
  async function saveRules(next: Rule[]) {
    setRules(next);
    await storage.putRules(next);
  }

  // After storage.restore() swaps in a different vault's data (Task 5), reload
  // everything from it — restore() itself only touches storage, never React state.
  async function handleRestored() {
    const [freshAccounts, freshTxs, freshRules] = await Promise.all([
      storage.getAccounts(),
      storage.getTxs(),
      storage.getRules(),
    ]);
    setAccounts(freshAccounts);
    setTxs(freshTxs);
    setRules(freshRules);
  }

  const entityOptions = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0))),
    [accounts],
  );

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

  // The single data path: FileImport -> ingest -> persist -> reload -> consolidate.
  async function handleImport(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const result = await createFileImport().load({ filename: file.name, text, entity });
      setProblems(result.problems);

      const mergedTxs = ingest(txs, result.txs);
      await storage.putAccounts(result.accounts);
      await storage.putTxs(mergedTxs);

      const [freshAccounts, freshTxs] = await Promise.all([
        storage.getAccounts(),
        storage.getTxs(),
      ]);
      setAccounts(freshAccounts);
      setTxs(freshTxs);
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
    const balance = trimmed === "" ? null : Number(trimmed);
    if (balance !== null && !Number.isFinite(balance)) return; // ignore garbage input
    const balanceDate = balance === null ? undefined : asOf;
    const next = accounts.map((a) => (a.key === key ? { ...a, balance, balanceDate } : a));
    setAccounts(next);
    const changed = next.find((a) => a.key === key);
    if (changed) await storage.putAccounts([changed]);
  }

  function scrollToImport() {
    document.getElementById("import")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      <Sidebar view={view} onNavigate={setView} onImportClick={scrollToImport} onLock={handleLock} />

      <div className="shell-body">
        <TopBar
          view={view}
          entityScope={entityScope}
          onEntityScopeChange={setEntityScope}
          entityOptions={entityOptions}
        />

        <main className="content">
          <Import
            entity={entity}
            onEntityChange={setEntity}
            busy={busy}
            problems={problems}
            onImport={handleImport}
          />

          {view === "overview" && (
            <Overzicht accounts={currentScopedAccounts} txs={scopedTxs} rules={rules} asOf={asOf} onNavigate={setView} />
          )}

          {view === "transactions" && (
            <Transacties
              accounts={scopedAccounts}
              scopedTxs={scopedTxs}
              rules={rules}
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
            <Forecast txs={scopedTxs} accounts={currentScopedAccounts} entityScope={entityScope} asOf={asOf} />
          )}

          {view === "backup" && <Backup storage={storage} asOf={asOf} onRestored={handleRestored} />}
        </main>
      </div>
    </div>
  );
}
