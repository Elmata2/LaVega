import { useMemo } from "react";
import type { Account } from "@lavega/core";
import { accountType } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";

/* Je kaarten — the card-art strip from `Modules for homescreen 5/7.png`.
 *
 * Alexander's point: it does little functionally and is worth a lot, because it
 * shows at a glance WHICH cards are connected. So it is presentational — and
 * everything on the face is something LaVega actually holds.
 *
 * What is deliberately NOT here: a card number. The references print
 * "3455 4562 7710 3507" across the plastic; LaVega has never seen a PAN and
 * never will (read-only PSD2 access does not carry one), so printing sixteen
 * digits would be inventing them. What it does have is the IBAN, and the last
 * four of the REAL IBAN go on the face where the reference puts the number.
 * An account with no IBAN — an Amex or Trading 212 file-import keyed by
 * filename — says "geen IBAN bekend" instead of showing a filler.
 *
 * The "card holder" is the entity the account belongs to, which is the closest
 * thing to a holder LaVega knows. An account with no entity says so.
 *
 * The art uses the app's own tokens (the dark nav ink, the aegean accent, the
 * chart teal/blue). No purple, no brand mark. */

/** Cards first — that is what the block is called and what he wants to see. */
const TYPE_ORDER = ["Creditcard", "Betaalrekening", "Spaarrekening", "Beleggingsrekening", "Overig"];

/** Four faces, cycled by position. Every stop is an existing token. */
const FACES = [
  "linear-gradient(135deg, var(--ink) 0%, var(--ink-soft) 55%, var(--accent) 100%)",
  "linear-gradient(135deg, var(--accent) 0%, var(--chart-blue) 100%)",
  "linear-gradient(135deg, var(--chart-teal) 0%, var(--accent) 100%)",
  "linear-gradient(135deg, var(--ink-soft) 0%, var(--chart-purple) 100%)",
];

/** The last four characters of a real IBAN, or null when there is no IBAN.
 *  Never a placeholder — an unknown number is stated, not filled in. */
export function ibanTail(iban: string): string | null {
  const clean = (iban ?? "").replace(/\s+/g, "");
  return clean.length >= 4 ? clean.slice(-4) : null;
}

type KaartenBlockProps = {
  accounts: Account[];
  onNavigate: (view: View) => void;
};

export default function KaartenBlock({ accounts, onNavigate }: KaartenBlockProps) {
  const cards = useMemo(
    () =>
      accounts
        .map((a) => ({ account: a, type: accountType(a) }))
        .sort((a, b) => {
          const ta = TYPE_ORDER.indexOf(a.type);
          const tb = TYPE_ORDER.indexOf(b.type);
          return (ta < 0 ? TYPE_ORDER.length : ta) - (tb < 0 ? TYPE_ORDER.length : tb);
        }),
    [accounts],
  );

  return (
    <Module
      title="Je kaarten"
      span={3}
      height="short"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("accounts")}>
          Rekeningen →
        </button>
      }
      footer={
        cards.length > 0
          ? "Alleen wat LaVega echt weet: de bank, het soort rekening en de laatste vier cijfers van je eigen IBAN. Een kaartnummer heeft LaVega niet."
          : undefined
      }
    >
      {cards.length === 0 ? (
        <p className="block-empty">Nog geen rekeningen gekoppeld — importeer een bestand of koppel een bank.</p>
      ) : (
        <div className="card-strip">
          {cards.map(({ account, type }, i) => {
            const tail = ibanTail(account.iban);
            return (
              <article
                className="bank-card"
                key={account.key}
                style={{ background: FACES[i % FACES.length] }}
                aria-label={`${account.bank || "Onbekende bank"} · ${type}`}
              >
                <header className="bank-card-top">
                  <span className="bank-card-bank">{account.bank || "Onbekende bank"}</span>
                  <span className="bank-card-type">{type}</span>
                </header>

                <div className="bank-card-number">
                  {tail ? (
                    <>
                      <span aria-hidden="true">•••• •••• ••••</span> {tail}
                    </>
                  ) : (
                    <span className="bank-card-unknown">geen IBAN bekend</span>
                  )}
                </div>

                <footer className="bank-card-bottom">
                  <div>
                    <div className="bank-card-caption">Op naam van</div>
                    <div className="bank-card-holder">{account.entity || "geen entiteit ingesteld"}</div>
                  </div>
                  <div className="bank-card-saldo">
                    <div className="bank-card-caption">Saldo</div>
                    <div className={account.balance === null ? "bank-card-unknown" : ""}>
                      {account.balance === null ? "onbekend" : formatEuro(account.balance)}
                    </div>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </Module>
  );
}
