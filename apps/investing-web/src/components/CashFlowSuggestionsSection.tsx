import { useCallback, useEffect, useState } from "react";
import type { CashFlowKind } from "@lavega/core";
import { Switch } from "./LayoutPicker.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import {
  afterSignChange,
  confirmCashFlowSuggestion,
  loadCashFlowSuggestions,
  rejectCashFlowSuggestion,
  removeCashFlowRule,
  RULE_KINDS,
  setCashFlowSuggestionsEnabled,
  suggestionKey,
  wouldChangeSign,
  type CashFlowRuleRow,
  type CashFlowState,
  type CashFlowSuggestionRow,
} from "../lib/cashFlowSuggestions.js";
import {
  cashFlowCopy,
  investingLocaleTag,
  readInvestingLocale,
  type CashFlowCopy,
} from "../lib/cashFlowCopy.js";

/* Cash-flow suggestions on the Profile screen (issue #137, Jev-04).
 *
 * A suggestion is a proposal about one broker's VOCABULARY word, not about one
 * transaction. The panel shows every pending word with the broker's raw type,
 * the suggested kind and the model's confidence, and one observed amount+sign
 * so the owner can judge it. Nothing on this screen changes a figure until the
 * owner confirms; a confirmation creates a rule the next sync applies without
 * a model.
 *
 * THE SIGN IS THE DANGEROUS PART. A kind that would normalise the observed
 * amount to the other sign (a positive "withdrawal") gets a red before/after
 * block, and confirming it needs an explicit acknowledgement checkbox on top of
 * the button. That is deliberately two deliberate actions, not one, because a
 * flipped sign corrupts the cash-flow series behind every return.
 *
 * The server stays the authority: if it reports the sign change anyway (409),
 * the panel shows ITS before/after and requires the same acknowledgement before
 * resending. */

type RowSign = { before: number | null; after: number | null };

function formatSignedAmount(
  amount: number | null,
  currency: string,
  locale: ReturnType<typeof readInvestingLocale>,
): string {
  if (amount == null) return "—";
  const formatter = new Intl.NumberFormat(investingLocaleTag(locale), {
    style: "currency",
    currency: currency || "EUR",
  });
  const formatted = formatter.format(amount);
  return amount > 0 ? `+${formatted}` : formatted;
}

function confidenceLabel(confidence: number | null, copy: CashFlowCopy): string {
  return confidence == null ? "—" : copy.confidence(`${Math.round(confidence * 100)}%`);
}

