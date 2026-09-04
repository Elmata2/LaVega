import { useMemo, useState } from "react";
import type {
  Account,
  OwnAccounts,
  Rule,
  Tx,
  CategoryDecision,
  UnknownReason,
  AiCategorizeItem,
} from "@lavega/core";
import {
  enrichTxs,
  filterTxs,
  categorize,
  uncategorizedByMonth,
  CATEGORY_OPTIONS,
  unknownBreakdown,
  unknownReason,
  foreignCode,
  aiCategorizeItems,
} from "@lavega/core";
import { formatEuro } from "../format";
import { categorizeTxs } from "../api";
import { getAiCategorizeEnabled, setAiCategorizeEnabled } from "../settings";
import { toDecisions, MAX_CATEGORIZE_BATCH } from "../categorize-ui";

/* What each "onbekend" reason means and what the owner can DO about it. Written
 * out rather than left as a bare label because the review's complaint was not
 * that the number was wrong — it was that "onbekend" said nothing at all. The
 * `ai` flag decides whether we may claim the AI pass can help: for a row whose
 * only surviving text is account numbers it CANNOT, and saying otherwise would
 * send him round a loop that can never close. */
const REASON_TEXT: Record<UnknownReason, { label: string; what: string; ai: boolean }> = {
  buitenland: {
    label: "buitenlandse betaling",
    what: "Kaartbetalingen in het buitenland. De naam van de winkel staat er wel bij, maar staat in geen enkele regel.",
    ai: true,
  },
  "onbekende-tegenpartij": {
    label: "geen regel",
    what: "Er staat een tegenpartij in de transactie, maar geen regel en geen ingebouwde categorie past erop.",
    ai: true,
  },
  "alleen-nummers": {
    label: "alleen nummers",
    what: "Na het weghalen van rekeningnummers en bedragen blijft er geen leesbare tekst over. Hier valt niets te lezen — ook niet voor de AI. Geef deze zelf een categorie.",
    ai: false,
  },
  "geen-tekst": {
    label: "geen tekst",
    what: "De export gaf geen tegenpartij en geen omschrijving mee. Geef deze zelf een categorie.",
    ai: false,
  },
};

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

  // --- The "onbekend" pile ------------------------------------------------
  // What it IS, per reason, over the rows currently in view. Named reasons
  // rather than a bare count: an unknown EUR 4.000 with no explanation is a
  // dead end, and this is data we already hold (a card export prints the
  // merchant's country on the row).
  const unknown = useMemo(() => unknownBreakdown(filtered, rules, own), [filtered, rules, own]);

  // --- AI categorization (opt-in, confirm-first) --------------------------
  // The batch the AI flow will send. Two properties, both load-bearing:
  //
  //  * NEWEST MONTH FIRST, not the flat list. Storage is import-ordered, i.e.
  //    oldest-first, so slicing the flat list handed the model the OLDEST
  //    unknowns — while the blocks that actually show "onbekend" (Top-uitgaven,
  //    de categorie-trend) look at the LATEST month, which a capped run would
  //    never reach.
  //  * ONLY ROWS WITH READABLE TEXT. aiCategorizeItems drops a row whose
  //    redacted text has no letters left, so the 200-item cap is spent on rows
  //    that can actually be answered instead of on blanks.
  const batch = useMemo(() => {
    const txs: Tx[] = [];
    const items: AiCategorizeItem[] = [];
    for (const m of uncategorizedByMonth(filtered, rules, own)) {
      for (const t of m.txs) {
        if (items.length >= MAX_CATEGORIZE_BATCH) return { txs, items };
        const [item] = aiCategorizeItems([t]);
        if (!item) continue; // nothing to read — see REASON_TEXT["alleen-nummers"]
        txs.push(t);
        items.push(item);
      }
    }
    return { txs, items };
  }, [filtered, rules, own]);
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
      const results = await categorizeTxs(batch.items);
      const byId = new Map(results.map((r) => [r.id, r.category]));
      // Only surface txs the model could place; the owner reviews/edits/skips each.
      const proposed = batch.txs
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

  /** The Categorie cell. For a placed row that is just the category; for an
   *  "onbekend" row it also names WHY — with the country code when the export
   *  gave us one, since that is the single most useful thing we already know
   *  about a row we cannot place. */
  function categoryCell(t: Tx) {
    const category = categorize(t, rules, own);
    if (category !== "onbekend") return category;
    const reason = unknownReason(t);
    const cc = reason === "buitenland" ? foreignCode(t) : null;
    return (
      <>
        onbekend{" "}
        <span className="badge" title={REASON_TEXT[reason].what}>
          {REASON_TEXT[reason].label}
          {cc ? ` ${cc}` : ""}
        </span>
      </>
    );
  }

  return (
    <section className="card" aria-label="Transacties">
      <h2 style={{ margin: 0 }}>Transacties</h2>

      {aiNote && aiPhase === "idle" && <p className="cell-sub">{aiNote}</p>}

      {/* --- The onbekend panel. This is where the AI route now lives, because
          this is where the unknowns are visible: a button on the page header
          fixed something the owner could not see, and reported the batch cap
          (200) as if it were the total. --- */}
      {unknown.count > 0 && aiPhase === "idle" && (
        <div className="ai-extract" style={{ margin: "var(--sp-3) 0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "var(--sp-3)",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div className="cell-sub">Onbekend</div>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                {unknown.count} {unknown.count === 1 ? "transactie" : "transacties"} ·{" "}
                <span className={unknown.amount >= 0 ? "text-pos" : "text-neg"}>
                  {formatEuro(unknown.amount)}
                </span>
              </strong>
            </div>
            <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
              <button
                type="button"
                className={"pill" + (fCategory === "onbekend" ? " pill-active" : "")}
                onClick={() => onFCategoryChange(fCategory === "onbekend" ? "" : "onbekend")}
              >
                {fCategory === "onbekend" ? "Toon alles" : "Toon alleen onbekend"}
              </button>
              {configured && batch.items.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onCategorizeClick}
                  aria-label="Laat de AI de onbekende transacties lezen"
                >
                  {/* The honest count: how many go out THIS run, out of how many
                      there are. The batch is capped at 200 per request. */}
                  Laat de AI ze lezen
                  {batch.items.length < unknown.count
                    ? ` (${batch.items.length} van ${unknown.count})`
                    : ` (${batch.items.length})`}
                </button>
              )}
            </div>
          </div>

          <ul style={{ listStyle: "none", padding: 0, margin: "var(--sp-3) 0 0" }}>
            {unknown.byReason.map((b) => {
              const t = REASON_TEXT[b.reason];
              return (
                <li key={b.reason} style={{ marginBottom: "var(--sp-2)" }}>
                  <span className="badge">{t.label}</span>{" "}
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {b.count}× · {formatEuro(b.amount)}
                  </span>
                  {b.countries.length > 0 && (
                    <span className="cell-sub"> · {b.countries.join(", ")}</span>
                  )}
                  <div className="cell-sub">{t.what}</div>
                </li>
              );
            })}
          </ul>

          {!configured && unknown.byReason.some((b) => REASON_TEXT[b.reason].ai) && (
            /* Name the real cause. The AI route is not "unavailable" in the
               abstract — the server has no Anthropic key set. Anything vaguer
               sends someone looking in the wrong place. */
            <p className="cell-sub">
              De AI-route staat uit: op de server is geen Anthropic-sleutel ingesteld. Tot die er is
              kun je deze transacties indelen met een eigen regel onder Regels, of ze hier per stuk
              een categorie geven.
            </p>
          )}
          {configured && batch.items.length === 0 && (
            <p className="cell-sub">
              Geen van deze transacties heeft tekst die de AI kan lezen — hier helpt alleen een
              eigen regel of een categorie die je zelf geeft.
            </p>
          )}
        </div>
      )}

      {aiPhase === "consent" && (
        <div className="ai-extract" style={{ margin: "var(--sp-3) 0" }}>
          <p className="cell-sub">
            Alleen de <strong>tegenpartij + omschrijving</strong> en de richting (in/uit) van je
            onbekende transacties gaan via onze server naar Claude — nooit je bedragen, saldi,
            rekeningnummers of datums als apart veld, en we filteren herkenbare IBANs, bedragen en
            datums ook uit die tekst voordat we hem versturen. Je bekijkt en bevestigt elk voorstel
            voordat er iets verandert.
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
          <div className="table-wrap table-cards">
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
                    <td data-label="Tegenpartij">{p.tx.counterparty}</td>
                    <td data-label="Omschrijving">{p.tx.description}</td>
                    <td data-label="Bedrag">
                      <span className={p.tx.amount >= 0 ? "text-pos" : "text-neg"}>
                        {formatEuro(p.tx.amount)}
                      </span>
                    </td>
                    <td data-label="Categorie">
                      <select
                        value={p.category}
                        aria-label={`Categorie voor ${p.tx.counterparty}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          setProposals((prev) =>
                            prev.map((q, j) => (j === i ? { ...q, category: v } : q)),
                          );
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
          {aiNote && (
            <p className="cell-sub" role="alert">
              {aiNote}
            </p>
          )}
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
      {/* One wrapping row of fields rather than inline labels separated by
          spaces: at phone width the old layout ran the six controls into each
          other and pushed the page sideways. */}
      <div className="filter-bar">
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
        <label className="filter-grow">
          Zoeken{" "}
          <input
            value={fSearch}
            onChange={(e) => onFSearchChange(e.target.value)}
            placeholder="Tegenpartij of omschrijving"
          />
        </label>
        <label>
          Van <input type="date" value={fFrom} onChange={(e) => onFFromChange(e.target.value)} />
        </label>
        <label>
          Tot <input type="date" value={fTo} onChange={(e) => onFToChange(e.target.value)} />
        </label>
      </div>

      <p>{rows.length} transacties</p>

      {rows.length === 0 ? (
        <p>Geen transacties.</p>
      ) : (
        <div className="table-wrap table-cards">
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
                  <td data-label="Datum">{t.date}</td>
                  <td data-label="Tegenpartij">{t.counterparty}</td>
                  <td data-label="Omschrijving">{t.description}</td>
                  <td data-label="Rekening">
                    {t.bank} · {t.accountKey}
                  </td>
                  <td data-label="Bedrag">
                    <span className={t.amount >= 0 ? "text-pos" : "text-neg"}>
                      {formatEuro(t.amount)}
                    </span>
                  </td>
                  <td data-label="Entiteit">{t.entity}</td>
                  <td data-label="Categorie">{categoryCell(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
