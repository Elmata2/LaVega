import type { Account, ScheduledFlow } from "@lavega/core";
import { availableBalanceCents, reservedCents } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";

/* Totale positie — the reference's "Total balance" card: one big number, the
 * spendable amount under it, and the counts that say what the number covers.
 *
 * Deliberately NOT the reference's credit-card graphic: LaVega shows the real
 * accounts it has, and it has no card art or card number to show. */

type SaldoBlockProps = {
  accounts: Account[];
  scheduledFlows: ScheduledFlow[];
  asOf: string;
  onNavigate: (view: View) => void;
};

export default function SaldoBlock({ accounts, scheduledFlows, asOf, onNavigate }: SaldoBlockProps) {
  const entities = Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0)));
  const unknownCount = accounts.filter((a) => a.balance === null).length;
  // Sum of the KNOWN balances, so the figure is never blank while some CSV
  // accounts still lack a saldo. With unknownCount === 0 this is the exact
  // consolidated position.
  const knownSum = accounts.reduce((s, a) => s + (a.balance ?? 0), 0);
  // Money already earmarked for unpaid BTW. Only worth a line when there is
  // some — otherwise "beschikbaar" would just repeat the number above it.
  const reserved = reservedCents(scheduledFlows, asOf);

  return (
    <Module
      title={`Totale positie${unknownCount > 0 ? " (deels)" : ""}`}
      height="tall"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("accounts")}>
          Rekeningen →
        </button>
      }
    >
      <div className="module-figure">
        <span
          className={`module-figure-value ${accounts.length === 0 ? "" : knownSum >= 0 ? "text-pos" : "text-neg"}`}
        >
          {accounts.length === 0 ? "—" : formatEuro(knownSum)}
        </span>
      </div>
      <p className="module-figure-label">
        {accounts.length === 0
          ? "Importeer een bestand of vul saldo's in."
          : unknownCount > 0
            ? `${unknownCount} rekening${unknownCount > 1 ? "en" : ""} nog zonder saldo — vul in bij Rekeningen.`
            : "Compleet: elke rekening heeft een saldo."}
      </p>

      <div className="block-stats">
        {accounts.length > 0 && reserved > 0 && (
          <div className="block-stat">
            <span className="block-stat-label">Beschikbaar na BTW-reservering</span>
            <span className="block-stat-value">
              {formatEuro(availableBalanceCents(knownSum, scheduledFlows, asOf) / 100)}
            </span>
          </div>
        )}
        <div className="block-stat">
          <span className="block-stat-label">Rekeningen</span>
          <span className="block-stat-value">{accounts.length}</span>
        </div>
        <div className="block-stat">
          <span className="block-stat-label">Entiteiten</span>
          <span className="block-stat-value">{entities.length}</span>
        </div>
      </div>
    </Module>
  );
}
