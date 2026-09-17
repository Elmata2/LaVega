import { useMemo } from "react";
import type { Rule } from "@lavega/core";
import { CATEGORY_OPTIONS } from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import { adminCopy } from "../copy/admin.js";
import { categoryLabel } from "../copy/money.js";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import { Table, TableWrap, Th, Td } from "../components/ui/Table.js";

type RegelsProps = {
  rules: Rule[];
  busy: boolean;
  ruleMatch: string;
  onRuleMatchChange: (match: string) => void;
  ruleCategory: string;
  onRuleCategoryChange: (category: string) => void;
  onSaveRules: (next: Rule[]) => void;
};

export default function Regels({
  rules,
  busy,
  ruleMatch,
  onRuleMatchChange,
  ruleCategory,
  onRuleCategoryChange,
  onSaveRules,
}: RegelsProps) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].regels;

  // Case-insensitive, so "boodschappen" is recognised as the existing category
  // rather than warned about — the warning is for a genuinely new name.
  const typed = ruleCategory.trim();
  const isNewCategory =
    typed !== "" &&
    !CATEGORY_OPTIONS.some((option) => option.toLowerCase() === typed.toLowerCase());

  /* ALPHABETICAL FOR READING, ORIGINAL ORDER FOR MATCHING.
   *
   * categorize() walks the rules in stored order and returns the FIRST match, so
   * the order is semantic: a specific rule has to sit ahead of a general one.
   * Sorting the array itself would therefore change which rule wins without
   * anything on screen saying so. This sorts a COPY, and the delete button still
   * filters the original, so nothing here can reorder what matches.
   *
   * localeCompare with "nl" so accented merchant names land where a Dutch reader
   * expects, and numeric so "Regel 2" precedes "Regel 10". */
  const sortedRules = useMemo(
    () =>
      [...rules].sort(
        (a, b) =>
          a.match.localeCompare(b.match, "nl", { sensitivity: "base", numeric: true }) ||
          a.category.localeCompare(b.category, "nl", { sensitivity: "base" }),
      ),
    [rules],
  );

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
      <label>
        {c.form.matchLabel}{" "}
        <input
          value={ruleMatch}
          onChange={(e) => onRuleMatchChange(e.target.value)}
          disabled={busy}
        />
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
          value={ruleCategory}
          onChange={(e) => onRuleCategoryChange(e.target.value)}
          disabled={busy}
          placeholder={c.form.categoryPlaceholder}
        />
        <datalist id="regel-categorieen">
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>{" "}
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => {
          const match = ruleMatch.trim();
          const category = ruleCategory.trim();
          if (!match || !category) return;
          void onSaveRules([...rules, { id: crypto.randomUUID(), match, category }]);
          onRuleMatchChange("");
          onRuleCategoryChange("");
        }}
      >
        {c.form.addButton}
      </Button>
      {isNewCategory && (
        <p className="cell-sub" role="status">
          {c.newCategoryWarning(ruleCategory.trim())}
        </p>
      )}
      {rules.length === 0 ? (
        <p>{c.table.emptyState}</p>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{c.table.matchHeader}</Th>
                <Th>{c.table.categoryHeader}</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {sortedRules.map((rule) => (
                <tr key={rule.id}>
                  <Td>{rule.match}</Td>
                  <Td>{categoryLabel(locale, rule.category)}</Td>
                  <Td>
                    <Button
                      disabled={busy}
                      onClick={() => void onSaveRules(rules.filter((r) => r.id !== rule.id))}
                    >
                      {c.table.deleteButton}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {rules.length > 1 && (
            <p className="cell-sub" style={{ marginTop: ".5rem" }}>
              {c.table.sortNote}
            </p>
          )}
        </TableWrap>
      )}
    </Card>
  );
}
