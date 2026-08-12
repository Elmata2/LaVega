import { useMemo, useState } from "react";
import type { Account, OwnAccounts, Rule, Tx, CategoryDecision } from "@lavega/core";
import { enrichTxs, filterTxs, categorize, uncategorizedTxs, CATEGORY_OPTIONS } from "@lavega/core";
import { formatEuro } from "../format";
import { categorizeTxs } from "../api";
import { getAiCategorizeEnabled, setAiCategorizeEnabled } from "../settings";
import { buildCategorizeItems, toDecisions, MAX_CATEGORIZE_BATCH } from "../categorize-ui";

type TransactiesProps = {
  accounts: Account[];
  scopedTxs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  entityOptions: string[];
  entityScope: string;
  fEntity: string;
  onFEntityChange: (entity: string) => void;
  fAccount: string;
  onFAccountChange: (accountKey: string) => void;
  fSearch: string;
  onFSearchChange: (search: string) => void;
  fFrom: string;
  onFFromChange: (from: string) => void;
  fTo: string;
  onFToChange: (to: string) => void;
  fCategory: string;
  onFCategoryChange: (category: string) => void;
  /** Whether the server has an Anthropic key — gates the "Categoriseer met AI"
   *  button. When false the button is hidden entirely. */
  configured: boolean;
  /** Apply confirmed AI-category decisions against the full tx + rules lists
   *  (App owns that + persistence). */
  onApplyCategories: (decisions: CategoryDecision[]) => Promise<void>;
};

