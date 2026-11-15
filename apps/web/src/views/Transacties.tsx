import { useMemo, useState } from "react";
import type {
  Account,
  OwnAccounts,
  Rule,
  Tx,
  CategoryDecision,
  UnknownReason,
  AiCategorizeItem,
  TransferPair,
  TransferCandidate,
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
  isEurCurrency,
  toEur,
} from "@lavega/core";
import {
  formatEuroIn,
  formatCurrencyIn,
  formatSignedCurrencyIn,
  formatSignedEuroIn,
  formatDate,
} from "../format";
import { categorizeTxs } from "../api";
import { useAppLocale, pick } from "../appLocale";
import { moneyCopy, categoryLabel } from "../copy/money";
import { getAiCategorizeEnabled, setAiCategorizeEnabled, type ConversionMode } from "../settings";
import { toDecisions, MAX_CATEGORIZE_BATCH } from "../categorize-ui";
import Badge from "../components/ui/Badge.js";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import Pill from "../components/ui/Pill.js";
import { Table, TableWrap, Th, Td } from "../components/ui/Table.js";

/* Which UnknownReason maps to which moneyCopy.transacties.reason entry, and
 * whether the AI pass can help with that reason. The `ai` flag stays local —
 * it is not text, it is a capability gate: for a row whose only surviving
 * text is account numbers the AI CANNOT place it, and saying otherwise would
 * send the owner round a loop that can never close. */
const REASON_KEY: Record<
  UnknownReason,
  "buitenland" | "onbekendeTegenpartij" | "alleenNummers" | "geenTekst"
> = {
  buitenland: "buitenland",
  "onbekende-tegenpartij": "onbekendeTegenpartij",
  "alleen-nummers": "alleenNummers",
  "geen-tekst": "geenTekst",
};
const REASON_AI: Record<UnknownReason, boolean> = {
  buitenland: true,
  "onbekende-tegenpartij": true,
  "alleen-nummers": false,
  "geen-tekst": false,
};

type TransactiesProps = {
  accounts: Account[];
  scopedTxs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  /** ECB daily rates, and whether a non-EUR row shows its € equivalent
   *  alongside its original amount ("convert") or the original amount only,
   *  as before FX support existed ("separate"). */
  fxHistory: Record<string, Record<string, number>>;
  mode: ConversionMode;
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
  /** Whether the server has a Mistral key — gates the "Categoriseer met AI"
   *  button. When false the button is hidden entirely. */
  configured: boolean;
  /** Apply confirmed AI-category decisions against the full tx + rules lists
   *  (App owns that + persistence). */
  onApplyCategories: (decisions: CategoryDecision[]) => Promise<void>;
  /** Stored transfer decisions. A confirmed pair's two legs get the "Transfer"
   *  badge; a rejected pair is the matcher's memory and is never proposed. */
  transfers: TransferPair[];
  /** Pairs DERIVED from the current ledger: suggestions, never decisions. The
   *  panel below is the only place they become one. */
  suggestions: TransferCandidate[];
  onConfirmTransfer: (pair: TransferPair) => void;
  onRejectTransfer: (pair: TransferPair) => void;
};

