import { useMemo, useState } from "react";
import type {
  Account,
  DryRunResult,
  OwnAccounts,
  Rule,
  RuleAction,
  RuleAmountOp,
  RuleCategoryOp,
  RuleCondition,
  RuleDateOp,
  RuleTextOp,
  RuleV2,
  Tx,
} from "@lavega/core";
import { CATEGORY_OPTIONS, dryRunRuleChanges, isRuleV2, toCents } from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import { adminCopy, type RegelsCopy } from "../copy/admin.js";
import { categoryLabel } from "../copy/money.js";
import { formatDate, formatSignedEuroIn } from "../format.js";
import Badge from "../components/ui/Badge.js";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import { Table, TableWrap, Th, Td } from "../components/ui/Table.js";

/* The rules editor for the v2 engine.
 *
 * TWO SHAPES, ONE LIST. A vault can still hold legacy rows (one substring, one
 * category). They render readably and open in the editor lowered to the same
 * text condition; saving one replaces that single row with a v2 rule. Legacy
 * rows are never rewritten in bulk — the engine's upgrade pass at the vault
 * boundary decides that, not this screen.
 *
 * ORDER IS PRIORITY. `rules[index]` is the priority, so the list renders in
 * stored order and Omhoog/Omlaag hand `onSaveRules` a reordered whole array.
 * The old screen sorted a copy for reading and said so; that note is gone
 * because the number column now says which rule matches first.
 *
 * ACTIONS ARE CLAIMS, NOT WRITES. Only setCategory reaches transactions today.
 * The other actions are evaluated and shown in the dry run, and both the editor
 * and the preview say they do not change totals yet.
 *
 * LOCKS ARE EXPLAINED. A category the owner set by hand is locked; the preview
 * shows "met de hand gezet" and the winning-rule cell stays empty instead of
 * naming a rule that could not claim the category. */

type ConditionKind = RuleCondition["kind"];
type TextTarget = Extract<RuleCondition, { kind: "text" }>["target"];
type ActionKind = RuleAction["kind"];

/** Amount inputs are strings while the owner types (a lone "-" or "" is not a
 *  number yet). They become signed cents with Math.round(euros * 100) on save. */
type AmountDraftCondition = {
  kind: "amount";
  op: RuleAmountOp;
  valueEuros: string;
  upperEuros: string;
};

type DraftCondition = Exclude<RuleCondition, { kind: "amount" }> | AmountDraftCondition;

type DraftRule = {
  name: string;
  effectiveFrom: string;
  stopProcessing: boolean;
  conditions: DraftCondition[];
  actions: RuleAction[];
};

type EditingState = { id: string; isNew: boolean; draft: DraftRule };

type RegelsProps = {
  rules: Rule[];
  txs: Tx[];
  accounts: Account[];
  own?: OwnAccounts;
  busy: boolean;
  onSaveRules: (next: Rule[]) => void;
};

const CONDITION_KINDS: ConditionKind[] = [
  "text",
  "merchant",
  "amount",
  "account",
  "category",
  "direction",
  "date",
];
const TEXT_TARGETS: TextTarget[] = ["text", "counterparty", "description"];
const TEXT_OPS: RuleTextOp[] = ["contains", "equals", "startsWith", "endsWith"];
const MERCHANT_OPS: ReadonlyArray<"contains" | "equals"> = ["contains", "equals"];
const AMOUNT_OPS: RuleAmountOp[] = ["eq", "gt", "gte", "lt", "lte", "between"];
const CATEGORY_OPS: RuleCategoryOp[] = ["equals", "empty", "notEmpty"];
const DATE_OPS: RuleDateOp[] = ["onOrAfter", "onOrBefore", "between"];
const DIRECTIONS: ReadonlyArray<"in" | "out"> = ["in", "out"];
const ACTION_KINDS: ActionKind[] = [
  "setCategory",
  "setDisplayName",
  "setMerchant",
  "addTag",
  "exclude",
  "markTransfer",
];

/** Typed starting point. An empty text condition + empty category action is a
 *  shape the owner can fill in; validation refuses to save it as-is. */
function emptyDraft(): DraftRule {
  return {
    name: "",
    effectiveFrom: "",
    stopProcessing: false,
    conditions: [{ kind: "text", target: "text", op: "contains", value: "" }],
    actions: [{ kind: "setCategory", category: "" }],
  };
}

