import type { Rule } from "@lavega/core";

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
  return (
    <section className="card" aria-label="Regels">
      <h2>Regels</h2>
      <label>
        Match{" "}
        <input value={ruleMatch} onChange={(e) => onRuleMatchChange(e.target.value)} disabled={busy} />
      </label>
      {" "}
      <label>
        Categorie{" "}
        <input value={ruleCategory} onChange={(e) => onRuleCategoryChange(e.target.value)} disabled={busy} />
      </label>
      {" "}
      <button
        type="button"
        className="btn btn-primary"
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
        Toevoegen
      </button>

      {rules.length === 0 ? (
        <p>Nog geen regels.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Categorie</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.match}</td>
                  <td>{rule.category}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void onSaveRules(rules.filter((r) => r.id !== rule.id))}
                    >
                      Verwijderen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