export default function Transacties({
  accounts,
  scopedTxs,
  rules,
  own,
  entityOptions,
  entityScope,
  fEntity,
  onFEntityChange,
  fAccount,
  onFAccountChange,
  fSearch,
  onFSearchChange,
  fFrom,
  onFFromChange,
  fTo,
  onFToChange,
  fCategory,
  onFCategoryChange,
  configured,
  onApplyCategories,
}: TransactiesProps) {
  // Rows after the non-category filters — the category dropdown's options are
  // derived from these, so it always offers the categories actually present
  // under the current entity/account/search/date selection.
  const filtered = useMemo(
    () =>
      filterTxs(enrichTxs(scopedTxs, accounts), {
        entity: fEntity || undefined,
        accountKey: fAccount || undefined,
        search: fSearch || undefined,
        from: fFrom || undefined,
        to: fTo || undefined,
      }),
    [scopedTxs, accounts, fEntity, fAccount, fSearch, fFrom, fTo],
  );

  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    for (const t of filtered) s.add(categorize(t, rules, own));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [filtered, rules, own]);

  const rows = useMemo(
    () =>
      (fCategory ? filtered.filter((t) => categorize(t, rules, own) === fCategory) : filtered)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [filtered, fCategory, rules, own],
  );

  // --- AI categorization (opt-in, confirm-first) --------------------------
  // The transactions the AI flow can offer: those still "onbekend" under the
  // current rules, within the active scope. Sliced to the server's batch cap.
  const onbekend = useMemo(
    () => uncategorizedTxs(scopedTxs, rules, own).slice(0, MAX_CATEGORIZE_BATCH),
    [scopedTxs, rules, own],
  );
  const [aiEnabled, setAiEnabled] = useState<boolean>(() => getAiCategorizeEnabled());
  // idle → (consent) → loading → review → idle. `consent` only appears the
  // first time, before the owner opts in.
  const [aiPhase, setAiPhase] = useState<"idle" | "consent" | "loading" | "review">("idle");
  const [proposals, setProposals] = useState<{ tx: Tx; category: string }[]>([]);
  const [aiNote, setAiNote] = useState<string | null>(null);

  async function runAiCategorize() {
    setAiNote(null);
    setAiPhase("loading");
    try {
      const results = await categorizeTxs(buildCategorizeItems(onbekend));
      const byId = new Map(results.map((r) => [r.id, r.category]));
      // Only surface txs the model could place; the owner reviews/edits/skips each.
      const proposed = onbekend
        .filter((t) => byId.has(t.id))
        .map((t) => ({ tx: t, category: byId.get(t.id)! }));
      if (proposed.length === 0) {
        setAiPhase("idle");
        setAiNote("De AI kon geen van de onbekende transacties indelen.");
        return;
      }
      setProposals(proposed);
      setAiPhase("review");
    } catch (e) {
      setAiPhase("idle");
      setAiNote(e instanceof Error ? e.message : "categorisatie mislukt");
    }
  }

  function onCategorizeClick() {
    if (aiEnabled) void runAiCategorize();
    else setAiPhase("consent");
  }

  function enableAndRun() {
    setAiCategorizeEnabled(true);
    setAiEnabled(true);
    void runAiCategorize();
  }

  async function applyReview() {
    const decisions = toDecisions(proposals.map((p) => ({ id: p.tx.id, category: p.category })));
    try {
      await onApplyCategories(decisions);
      setProposals([]);
      setAiPhase("idle");
      setAiNote(
        decisions.length > 0
          ? `${decisions.length} ${decisions.length === 1 ? "transactie" : "transacties"} gecategoriseerd.`
          : "Niets toegepast.",
      );
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : "opslaan mislukt");
    }
  }

  function cancelReview() {
    setProposals([]);
    setAiPhase("idle");
  }

  return (
    <section className="card" aria-label="Transacties">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Transacties</h2>
        {configured && onbekend.length > 0 && aiPhase === "idle" && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onCategorizeClick}
            aria-label="Categoriseer onbekende transacties met AI"
          >
            Categoriseer met AI ({onbekend.length})
          </button>
        )}
      </div>

      {aiNote && aiPhase === "idle" && <p className="cell-sub">{aiNote}</p>}

      {aiPhase === "consent" && (
        <div className="ai-extract" style={{ margin: "var(--sp-3) 0" }}>
          <p className="cell-sub">
            Alleen de <strong>tegenpartij + omschrijving</strong> en de richting (in/uit) van je
            onbekende transacties gaan via onze server naar Claude — nooit bedragen, saldi,
            rekeningnummers of datums. Je bekijkt en bevestigt elk voorstel voordat er iets
            verandert.
          </p>
          <button type="button" className="btn btn-primary" onClick={enableAndRun}>
            Aanzetten en categoriseren
          </button>{" "}
          <button type="button" className="btn" onClick={() => setAiPhase("idle")}>
            Annuleer
          </button>
        </div>
      )}

      {aiPhase === "loading" && <p className="cell-sub">Bezig met categoriseren…</p>}

      {aiPhase === "review" && (
        <div className="ai-extract" style={{ margin: "var(--sp-3) 0" }}>
          <p className="cell-sub">
            {proposals.length} voorstel{proposals.length === 1 ? "" : "len"} — pas aan of zet op
            "Sla over", en bevestig. Toegepaste categorieën worden ook als regel opgeslagen voor
            volgende imports.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tegenpartij</th>
                  <th>Omschrijving</th>
                  <th>Bedrag</th>
                  <th>Categorie</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p, i) => (
                  <tr key={p.tx.id}>
                    <td>{p.tx.counterparty}</td>
                    <td>{p.tx.description}</td>
                    <td>
                      <span className={p.tx.amount >= 0 ? "text-pos" : "text-neg"}>
                        {formatEuro(p.tx.amount)}
                      </span>
                    </td>
                    <td>
                      <select
                        value={p.category}
                        aria-label={`Categorie voor ${p.tx.counterparty}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          setProposals((prev) => prev.map((q, j) => (j === i ? { ...q, category: v } : q)));
                        }}
                      >
                        <option value="">Sla over</option>
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void applyReview()}>
            Toepassen
          </button>{" "}
          <button type="button" className="btn" onClick={cancelReview}>
            Annuleer
          </button>
        </div>
      )}
      {/* Task-1 scope fix: with a top-bar entity scope active, this dropdown
          used to list ALL entities — picking an out-of-scope one silently
          yielded 0 rows with no explanation. The scope pill already constrains
          to that entity, so hide this filter while scoped; show it only for
          "Alle bedrijven" (entityScope === ""). */}
      {entityScope === "" && (
        <label>
          Entiteit{" "}
          <select value={fEntity} onChange={(e) => onFEntityChange(e.target.value)}>
            <option value="">Alle entiteiten</option>
            {entityOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Rekening{" "}
        <select value={fAccount} onChange={(e) => onFAccountChange(e.target.value)}>
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
        Categorie{" "}
        <select value={fCategory} onChange={(e) => onFCategoryChange(e.target.value)}>
          <option value="">Alle categorieën</option>
          {/* Keep a selected category visible even if the other filters leave it
              with zero rows (so the dropdown reflects state, e.g. after a click
              from Overzicht + a scope change). */}
          {fCategory && !categoryOptions.includes(fCategory) && (
            <option value={fCategory}>{fCategory}</option>
          )}
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {" "}
      <label>
        Zoeken{" "}
        <input
          value={fSearch}
          onChange={(e) => onFSearchChange(e.target.value)}
          placeholder="Tegenpartij of omschrijving"
        />
      </label>
      {" "}
      <label>
        Van{" "}
        <input type="date" value={fFrom} onChange={(e) => onFFromChange(e.target.value)} />
      </label>
      {" "}
      <label>
        Tot{" "}
        <input type="date" value={fTo} onChange={(e) => onFToChange(e.target.value)} />
      </label>

      <p>{rows.length} transacties</p>

      {rows.length === 0 ? (
        <p>Geen transacties.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Tegenpartij</th>
                <th>Omschrijving</th>
                <th>Rekening</th>
                <th>Bedrag</th>
                <th>Entiteit</th>
                <th>Categorie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.counterparty}</td>
                  <td>{t.description}</td>
                  <td>{t.bank} · {t.accountKey}</td>
                  <td>
                    <span className={t.amount >= 0 ? "text-pos" : "text-neg"}>
                      {formatEuro(t.amount)}
                    </span>
                  </td>
                  <td>{t.entity}</td>
                  <td>{categorize(t, rules, own)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