export function CashFlowSuggestionsSection() {
  const locale = readInvestingLocale();
  const copy = cashFlowCopy[locale];
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [state, setState] = useState<CashFlowState | null>(null);
  const [toggling, setToggling] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  /** The kind the owner picked for a row (defaults to the suggestion). */
  const [kindChoice, setKindChoice] = useState<Record<string, Exclude<CashFlowKind, "other">>>({});
  /** Deliberate acknowledgement for a sign-changing confirmation. */
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  /** A 409's before/after, when the server disagreed with the local preview. */
  const [serverSign, setServerSign] = useState<Record<string, RowSign>>({});

  const refresh = useCallback(async () => {
    try {
      setState(await loadCashFlowSuggestions());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const next = await loadCashFlowSuggestions();
        if (!current) return;
        setState(next);
        setStatus("ready");
      } catch {
        if (current) setStatus("error");
      }
    })();
    return () => {
      current = false;
    };
  }, []);

  async function handleToggle() {
    if (state == null || toggling) return;
    setToggling(true);
    setGlobalError(null);
    const next = !state.enabled;
    try {
      const saved = await setCashFlowSuggestionsEnabled(next);
      setState((current) => (current == null ? current : { ...current, enabled: saved }));
      // Enabling can reveal suggestions stored by an earlier run; reloading is
      // the only way to know, and it costs one round trip.
      if (saved) await refresh();
    } catch {
      setGlobalError(copy.toggleFailed);
    } finally {
      setToggling(false);
    }
  }

  function chosenKind(row: CashFlowSuggestionRow): Exclude<CashFlowKind, "other"> {
    const key = suggestionKey(row);
    const choice = kindChoice[key];
    if (choice != null) return choice;
    const suggested = row.kind;
    return suggested != null && suggested !== "other" ? suggested : RULE_KINDS[0];
  }

  /** The before/after the owner must see before a sign-changing confirmation. */
  function signPreview(row: CashFlowSuggestionRow): RowSign | null {
    const key = suggestionKey(row);
    const server = serverSign[key];
    if (server != null) return server;
    const kind = chosenKind(row);
    if (!wouldChangeSign(row.amount, kind)) return null;
    return { before: row.amount, after: afterSignChange(row.amount, kind) };
  }

  async function handleConfirm(row: CashFlowSuggestionRow) {
    const key = suggestionKey(row);
    if (busyRow != null) return;
    const preview = signPreview(row);
    if (preview != null && acknowledged[key] !== true) {
      setRowErrors((current) => ({ ...current, [key]: copy.signChangeRequired }));
      return;
    }
    setBusyRow(key);
    setRowErrors((current) => ({ ...current, [key]: "" }));
    try {
      const result = await confirmCashFlowSuggestion({
        broker: row.broker,
        typeKey: row.typeKey,
        kind: chosenKind(row),
        acknowledgeSignChange: preview != null,
      });
      if (result.status === "sign-change") {
        setServerSign((current) => ({
          ...current,
          [key]: { before: result.before, after: result.after },
        }));
        setRowErrors((current) => ({ ...current, [key]: copy.signChangeRequired }));
        return;
      }
      if (result.status === "error") {
        setRowErrors((current) => ({ ...current, [key]: result.message }));
        return;
      }
      setState((current) =>
        current == null
          ? current
          : {
              ...current,
              pending: current.pending.filter((candidate) => suggestionKey(candidate) !== key),
              rules: result.rules,
            },
      );
    } catch {
      setRowErrors((current) => ({ ...current, [key]: copy.confirmFailed }));
    } finally {
      setBusyRow(null);
    }
  }

  async function handleReject(row: CashFlowSuggestionRow) {
    const key = suggestionKey(row);
    if (busyRow != null) return;
    setBusyRow(key);
    setRowErrors((current) => ({ ...current, [key]: "" }));
    try {
      if (!(await rejectCashFlowSuggestion({ broker: row.broker, typeKey: row.typeKey }))) {
        setRowErrors((current) => ({ ...current, [key]: copy.rejectFailed }));
        return;
      }
      // The server remembers the rejection; removing it here matches what a
      // reload would show, so it is not offered again.
      setState((current) =>
        current == null
          ? current
          : {
              ...current,
              pending: current.pending.filter((candidate) => suggestionKey(candidate) !== key),
            },
      );
    } catch {
      setRowErrors((current) => ({ ...current, [key]: copy.rejectFailed }));
    } finally {
      setBusyRow(null);
    }
  }

  async function handleRemoveRule(rule: CashFlowRuleRow) {
    setGlobalError(null);
    const rules = await removeCashFlowRule({ broker: rule.broker, typeKey: rule.typeKey }).catch(
      () => null,
    );
    if (rules == null) {
      setGlobalError(copy.removeFailed);
      return;
    }
    setState((current) => (current == null ? current : { ...current, rules }));
  }

  return (
    <section id="cash-flow-suggestions" aria-label={copy.title}>
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
        </CardHeader>
        <CardContent spacing="loose">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold">{copy.enabledLabel}</p>
              <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.enabledHint}</p>
            </div>
            <Switch
              on={state?.enabled === true}
              disabled={toggling || status === "loading"}
              label={copy.enabledLabel}
              onToggle={() => void handleToggle()}
            />
          </div>

          {globalError != null && (
            <p role="alert" className="text-sm text-negative">
              {globalError}
            </p>
          )}

          {status === "loading" && <p className="text-sm text-muted-foreground">…</p>}
          {status === "error" && (
            <p role="alert" className="text-sm text-negative">
              {copy.loadFailed}
            </p>
          )}

          {status === "ready" && state != null && !state.enabled && (
            <p data-testid="cash-flow-disabled" className="text-sm text-muted-foreground">
              {copy.disabledNote}
            </p>
          )}

          {status === "ready" && state != null && state.enabled && (
            <div className="space-y-4" data-testid="cash-flow-enabled">
              <div>
                <p className="font-semibold" data-testid="cash-flow-pending-count">
                  {copy.waiting(state.pending.length)}
                </p>
                <p className="text-xs text-muted-foreground">{copy.waitingHint}</p>
              </div>

              {state.pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.noPending}</p>
              ) : (
                <ul className="space-y-3">
                  {state.pending.map((row) => {
                    const key = suggestionKey(row);
                    const preview = signPreview(row);
                    const kind = chosenKind(row);
                    const rowError = rowErrors[key];
                    return (
                      <li
                        key={key}
                        data-testid={`cash-flow-row-${key}`}
                        className={`rounded-tile border p-4 ${
                          preview != null ? "border-negative/50 bg-negative/5" : "border-border"
                        }`}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="flex flex-wrap items-baseline gap-2">
                            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                              {row.rawType}
                            </code>
                            <span className="text-sm font-semibold">{row.broker}</span>
                            <span className="text-xs text-muted-foreground">
                              {copy.suggestedKind}: <strong>{copy.kindLabels[kind]}</strong>
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {confidenceLabel(row.confidence, copy)}
                          </span>
                        </div>

                        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                          {row.description !== "" && (
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                {copy.descriptionLabel}
                              </dt>
                              <dd className="m-0 truncate">{row.description}</dd>
                            </div>
                          )}
                          <div>
                            <dt className="text-xs text-muted-foreground">{copy.amountLabel}</dt>
                            <dd className="m-0">
                              <span data-testid={`cash-flow-amount-${key}`}>
                                {formatSignedAmount(row.amount, row.currency, locale)}
                              </span>{" "}
                              <span className="text-xs text-muted-foreground">
                                ({row.sign === 1 ? copy.signIn : copy.signOut})
                              </span>
                            </dd>
                          </div>
                        </dl>

                        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-muted-foreground">{copy.correctKind}</span>
                          <select
                            className="rounded-tile border border-border bg-card px-2 py-1"
                            aria-label={`${copy.correctKind}: ${row.rawType}`}
                            data-testid={`cash-flow-kind-${key}`}
                            value={kind}
                            onChange={(event) => {
                              const next = event.target.value as Exclude<CashFlowKind, "other">;
                              setKindChoice((current) => ({ ...current, [key]: next }));
                              // A 409 preview belonged to the old kind.
                              setServerSign((current) => {
                                const { [key]: _removed, ...rest } = current;
                                return rest;
                              });
                            }}
                          >
                            {RULE_KINDS.map((candidate) => (
                              <option key={candidate} value={candidate}>
                                {copy.kinds[candidate]}
                              </option>
                            ))}
                          </select>
                        </label>

                        {preview != null && (
                          <div
                            role="alert"
                            data-testid={`cash-flow-sign-change-${key}`}
                            className="mt-3 rounded-tile border border-negative/50 bg-negative/10 p-3"
                          >
                            <p className="m-0 text-sm font-semibold text-negative">
                              {copy.signChangeTitle}
                            </p>
                            <p className="m-0 mt-1 text-sm">
                              {copy.signChangeBody(
                                formatSignedAmount(preview.before, row.currency, locale),
                                formatSignedAmount(preview.after, row.currency, locale),
                              )}
                            </p>
                            <label className="mt-2 flex items-start gap-2 text-sm font-semibold">
                              <input
                                type="checkbox"
                                className="mt-1"
                                data-testid={`cash-flow-ack-${key}`}
                                checked={acknowledged[key] === true}
                                onChange={(event) =>
                                  setAcknowledged((current) => ({
                                    ...current,
                                    [key]: event.target.checked,
                                  }))
                                }
                              />
                              <span>{copy.signChangeAcknowledge}</span>
                            </label>
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant={preview != null ? "destructive" : "default"}
                            size="sm"
                            data-testid={`cash-flow-confirm-${key}`}
                            disabled={
                              busyRow != null || (preview != null && acknowledged[key] !== true)
                            }
                            onClick={() => void handleConfirm(row)}
                          >
                            {preview != null ? copy.confirmSignChange : copy.confirm}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid={`cash-flow-reject-${key}`}
                            disabled={busyRow != null}
                            onClick={() => void handleReject(row)}
                          >
                            {copy.reject}
                          </Button>
                        </div>

                        {rowError != null && rowError !== "" && (
                          <p role="alert" className="mt-2 text-sm text-negative">
                            {rowError}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {status === "ready" && state != null && (
            <div className="border-t border-border pt-4">
              <h3 className="font-sans text-xl font-semibold tracking-tight">{copy.rulesTitle}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{copy.rulesHint}</p>
              {state.rules.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{copy.rulesEmpty}</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {state.rules.map((rule) => {
                    const key = suggestionKey(rule);
                    return (
                      <li
                        key={key}
                        data-testid={`cash-flow-rule-${key}`}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                            {rule.typeKey}
                          </code>{" "}
                          <span className="font-semibold">{rule.broker}</span> →{" "}
                          {copy.kindLabels[rule.kind]}{" "}
                          <span className="text-xs text-muted-foreground">
                            {copy.ruleConfirmedAt(rule.confirmedAt.slice(0, 10))}
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`cash-flow-remove-${key}`}
                          onClick={() => void handleRemoveRule(rule)}
                        >
                          {copy.remove}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