function eurosFromCents(cents: number | undefined): string {
  if (cents === undefined || !Number.isFinite(cents)) return "";
  return String(cents / 100);
}

function draftFromRule(rule: Rule): DraftRule {
  if (!isRuleV2(rule)) {
    return {
      name: "",
      effectiveFrom: "",
      stopProcessing: false,
      conditions: [{ kind: "text", target: "text", op: "contains", value: rule.match }],
      actions: [{ kind: "setCategory", category: rule.category }],
    };
  }
  return {
    name: rule.name ?? "",
    effectiveFrom: rule.effectiveFrom ?? "",
    stopProcessing: rule.stopProcessing ?? false,
    conditions: rule.conditions.map((condition): DraftCondition => {
      if (condition.kind !== "amount") return condition;
      return {
        kind: "amount",
        op: condition.op,
        valueEuros: eurosFromCents(condition.valueCents),
        upperEuros: eurosFromCents(condition.upperCents),
      };
    }),
    actions: rule.actions,
  };
}

function defaultCondition(kind: ConditionKind, firstAccountKey: string): DraftCondition {
  switch (kind) {
    case "text":
      return { kind: "text", target: "text", op: "contains", value: "" };
    case "merchant":
      return { kind: "merchant", op: "contains", value: "" };
    case "amount":
      return { kind: "amount", op: "gt", valueEuros: "", upperEuros: "" };
    case "account":
      return { kind: "account", accountKey: firstAccountKey };
    case "category":
      return { kind: "category", op: "equals", value: "" };
    case "direction":
      return { kind: "direction", direction: "out" };
    case "date":
      return { kind: "date", op: "onOrAfter", from: "", to: "" };
  }
}

