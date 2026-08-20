import type { Rule } from "@lavega/core";
import { CATEGORY_OPTIONS } from "@lavega/core";

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
  // Case-insensitive, so "boodschappen" is recognised as the existing category
  // rather than warned about — the warning is for a genuinely new name.
  const typed = ruleCategory.trim();
  const isNewCategory =
    typed !== "" && !CATEGORY_OPTIONS.some((c) => c.toLowerCase() === typed.toLowerCase());

  return (
    <section className="card" aria-label="Regels">
      <h2>Regels</h2>
      <p className="cell-sub">
        LaVega categoriseert transacties automatisch met een ingebouwde Nederlandse
        lijst (Albert Heijn → Boodschappen, NS → Transport, Netflix → Entertainment,
        enz.). Je eigen regels hieronder gaan vóór die automatische categorieën.
      </p>
      <p className="cell-sub">
        Een regel matcht als de <em>match</em>-tekst ergens in de tegenpartij of de omschrijving
        voorkomt, en de <strong>eerste</strong> regel die past wint — een korte match als "spar"
        raakt dus ook "sparen". Zie je een transactie als <em>onbekend</em> staan bij Transacties?
        Daar staat er ook bij wáárom, en dat is meestal de tekst waar je hier een regel op maakt.
      </p>
      <label>
        Match{" "}
        <input value={ruleMatch} onChange={(e) => onRuleMatchChange(e.target.value)} disabled={busy} />
      </label>
      {" "}
      <label>
        Categorie{" "}
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
          placeholder="Kies of typ een categorie"
        />
        <datalist id="regel-categorieen">
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
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

      {isNewCategory && (
        <p className="cell-sub" role="status">
          "{ruleCategory.trim()}" staat niet in de lijst. Dat mag, maar het wordt dan een aparte
          categorie in élk overzicht — ook als je een bestaande bedoelde met een andere spelling.
        </p>
      )}

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