export default function Transacties({
  accounts,
  scopedTxs,
  rules,
  own,
  fxHistory,
  mode,
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
  transfers,
  suggestions,
  onConfirmTransfer,
  onRejectTransfer,
}: TransactiesProps) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale];

  // One row is at most one leg of one pair, so a map from leg id answers "does
  // this row carry a badge" without scanning the pair list per row. Confirmed
  // wins over suggested by construction (the matcher never re-proposes a
  // decided leg), but the cell checks confirmed first anyway so a stale
  // suggestion can never paint over a stored decision.
  const confirmedByTxId = useMemo(() => {
    const m = new Map<string, TransferPair>();
    for (const p of transfers)
      if (p.status === "confirmed") {
        m.set(p.outflowTxId, p);
        m.set(p.inflowTxId, p);
      }
    return m;
  }, [transfers]);
  const suggestedByTxId = useMemo(() => {
    const m = new Map<string, TransferPair>();
    for (const s of suggestions) {
      m.set(s.pair.outflowTxId, s.pair);
      m.set(s.pair.inflowTxId, s.pair);
    }
    return m;
  }, [suggestions]);
  // App scopes `suggestions` to pairs whose BOTH legs are in this half (naming
  // an account from the other half would cross the line this switch draws), so
  // the rows and accounts this view already has are the whole lookup.
  const txById = useMemo(() => new Map(scopedTxs.map((t) => [t.id, t])), [scopedTxs]);
  const accountNameByKey = useMemo(
    () => new Map(accounts.map((a) => [a.key, a.name || a.key])),
    [accounts],
  );

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
        if (!item) continue; // nothing to read — see REASON_KEY["alleen-nummers"]
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
        setAiNote(c.transacties.aiKonGeenIndelen);
        return;
      }
      setProposals(proposed);
      setAiPhase("review");
    } catch (e) {
      setAiPhase("idle");
      setAiNote(e instanceof Error ? e.message : c.transacties.categorisatieMislukt);
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
          ? c.transacties.gecategoriseerdNote(decisions.length)
          : c.transacties.nietsToegepast,
      );
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : c.transacties.opslaanMislukt);
    }
  }

  function cancelReview() {
    setProposals([]);
    setAiPhase("idle");
  }

  /** The Categorie cell. For a placed row that is just the category; for an
   *  "onbekend" row it also names WHY — with the country code when the export
   *  gave us one, since that is the single most useful thing we already know
   *  about a row we cannot place.
   *
   *  A row that is one leg of a transfer pair carries the badge here too: the
   *  category now reads "Eigen overboeking" because the pair SAYS so, and the
   *  badge names the pair behind that. A suggestion stays visually quieter
   *  ("Mogelijk") — it is not a decision yet, and it must not read as one. */
  function categoryCell(t: Tx) {
    const category = categorize(t, rules, own);
    const confirmed = confirmedByTxId.get(t.id);
    const suggested = confirmed ? undefined : suggestedByTxId.get(t.id);
    const transferBadge = confirmed ? (
      <Badge data-testid="transfer-badge" title={c.transacties.transferKinds[confirmed.kind]}>
        {c.transacties.transferBadge}
      </Badge>
    ) : suggested ? (
      <Badge
        data-testid="possible-transfer-badge"
        className="opacity-70"
        title={c.transacties.transferKinds[suggested.kind]}
      >
        {c.transacties.possibleTransferBadge}
      </Badge>
    ) : null;
    const rest =
      category !== "onbekend" ? (
        categoryLabel(locale, category)
      ) : (
        <>
          {c.transacties.onbekendLabel}{" "}
          {(() => {
            const reason = unknownReason(t);
            const reasonCopy = c.transacties.reason[REASON_KEY[reason]];
            const cc = reason === "buitenland" ? foreignCode(t) : null;
            return (
              <Badge title={reasonCopy.what}>
                {reasonCopy.label}
                {cc ? ` ${cc}` : ""}
              </Badge>
            );
          })()}
        </>
      );
    return (
      <>
        {rest}
        {transferBadge ? <> {transferBadge}</> : null}
      </>
    );
  }

  return (
    <Card as="section" aria-label={c.transacties.heading}>
      <h2 style={{ margin: 0 }}>{c.transacties.heading}</h2>

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
              <div className="cell-sub">{pick(locale, "Onbekend", "Uncategorised")}</div>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                {unknown.count} {c.rekeningen.transactieWoord(unknown.count)} ·{" "}
                <span className={`whitespace-nowrap ${unknown.amount >= 0 ? "text-pos" : "text-neg"}`}>
                  {formatSignedEuroIn(locale, unknown.amount)}
                </span>
              </strong>
            </div>
            <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
              <Pill
                active={fCategory === "onbekend"}
                onClick={() => onFCategoryChange(fCategory === "onbekend" ? "" : "onbekend")}
              >
                {fCategory === "onbekend"
                  ? c.transacties.toonAlles
                  : c.transacties.toonAlleenOnbekend}
              </Pill>
              {configured && batch.items.length > 0 && (
                <Button
                  variant="primary"
                  onClick={onCategorizeClick}
                  aria-label={c.transacties.laatDeAiLezenAria}
                >
                  {/* The honest count: how many go out THIS run, out of how many
                      there are. The batch is capped at 200 per request. */}
                  {c.transacties.laatDeAiZeLezen}
                  {c.transacties.batchCountSuffix(batch.items.length, unknown.count)}
                </Button>
              )}
            </div>
          </div>

          <ul style={{ listStyle: "none", padding: 0, margin: "var(--sp-3) 0 0" }}>
            {unknown.byReason.map((b) => {
              const t = c.transacties.reason[REASON_KEY[b.reason]];
              return (
                <li key={b.reason} style={{ marginBottom: "var(--sp-2)" }}>
                  <Badge>{t.label}</Badge>{" "}
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {b.count}× · {formatEuroIn(locale, b.amount)}
                  </span>
                  {b.countries.length > 0 && (
                    <span className="cell-sub"> · {b.countries.join(", ")}</span>
                  )}
                  <div className="cell-sub">{t.what}</div>
                </li>
              );
            })}
          </ul>

          {!configured && unknown.byReason.some((b) => REASON_AI[b.reason]) && (
            /* Name the real cause. The AI route is not "unavailable" in the
               abstract — the server has no Mistral key set. Anything vaguer
               sends someone looking in the wrong place. */
            <p className="cell-sub">{c.transacties.aiRouteUit}</p>
          )}
          {configured && batch.items.length === 0 && (
            <p className="cell-sub">{c.transacties.geenLeesbareTekst}</p>
          )}
        </div>
      )}

      {aiPhase === "consent" && (
        <div className="ai-extract" style={{ margin: "var(--sp-3) 0" }}>
          <p className="cell-sub">
            {c.transacties.consentBefore}
            <strong>{c.transacties.consentStrong}</strong>
            {c.transacties.consentAfter}
          </p>
          <Button variant="primary" onClick={enableAndRun}>
            {c.transacties.aanzettenEnCategoriseren}
          </Button>{" "}
          <Button onClick={() => setAiPhase("idle")}>{c.transacties.annuleer}</Button>
        </div>
      )}

      {aiPhase === "loading" && <p className="cell-sub">{c.transacties.bezigMetCategoriseren}</p>}

      {aiPhase === "review" && (
        <div className="ai-extract" style={{ margin: "var(--sp-3) 0" }}>
          <p className="cell-sub">
            {c.transacties.voorstellenCount(proposals.length)}
            {c.transacties.voorstellenRest}
          </p>
          <TableWrap>
            <Table cards>
              <thead>
                <tr>
                  <Th>{c.transacties.tegenpartij}</Th>
                  <Th>{c.transacties.omschrijving}</Th>
                  <Th>{c.transacties.bedrag}</Th>
                  <Th>{c.transacties.categorie}</Th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p, i) => (
                  <tr key={p.tx.id}>
                    <Td data-label={c.transacties.tegenpartij}>{p.tx.counterparty}</Td>
                    <Td data-label={c.transacties.omschrijving}>{p.tx.description}</Td>
                    <Td data-label={c.transacties.bedrag}>
                      <span className={`whitespace-nowrap ${p.tx.amount >= 0 ? "text-pos" : "text-neg"}`}>
                        {formatSignedEuroIn(locale, p.tx.amount)}
                      </span>
                    </Td>
                    <Td data-label={c.transacties.categorie}>
                      <select
                        value={p.category}
                        aria-label={c.transacties.categorieVoor(p.tx.counterparty)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setProposals((prev) =>
                            prev.map((q, j) => (j === i ? { ...q, category: v } : q)),
                          );
                        }}
                      >
                        <option value="">{c.transacties.slaOver}</option>
                        {CATEGORY_OPTIONS.map((cat) => (
                          <option key={cat} value={cat}>
                            {categoryLabel(locale, cat)}
                          </option>
                        ))}
                      </select>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          {aiNote && (
            <p className="cell-sub" role="alert">
              {aiNote}
            </p>
          )}
          <Button variant="primary" onClick={() => void applyReview()}>
            {c.transacties.toepassen}
          </Button>{" "}
          <Button onClick={cancelReview}>{c.transacties.annuleer}</Button>
        </div>
      )}
      {/* --- Possible transfers. DERIVED, not stored: the matcher runs over the
          current ledger every unlock, so a re-import can drop a candidate
          instead of leaving a stale claim behind. This panel is the only place
          a suggestion can become a decision, and nothing here happens by
          itself — the footnote says so, because confirming CHANGES the spend
          totals and the owner has to know that. --- */}
      {suggestions.length > 0 && (
        <div
          className="ai-extract"
          style={{ margin: "var(--sp-3) 0" }}
          data-testid="possible-transfers"
        >
          <strong>{c.transacties.possibleTransfersHeading}</strong>
          <p className="cell-sub">{c.transacties.possibleTransfersIntro}</p>
          <ul style={{ listStyle: "none", padding: 0, margin: "var(--sp-3) 0 0" }}>
            {suggestions.map(({ pair, ambiguous }) => {
              const out = txById.get(pair.outflowTxId);
              const inn = txById.get(pair.inflowTxId);
              // The pair's own ids are the identity; a leg missing from the
              // lookup can only happen for a stale row, so fall back to the id
              // rather than hiding the candidate.
              const from = out
                ? (accountNameByKey.get(out.accountKey) ?? out.accountKey)
                : pair.outflowTxId;
              const to = inn
                ? (accountNameByKey.get(inn.accountKey) ?? inn.accountKey)
                : pair.inflowTxId;
              return (
                <li key={pair.id} style={{ marginBottom: "var(--sp-3)" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "var(--sp-2)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span className="cell-sub">{out ? formatDate(locale, out.date) : ""}</span>
                    <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                      {from} → {to}
                    </strong>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatCurrencyIn(locale, pair.amountCents / 100, pair.currency)}
                    </span>
                    <span className="cell-sub">
                      {c.transacties.possibleTransferDayGap(
                        Math.abs(pair.evidence?.dateDiffDays ?? 0),
                      )}
                    </span>
                    <Badge>{c.transacties.transferKinds[pair.kind]}</Badge>
                    {ambiguous && (
                      <Badge tone="warning">{c.transacties.possibleTransferAmbiguous}</Badge>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-2)" }}>
                    <Button
                      variant="primary"
                      data-testid="transfer-confirm"
                      aria-label={c.transacties.possibleTransferConfirmAria(from, to)}
                      onClick={() => onConfirmTransfer(pair)}
                    >
                      {c.transacties.possibleTransferConfirm}
                    </Button>
                    <Button
                      data-testid="transfer-reject"
                      aria-label={c.transacties.possibleTransferRejectAria(from, to)}
                      onClick={() => onRejectTransfer(pair)}
                    >
                      {c.transacties.possibleTransferReject}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="cell-sub">{c.transacties.possibleTransfersFootnote}</p>
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
            {c.transacties.entiteitLabel}{" "}
            <select value={fEntity} onChange={(e) => onFEntityChange(e.target.value)}>
              <option value="">{c.transacties.alleEntiteiten}</option>
              {entityOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {c.transacties.rekeningLabel}{" "}
          <select value={fAccount} onChange={(e) => onFAccountChange(e.target.value)}>
            <option value="">{c.transacties.alleRekeningen}</option>
            {accounts.map((a) => (
              <option key={a.key} value={a.key}>
                {a.bank} · {a.key}
              </option>
            ))}
          </select>
        </label>
        <label>
          {c.transacties.categorieLabel}{" "}
          <select value={fCategory} onChange={(e) => onFCategoryChange(e.target.value)}>
            <option value="">{c.transacties.alleCategorieen}</option>
            {/* Keep a selected category visible even if the other filters leave it
                with zero rows (so the dropdown reflects state, e.g. after a click
                from Overzicht + a scope change). */}
            {fCategory && !categoryOptions.includes(fCategory) && (
              <option value={fCategory}>{categoryLabel(locale, fCategory)}</option>
            )}
            {categoryOptions.map((cat) => (
              <option key={cat} value={cat}>
                {categoryLabel(locale, cat)}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-grow">
          {c.transacties.zoekenLabel}{" "}
          <input
            value={fSearch}
            onChange={(e) => onFSearchChange(e.target.value)}
            placeholder={c.transacties.zoekenPlaceholder}
          />
        </label>
        <label>
          {c.transacties.van}{" "}
          <input type="date" value={fFrom} onChange={(e) => onFFromChange(e.target.value)} />
        </label>
        <label>
          {c.transacties.tot}{" "}
          <input type="date" value={fTo} onChange={(e) => onFToChange(e.target.value)} />
        </label>
      </div>

      <p>{c.transacties.transactiesCount(rows.length)}</p>

      {rows.length === 0 ? (
        <p>{c.transacties.geenTransacties}</p>
      ) : (
        <TableWrap>
          <Table cards>
            <thead>
              <tr>
                <Th>{c.transacties.tableDatum}</Th>
                <Th>{c.transacties.tableTegenpartij}</Th>
                <Th>{c.transacties.tableOmschrijving}</Th>
                <Th>{c.transacties.tableRekening}</Th>
                <Th>{c.transacties.tableBedrag}</Th>
                <Th>{c.transacties.tableEntiteit}</Th>
                <Th>{c.transacties.tableCategorie}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <Td data-label={c.transacties.tableDatum}>{t.date}</Td>
                  <Td data-label={c.transacties.tableTegenpartij}>{t.counterparty}</Td>
                  <Td data-label={c.transacties.tableOmschrijving}>{t.description}</Td>
                  <Td data-label={c.transacties.tableRekening}>
                    {t.bank} · {t.accountKey}
                  </Td>
                  <Td data-label={c.transacties.tableBedrag}>
                    <span className={`whitespace-nowrap ${t.amount >= 0 ? "text-pos" : "text-neg"}`}>
                      {isEurCurrency(t.currency)
                        ? formatSignedEuroIn(locale, t.amount)
                        : formatSignedCurrencyIn(locale, t.amount, t.currency)}
                    </span>
                    {!isEurCurrency(t.currency) &&
                      mode === "convert" &&
                      (() => {
                        const eur = toEur(t.amount, t.currency, t.date, fxHistory);
                        return eur === null ? null : (
                          <span className="cell-sub"> ≈ {formatEuroIn(locale, eur)}</span>
                        );
                      })()}
                  </Td>
                  <Td data-label={c.transacties.tableEntiteit}>{t.entity}</Td>
                  <Td data-label={c.transacties.tableCategorie}>{categoryCell(t)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
