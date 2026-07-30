import { useEffect, useMemo, useState } from "react";
import type { Account, Tx } from "@lavega/core";
import { ingest, consolidate } from "@lavega/core";
import { createFileImport, createIndexedDbStorage } from "@lavega/adapters";

// Single storage instance for the app's lifetime; putAccounts/putTxs upsert
// (keyPath "key" / "id"), so re-importing the same account/tx is safe.
const storage = createIndexedDbStorage();

function formatEuro(n: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
}

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [entity, setEntity] = useState("BV1");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>LaVega</h1>

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
          accept=".csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleImport(file);
          }}
        />
        {problems.length > 0 && <p role="alert">{problems.join(", ")}</p>}
      </section>

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
    </main>
  );
}