function defaultAction(kind: ActionKind): RuleAction {
  switch (kind) {
    case "setCategory":
      return { kind: "setCategory", category: "" };
    case "setDisplayName":
      return { kind: "setDisplayName", displayName: "" };
    case "setMerchant":
      return { kind: "setMerchant", merchant: "" };
    case "addTag":
      return { kind: "addTag", tag: "" };
    case "exclude":
      return { kind: "exclude" };
    case "markTransfer":
      return { kind: "markTransfer" };
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** The first thing that must change before this draft may be stored, or null.
 *  The message is shown inline; nothing is saved on a failed check. */
function draftProblem(draft: DraftRule, c: RegelsCopy): string | null {
  if (draft.conditions.length === 0) return c.validation.needsCondition;
  if (draft.actions.length === 0) return c.validation.needsAction;
  if (draft.effectiveFrom !== "" && !isIsoDate(draft.effectiveFrom)) {
    return c.validation.invalidDate;
  }
  for (const condition of draft.conditions) {
    switch (condition.kind) {
      case "text":
      case "merchant":
        if (condition.value.trim() === "") return c.validation.emptyValue;
        break;
      case "amount":
        if (condition.valueEuros.trim() === "" || !Number.isFinite(Number(condition.valueEuros))) {
          return c.validation.emptyValue;
        }
        if (
          condition.op === "between" &&
          (condition.upperEuros.trim() === "" || !Number.isFinite(Number(condition.upperEuros)))
        ) {
          return c.validation.emptyValue;
        }
        break;
      case "account":
        if (condition.accountKey === "") return c.validation.emptyValue;
        break;
      case "category":
        if (condition.op === "equals" && (condition.value ?? "").trim() === "") {
          return c.validation.emptyValue;
        }
        break;
      case "direction":
        break;
      case "date":
        if (!isIsoDate(condition.from)) return c.validation.invalidDate;
        if (condition.op === "between" && !isIsoDate(condition.to ?? "")) {
          return c.validation.invalidDate;
        }
        break;
    }
  }
  for (const action of draft.actions) {
    switch (action.kind) {
      case "setCategory":
        if (action.category.trim() === "") return c.validation.emptyValue;
        break;
      case "setDisplayName":
        if (action.displayName.trim() === "") return c.validation.emptyValue;
        break;
      case "setMerchant":
        if (action.merchant.trim() === "") return c.validation.emptyValue;
        break;
      case "addTag":
        if (action.tag.trim() === "") return c.validation.emptyValue;
        break;
      case "exclude":
      case "markTransfer":
        break;
    }
  }
  return null;
}

function toRuleCondition(condition: DraftCondition): RuleCondition {
  switch (condition.kind) {
    case "amount": {
      // ADR 0011: integer cents, half away from zero on both signs.
      const valueCents = toCents(Number(condition.valueEuros));
      return condition.op === "between"
        ? {
            kind: "amount",
            op: condition.op,
            valueCents,
            upperCents: toCents(Number(condition.upperEuros)),
          }
        : { kind: "amount", op: condition.op, valueCents };
    }
    case "text":
      return { ...condition, value: condition.value.trim() };
    case "merchant":
      return { ...condition, value: condition.value.trim() };
    case "category":
      return condition.op === "equals"
        ? { kind: "category", op: condition.op, value: (condition.value ?? "").trim() }
        : { kind: "category", op: condition.op };
    case "date":
      return condition.op === "between"
        ? { kind: "date", op: condition.op, from: condition.from, to: condition.to ?? "" }
        : { kind: "date", op: condition.op, from: condition.from };
    case "account":
    case "direction":
      return condition;
  }
}

function toRuleAction(action: RuleAction): RuleAction {
  switch (action.kind) {
    case "setCategory":
      return { kind: "setCategory", category: action.category.trim() };
    case "setDisplayName":
      return { kind: "setDisplayName", displayName: action.displayName.trim() };
    case "setMerchant":
      return { kind: "setMerchant", merchant: action.merchant.trim() };
    case "addTag":
      return { kind: "addTag", tag: action.tag.trim() };
    case "exclude":
    case "markTransfer":
      return action;
  }
}

function toRuleV2(draft: DraftRule, id: string): RuleV2 {
  return {
    v: 2,
    id,
    ...(draft.name.trim() !== "" ? { name: draft.name.trim() } : {}),
    conditions: draft.conditions.map(toRuleCondition),
    actions: draft.actions.map(toRuleAction),
    ...(draft.stopProcessing ? { stopProcessing: true } : {}),
    ...(draft.effectiveFrom !== "" ? { effectiveFrom: draft.effectiveFrom } : {}),
  };
}

/** A stored rule as one readable line. A name wins; otherwise a single text
 *  "contains" (the quick-add and legacy shape) reads as the text it looks for;
 *  anything richer counts its conditions so the row does not lie about them. */
function ruleSummary(rule: Rule, locale: "nl" | "en", c: RegelsCopy): string {
  if (!isRuleV2(rule)) {
    return c.list.legacySummary(rule.match, categoryLabel(locale, rule.category));
  }
  if (rule.name !== undefined && rule.name.trim() !== "") return rule.name.trim();
  const category = rule.actions.find((action) => action.kind === "setCategory")?.category;
  const only = rule.conditions.length === 1 ? rule.conditions[0] : undefined;
  if (category !== undefined && only?.kind === "text" && only.op === "contains") {
    return c.list.textSummary(only.value, categoryLabel(locale, category));
  }
  if (category !== undefined) {
    return c.list.conditionSummary(rule.conditions.length, categoryLabel(locale, category));
  }
  return c.list.conditionOnlySummary(rule.conditions.length);
}

/** Chips under the summary. A legacy row's one category action is shown too, so
 *  every row says what it claims, not only how it matches. */
function ruleChips(rule: Rule, locale: "nl" | "en", c: RegelsCopy): string[] {
  const actions: RuleAction[] = isRuleV2(rule)
    ? rule.actions
    : [{ kind: "setCategory", category: rule.category }];
  if (actions.length === 0) return [c.list.noActions];
  return actions.map((action) => {
    switch (action.kind) {
      case "setCategory":
        return `${c.actions.valueLabels.setCategory}: ${categoryLabel(locale, action.category)}`;
      case "setDisplayName":
        return `${c.actions.valueLabels.setDisplayName}: ${action.displayName}`;
      case "setMerchant":
        return `${c.actions.valueLabels.setMerchant}: ${action.merchant}`;
      case "addTag":
        return `${c.actions.valueLabels.addTag}: ${action.tag}`;
      case "exclude":
        return c.actions.labels.exclude;
      case "markTransfer":
        return c.actions.labels.markTransfer;
    }
  });
}

type RuleEditorProps = {
  draft: DraftRule;
  heading: string;
  c: RegelsCopy;
  accounts: Account[];
  isLegacy: boolean;
  error: string | null;
  busy: boolean;
  onChange: (next: DraftRule) => void;
  onSave: () => void;
  onCancel: () => void;
};

function RuleEditor({
  draft,
  heading,
  c,
  accounts,
  isLegacy,
  error,
  busy,
  onChange,
  onSave,
  onCancel,
}: RuleEditorProps) {
  const setCondition = (index: number, next: DraftCondition) =>
    onChange({
      ...draft,
      conditions: draft.conditions.map((condition, i) => (i === index ? next : condition)),
    });
  const setAction = (index: number, next: RuleAction) =>
    onChange({
      ...draft,
      actions: draft.actions.map((action, i) => (i === index ? next : action)),
    });

  return (
    <div
      className="mt-[var(--sp-4)] border-t border-line pt-[var(--sp-4)]"
      aria-label={c.editor.ariaLabel}
      data-testid="rule-editor"
    >
      <h3>{heading}</h3>
      {isLegacy && <p className="cell-sub">{c.editor.legacyNote}</p>}
      <div className="grid grid-cols-1 gap-[var(--sp-3)] [@media(min-width:760px)]:grid-cols-2">
        <label>
          {c.editor.nameLabel}{" "}
          <input
            value={draft.name}
            placeholder={c.editor.namePlaceholder}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            disabled={busy}
          />
        </label>
        <label>
          {c.editor.effectiveFromLabel}{" "}
          <input
            type="date"
            value={draft.effectiveFrom}
            onChange={(e) => onChange({ ...draft, effectiveFrom: e.target.value })}
            disabled={busy}
          />
        </label>
      </div>
      <p className="cell-sub">{c.editor.effectiveFromHint}</p>

      <h4 className="mt-[var(--sp-4)]">{c.editor.conditionsHeading}</h4>
      {/* The euro hint only has a subject while an amount condition exists. */}
      {draft.conditions.some((condition) => condition.kind === "amount") && (
        <p className="cell-sub">{c.conditions.amountHint}</p>
      )}
      <div data-testid="editor-conditions">
        {draft.conditions.map((condition, index) => (
          <div
            key={index}
            className="mb-[var(--sp-2)] rounded-sm border border-line p-[var(--sp-3)]"
            data-testid="condition-row"
          >
            <div className="flex flex-wrap items-end gap-[var(--sp-2)]">
              <label>
                {c.conditions.kindLabel}{" "}
                <select
                  value={condition.kind}
                  onChange={(e) =>
                    setCondition(
                      index,
                      defaultCondition(e.target.value as ConditionKind, accounts[0]?.key ?? ""),
                    )
                  }
                  disabled={busy}
                >
                  {CONDITION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {c.conditions.kinds[kind]}
                    </option>
                  ))}
                </select>
              </label>
              {condition.kind === "text" && (
                <>
                  <label>
                    {c.conditions.targetLabel}{" "}
                    <select
                      value={condition.target}
                      onChange={(e) =>
                        setCondition(index, { ...condition, target: e.target.value as TextTarget })
                      }
                      disabled={busy}
                    >
                      {TEXT_TARGETS.map((target) => (
                        <option key={target} value={target}>
                          {c.conditions.textTargets[target]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {c.conditions.opLabel}{" "}
                    <select
                      value={condition.op}
                      onChange={(e) =>
                        setCondition(index, { ...condition, op: e.target.value as RuleTextOp })
                      }
                      disabled={busy}
                    >
                      {TEXT_OPS.map((op) => (
                        <option key={op} value={op}>
                          {c.conditions.textOps[op]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {c.conditions.valueLabel}{" "}
                    <input
                      value={condition.value}
                      onChange={(e) => setCondition(index, { ...condition, value: e.target.value })}
                      disabled={busy}
                    />
                  </label>
                </>
              )}
              {condition.kind === "merchant" && (
                <>
                  <label>
                    {c.conditions.opLabel}{" "}
                    <select
                      value={condition.op}
                      onChange={(e) =>
                        setCondition(index, {
                          ...condition,
                          op: e.target.value as "contains" | "equals",
                        })
                      }
                      disabled={busy}
                    >
                      {MERCHANT_OPS.map((op) => (
                        <option key={op} value={op}>
                          {c.conditions.merchantOps[op]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {c.conditions.valueLabel}{" "}
                    <input
                      value={condition.value}
                      onChange={(e) => setCondition(index, { ...condition, value: e.target.value })}
                      disabled={busy}
                    />
                  </label>
                </>
              )}
              {condition.kind === "amount" && (
                <>
                  <label>
                    {c.conditions.opLabel}{" "}
                    <select
                      value={condition.op}
                      onChange={(e) =>
                        setCondition(index, { ...condition, op: e.target.value as RuleAmountOp })
                      }
                      disabled={busy}
                    >
                      {AMOUNT_OPS.map((op) => (
                        <option key={op} value={op}>
                          {c.conditions.amountOps[op]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {c.conditions.valueLabel} (€){" "}
                    <input
                      type="number"
                      step="0.01"
                      value={condition.valueEuros}
                      onChange={(e) =>
                        setCondition(index, { ...condition, valueEuros: e.target.value })
                      }
                      disabled={busy}
                    />
                  </label>
                  {condition.op === "between" && (
                    <label>
                      {c.conditions.upperValueLabel}{" "}
                      <input
                        type="number"
                        step="0.01"
                        value={condition.upperEuros}
                        onChange={(e) =>
                          setCondition(index, { ...condition, upperEuros: e.target.value })
                        }
                        disabled={busy}
                      />
                    </label>
                  )}
                </>
              )}
              {condition.kind === "account" && (
                <label>
                  {c.conditions.accountLabel}{" "}
                  <select
                    value={condition.accountKey}
                    onChange={(e) =>
                      setCondition(index, { ...condition, accountKey: e.target.value })
                    }
                    disabled={busy}
                  >
                    <option value="">—</option>
                    {accounts.map((account) => (
                      <option key={account.key} value={account.key}>
                        {account.name} · {account.key}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {condition.kind === "category" && (
                <>
                  <label>
                    {c.conditions.opLabel}{" "}
                    <select
                      value={condition.op}
                      onChange={(e) =>
                        setCondition(index, {
                          ...condition,
                          op: e.target.value as RuleCategoryOp,
                        })
                      }
                      disabled={busy}
                    >
                      {CATEGORY_OPS.map((op) => (
                        <option key={op} value={op}>
                          {c.conditions.categoryOps[op]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {condition.op === "equals" && (
                    <label>
                      {c.conditions.categoryValueLabel}{" "}
                      <input
                        list="regel-editor-categorieen"
                        value={condition.value ?? ""}
                        onChange={(e) =>
                          setCondition(index, { ...condition, value: e.target.value })
                        }
                        disabled={busy}
                      />
                    </label>
                  )}
                </>
              )}
              {condition.kind === "direction" && (
                <label>
                  {c.conditions.directionLabel}{" "}
                  <select
                    value={condition.direction}
                    onChange={(e) =>
                      setCondition(index, {
                        ...condition,
                        direction: e.target.value as "in" | "out",
                      })
                    }
                    disabled={busy}
                  >
                    {DIRECTIONS.map((direction) => (
                      <option key={direction} value={direction}>
                        {c.conditions.directions[direction]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {condition.kind === "date" && (
                <>
                  <label>
                    {c.conditions.opLabel}{" "}
                    <select
                      value={condition.op}
                      onChange={(e) =>
                        setCondition(index, { ...condition, op: e.target.value as RuleDateOp })
                      }
                      disabled={busy}
                    >
                      {DATE_OPS.map((op) => (
                        <option key={op} value={op}>
                          {c.conditions.dateOps[op]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {c.conditions.fromLabel}{" "}
                    <input
                      type="date"
                      value={condition.from}
                      onChange={(e) => setCondition(index, { ...condition, from: e.target.value })}
                      disabled={busy}
                    />
                  </label>
                  {condition.op === "between" && (
                    <label>
                      {c.conditions.toLabel}{" "}
                      <input
                        type="date"
                        value={condition.to ?? ""}
                        onChange={(e) => setCondition(index, { ...condition, to: e.target.value })}
                        disabled={busy}
                      />
                    </label>
                  )}
                </>
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  onChange({
                    ...draft,
                    conditions: draft.conditions.filter((_, i) => i !== index),
                  })
                }
              >
                {c.conditions.removeButton}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button
        disabled={busy}
        onClick={() =>
          onChange({
            ...draft,
            conditions: [...draft.conditions, defaultCondition("text", "")],
          })
        }
      >
        {c.editor.addConditionButton}
      </Button>

      <h4 className="mt-[var(--sp-4)]">{c.editor.actionsHeading}</h4>
      <p className="cell-sub">{c.editor.categoryOnlyNote}</p>
      <div data-testid="editor-actions">
        {draft.actions.map((action, index) => (
          <div
            key={index}
            className="mb-[var(--sp-2)] rounded-sm border border-line p-[var(--sp-3)]"
            data-testid="action-row"
          >
            <div className="flex flex-wrap items-end gap-[var(--sp-2)]">
              <label>
                {c.actions.kindLabel}{" "}
                <select
                  value={action.kind}
                  onChange={(e) => setAction(index, defaultAction(e.target.value as ActionKind))}
                  disabled={busy}
                >
                  {ACTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {c.actions.labels[kind]}
                    </option>
                  ))}
                </select>
              </label>
              {action.kind === "setCategory" && (
                <label>
                  {c.actions.valueLabels.setCategory}{" "}
                  <input
                    list="regel-actie-categorieen"
                    value={action.category}
                    onChange={(e) =>
                      setAction(index, { kind: "setCategory", category: e.target.value })
                    }
                    disabled={busy}
                  />
                </label>
              )}
              {action.kind === "setDisplayName" && (
                <label>
                  {c.actions.valueLabels.setDisplayName}{" "}
                  <input
                    value={action.displayName}
                    onChange={(e) =>
                      setAction(index, { kind: "setDisplayName", displayName: e.target.value })
                    }
                    disabled={busy}
                  />
                </label>
              )}
              {action.kind === "setMerchant" && (
                <label>
                  {c.actions.valueLabels.setMerchant}{" "}
                  <input
                    value={action.merchant}
                    onChange={(e) =>
                      setAction(index, { kind: "setMerchant", merchant: e.target.value })
                    }
                    disabled={busy}
                  />
                </label>
              )}
              {action.kind === "addTag" && (
                <label>
                  {c.actions.valueLabels.addTag}{" "}
                  <input
                    value={action.tag}
                    onChange={(e) => setAction(index, { kind: "addTag", tag: e.target.value })}
                    disabled={busy}
                  />
                </label>
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  onChange({ ...draft, actions: draft.actions.filter((_, i) => i !== index) })
                }
              >
                {c.actions.removeButton}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button
        disabled={busy}
        onClick={() =>
          onChange({ ...draft, actions: [...draft.actions, defaultAction("setCategory")] })
        }
      >
        {c.editor.addActionButton}
      </Button>

      <label className="mt-[var(--sp-4)] flex items-center gap-[var(--sp-2)]">
        <input
          type="checkbox"
          checked={draft.stopProcessing}
          onChange={(e) => onChange({ ...draft, stopProcessing: e.target.checked })}
          disabled={busy}
        />
        {c.editor.stopProcessingLabel}
      </label>

      {error !== null && (
        <p role="alert" className="text-warn">
          {error}
        </p>
      )}
      <div className="mt-[var(--sp-3)] flex gap-[var(--sp-2)]">
        <Button variant="primary" disabled={busy} onClick={onSave}>
          {c.editor.saveButton}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {c.editor.cancelButton}
        </Button>
      </div>

      <datalist id="regel-editor-categorieen">
        {CATEGORY_OPTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id="regel-actie-categorieen">
        {CATEGORY_OPTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </div>
  );
}

export default function Regels({ rules, txs, accounts, own, busy, onSaveRules }: RegelsProps) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].regels;

  const [match, setMatch] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDryRun, setShowDryRun] = useState(false);

  // Case-insensitive, so "boodschappen" is recognised as the existing category
  // rather than warned about — the warning is for a genuinely new name.
  const typedCategory = category.trim();
  const isNewCategory =
    typedCategory !== "" &&
    !CATEGORY_OPTIONS.some((option) => option.toLowerCase() === typedCategory.toLowerCase());

  /* Same engine, same winner. `dryRunRuleChanges` is injected with
   * `categorizeDetailed` by views.ts, so the preview cannot disagree with what
   * the transactions list shows. Recomputed while open, so reordering a rule
   * updates the result instead of leaving a stale claim on screen. */
  const dryRun: DryRunResult | null = useMemo(
    () => (showDryRun ? dryRunRuleChanges(txs, rules, own) : null),
    [showDryRun, txs, rules, own],
  );

  const editingRule =
    editing !== null && !editing.isNew ? rules.find((rule) => rule.id === editing.id) : undefined;

  function startNew() {
    setEditing({ id: crypto.randomUUID(), isNew: true, draft: emptyDraft() });
    setError(null);
  }

  function startEdit(rule: Rule) {
    setEditing({ id: rule.id, isNew: false, draft: draftFromRule(rule) });
    setError(null);
  }

  function saveDraft() {
    if (editing === null) return;
    const problem = draftProblem(editing.draft, c);
    if (problem !== null) {
      setError(problem);
      return;
    }
    const next = toRuleV2(editing.draft, editing.id);
    onSaveRules(
      editing.isNew
        ? [...rules, next]
        : rules.map((rule) => (rule.id === editing.id ? next : rule)),
    );
    setEditing(null);
    setError(null);
  }

  function moveRule(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    const [row] = next.splice(index, 1);
    if (row === undefined) return;
    next.splice(target, 0, row);
    onSaveRules(next);
  }

  function addQuickRule() {
    const text = match.trim();
    const chosen = category.trim();
    if (text === "" || chosen === "") return;
    const next: RuleV2 = {
      v: 2,
      id: crypto.randomUUID(),
      conditions: [{ kind: "text", target: "text", op: "contains", value: text }],
      actions: [{ kind: "setCategory", category: chosen }],
    };
    onSaveRules([...rules, next]);
    setMatch("");
    setCategory("");
  }

  return (
    <Card as="section" aria-label={c.section.ariaLabel}>
      <h2>{c.section.heading}</h2>
      <p className="cell-sub">{c.intro.autoCategorization}</p>
      <p className="cell-sub">
        {c.intro.matchingRules.beforeMatchWord}
        <em>{c.intro.matchingRules.matchWord}</em>
        {c.intro.matchingRules.beforeFirstWord}
        <strong>{c.intro.matchingRules.firstWord}</strong>
        {c.intro.matchingRules.beforeUnknownWord}
        <em>{c.intro.matchingRules.unknownWord}</em>
        {c.intro.matchingRules.afterUnknownWord}
      </p>
      <p className="cell-sub">{c.intro.priorityNote}</p>
      <p className="cell-sub">{c.intro.categoryOnlyNote}</p>

      <div className="mt-[var(--sp-3)]">
        <label>
          {c.form.matchLabel}{" "}
          <input value={match} onChange={(e) => setMatch(e.target.value)} disabled={busy} />
        </label>{" "}
        <label>
          {c.form.categoryLabel}{" "}
          {/* A list-backed input, not a plain text field: typing a category by hand
              is how a second, near-identical bucket appears in every total
              ("Boodschappen" next to "boodschappen"). The list offers the
              taxonomy the rest of the app already uses — the same one
              applyCategorizations validates the AI's answers against — while
              still allowing a genuinely new category, with the consequence
              spelled out below rather than silently accepted. */}
          <input
            list="regel-categorieen"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={busy}
            placeholder={c.form.categoryPlaceholder}
          />
          <datalist id="regel-categorieen">
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>{" "}
        <Button variant="primary" disabled={busy} onClick={addQuickRule}>
          {c.form.addButton}
        </Button>
      </div>
      {isNewCategory && (
        <p className="cell-sub" role="status">
          {c.newCategoryWarning(typedCategory)}
        </p>
      )}

      <div className="mt-[var(--sp-4)]">
        <div className="mb-[var(--sp-2)] flex flex-wrap items-baseline justify-between gap-[var(--sp-3)]">
          <h3>{c.list.ruleHeader}</h3>
          <Button disabled={busy} onClick={startNew}>
            {c.list.newButton}
          </Button>
        </div>
        {rules.length === 0 ? (
          <p>{c.list.emptyState}</p>
        ) : (
          <TableWrap>
            <Table cards data-testid="rule-list">
              <thead>
                <tr>
                  <Th>{c.list.priorityHeader}</Th>
                  <Th>{c.list.ruleHeader}</Th>
                  <Th>{c.list.actionsHeader}</Th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, index) => {
                  const summary = ruleSummary(rule, locale, c);
                  return (
                    <tr key={rule.id}>
                      <Td>
                        <span className="font-mono text-muted">{index + 1}</span>
                      </Td>
                      <Td>
                        <span>{summary}</span>
                        <span className="mt-[var(--sp-1)] flex flex-wrap gap-[var(--sp-1)]">
                          {ruleChips(rule, locale, c).map((chip, chipIndex) => (
                            <Badge key={chipIndex}>{chip}</Badge>
                          ))}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-[var(--sp-2)]">
                          <Button disabled={busy} onClick={() => startEdit(rule)}>
                            {c.list.editButton}
                          </Button>
                          <Button
                            disabled={busy || index === 0}
                            onClick={() => moveRule(index, -1)}
                          >
                            {c.list.upButton}
                          </Button>
                          <Button
                            disabled={busy || index === rules.length - 1}
                            onClick={() => moveRule(index, 1)}
                          >
                            {c.list.downButton}
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              onSaveRules(rules.filter((candidate) => candidate.id !== rule.id))
                            }
                          >
                            {c.list.deleteButton}
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>

      {editing !== null && (
        <RuleEditor
          draft={editing.draft}
          heading={editing.isNew ? c.editor.newHeading : c.editor.editHeading}
          c={c}
          accounts={accounts}
          isLegacy={editingRule !== undefined && !isRuleV2(editingRule)}
          error={error}
          busy={busy}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onSave={saveDraft}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}

      <div className="mt-[var(--sp-4)] border-t border-line pt-[var(--sp-4)]">
        <div className="flex flex-wrap items-baseline justify-between gap-[var(--sp-3)]">
          <h3>{c.preview.heading}</h3>
          <Button disabled={busy} onClick={() => setShowDryRun(true)}>
            {c.preview.button}
          </Button>
        </div>
        {dryRun !== null && (
          <div data-testid="dry-run">
            {dryRun.totalTxs === 0 ? (
              <p>{c.preview.noTxs}</p>
            ) : (
              <>
                <p>{c.preview.summary(dryRun.matchedTxs, dryRun.totalTxs, dryRun.changed)}</p>
                <p className="cell-sub">{c.preview.sameWinnerNote}</p>
                <p className="cell-sub">{c.preview.categoryOnlyNote}</p>

                <h4 className="mt-[var(--sp-3)]">{c.preview.byRuleHeading}</h4>
                {dryRun.byRule.length === 0 ? (
                  <p className="cell-sub">{c.preview.noMatches}</p>
                ) : (
                  <ul className="m-0 pl-[1.1rem] text-[0.85rem]">
                    {dryRun.byRule.map((row) => {
                      const rule = rules.find((candidate) => candidate.id === row.ruleId);
                      const name =
                        row.name ??
                        (rule !== undefined ? ruleSummary(rule, locale, c) : row.ruleId);
                      return <li key={row.ruleId}>{c.preview.byRuleLine(name, row.matches)}</li>;
                    })}
                  </ul>
                )}

                {dryRun.samples.length > 0 && (
                  <>
                    <h4 className="mt-[var(--sp-3)]">{c.preview.samplesHeading}</h4>
                    <TableWrap>
                      <Table cards data-testid="dry-run-table">
                        <thead>
                          <tr>
                            <Th>{c.preview.sampleHeaders.date}</Th>
                            <Th>{c.preview.sampleHeaders.counterparty}</Th>
                            <Th>{c.preview.sampleHeaders.amount}</Th>
                            <Th>{c.preview.sampleHeaders.current}</Th>
                            <Th>{c.preview.sampleHeaders.next}</Th>
                            <Th>{c.preview.sampleHeaders.rule}</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {dryRun.samples.map((sample) => {
                            const rule = rules.find(
                              (candidate) => candidate.id === sample.decision.ruleId,
                            );
                            return (
                              <tr key={sample.txId}>
                                <Td>{formatDate(locale, sample.date)}</Td>
                                <Td>{sample.counterparty}</Td>
                                <Td className={sample.amountCents >= 0 ? "text-pos" : "text-neg"}>
                                  {formatSignedEuroIn(locale, sample.amountCents / 100)}
                                </Td>
                                <Td>
                                  {categoryLabel(locale, sample.currentCategory || "onbekend")}
                                </Td>
                                <Td>{categoryLabel(locale, sample.decision.category)}</Td>
                                <Td>
                                  {sample.decision.locked ? (
                                    <Badge className="border-warn text-warn">
                                      {c.preview.lockedBadge}
                                    </Badge>
                                  ) : rule !== undefined ? (
                                    ruleSummary(rule, locale, c)
                                  ) : (
                                    c.preview.noRule
                                  )}
                                </Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </TableWrap>
                  </>
                )}
                <p className="cell-sub">{c.preview.lockedNote}</p>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
