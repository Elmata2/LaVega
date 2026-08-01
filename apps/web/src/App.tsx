import { useEffect, useMemo, useState } from "react";
import type { Account, Tx } from "@lavega/core";
import { ingest, consolidate, enrichTxs, filterTxs } from "@lavega/core";
import { createFileImport, createIndexedDbStorage } from "@lavega/adapters";

// Single storage instance for the app's lifetime; putAccounts/putTxs upsert
// (keyPath "key" / "id"), so re-importing the same account/tx is safe.
const storage = createIndexedDbStorage();

function formatEuro(n: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
}

type View = "overview" | "transactions" | "accounts";

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [entity, setEntity] = useState("BV1");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const [view, setView] = useState<View>("overview");
  const [fEntity, setFEntity] = useState("");
  const [fAccount, setFAccount] = useState("");
  const [fSearch, setFSearch] = useState("");

  // Load persisted data on mount so a reload shows prior imports.
  useEffect(() => {
    (async () => {
      const [loadedAccounts, loadedTxs] = await Promise.all([
        storage.getAccounts(),
        storage.getTxs(),
      ]);
      setAccounts(loadedAccounts);
      setTxs(loadedTxs);
    })();
  }, []);

  const { byEntity, totalBalance } = useMemo(() => consolidate(accounts, txs), [accounts, txs]);

  const entityOptions = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0))),
    [accounts],
  );

  const rows = useMemo(
    () =>
      filterTxs(enrichTxs(txs, accounts), {
        entity: fEntity || undefined,
        accountKey: fAccount || undefined,
        search: fSearch || undefined,
      })
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [txs, accounts, fEntity, fAccount, fSearch],
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

  return (
    <main>
      <h1>LaVega</h1>

      <nav aria-label="Weergaven">
        <button
          type="button"
          onClick={() => setView("overview")}
          aria-current={view === "overview" ? "page" : undefined}
          disabled={view === "overview"}
        >
          Overzicht
        </button>{" "}
        <button
          type="button"
          onClick={() => setView("transactions")}
          aria-current={view === "transactions" ? "page" : undefined}
          disabled={view === "transactions"}
        >
          Transacties
        </button>{" "}
        <button
          type="button"
          onClick={() => setView("accounts")}
          aria-current={view === "accounts" ? "page" : undefined}
          disabled={view === "accounts"}
        >
          Rekeningen
        </button>
      </nav>

      <section aria-label="Importeren">
        <h2>Importeren</h2>
        <label>
          Entiteit{" "}
          <input
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            disabled={busy}
          />
        </label>
        {" "}
        <input
          type="file"
          accept=".csv,.sta,.txt,.940,.mt940,.swi"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleImport(file);
          }}
        />
        {problems.length > 0 && <p role="alert">{problems.join(", ")}</p>}
      </section>

      {view === "overview" && (
        <section aria-label="Overzicht">
          <h2>Overzicht</h2>
          <p>
            Totaalsaldo:{" "}
            <strong>{totalBalance === null ? "onbekend" : formatEuro(totalBalance)}</strong>
          </p>
          <table>
            <thead>
              <tr>
                <th>Entiteit</th>
                <th>In</th>
                <th>Uit</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byEntity).map(([name, b]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{formatEuro(b.in)}</td>
                  <td>{formatEuro(b.out)}</td>
                  <td>{b.balance === null ? "onbekend" : formatEuro(b.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {view === "transactions" && (
        <section aria-label="Transacties">
          <h2>Transacties</h2>
          <label>
            Entiteit{" "}
            <select value={fEntity} onChange={(e) => setFEntity(e.target.value)}>
              <option value="">Alle entiteiten</option>
              {entityOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          {" "}
          <label>
            Rekening{" "}
            <select value={fAccount} onChange={(e) => setFAccount(e.target.value)}>
              <option value="">Alle rekeningen</option>
              {accounts.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.bank} · {a.key}
                </option>
              ))}
            </select>
          </label>
          {" "}
          <label>
            Zoeken{" "}
            <input
              value={fSearch}
              onChange={(e) => setFSearch(e.target.value)}
              placeholder="Tegenpartij of omschrijving"
            />
          </label>

          <p>{rows.length} transacties</p>

          {rows.length === 0 ? (
            <p>Geen transacties.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Tegenpartij</th>
                  <th>Omschrijving</th>
                  <th>Rekening</th>
                  <th>Bedrag</th>
                  <th>Entiteit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td>{t.counterparty}</td>
                    <td>{t.description}</td>
                    <td>{t.bank} · {t.accountKey}</td>
                    <td style={{ color: t.amount >= 0 ? "green" : "crimson" }}>
                      {formatEuro(t.amount)}
                    </td>
                    <td>{t.entity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {view === "accounts" && (
        <section aria-label="Rekeningen">
          <h2>Rekeningen</h2>
          <p>Binnenkort.</p>
        </section>
      )}
    </main>
  );
}
