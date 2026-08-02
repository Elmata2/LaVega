import { useEffect, useMemo, useState } from "react";
import type { Account, Rule, Tx } from "@lavega/core";
import { ingest, reassignEntity } from "@lavega/core";
import { createFileImport, createIndexedDbStorage } from "@lavega/adapters";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Overzicht from "./views/Overzicht";
import Transacties from "./views/Transacties";
import Rekeningen from "./views/Rekeningen";
import Regels from "./views/Regels";
import Import from "./views/Import";

// Single storage instance for the app's lifetime; putAccounts/putTxs upsert
// (keyPath "key" / "id"), so re-importing the same account/tx is safe.
const storage = createIndexedDbStorage();

export type View = "overview" | "transactions" | "accounts" | "rules" | "forecast";

export default function App() {
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

  // Load persisted data on mount so a reload shows prior imports.
  useEffect(() => {
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
  }, []);

  // Rules are UI-owned as a whole list (replace-all persistence), so every
  // add/remove goes through this single helper to keep state and storage in sync.
  async function saveRules(next: Rule[]) {
    setRules(next);
    await storage.putRules(next);
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
    if (fEntity && !entityOptions.includes(fEntity)) setFEntity("");
    if (entityScope && !entityOptions.includes(entityScope)) setEntityScope("");
  }, [entityOptions, fEntity, entityScope]);

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

  function scrollToImport() {
    document.getElementById("import")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="shell">
      <Sidebar view={view} onNavigate={setView} onImportClick={scrollToImport} />

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
            <Overzicht accounts={scopedAccounts} txs={scopedTxs} asOf={asOf} onNavigate={setView} />
          )}

          {view === "transactions" && (
            <Transacties
              accounts={accounts}
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
            <section className="card" aria-label="Forecast">
              <h2>Forecast</h2>
              <p>Binnenkort.</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
