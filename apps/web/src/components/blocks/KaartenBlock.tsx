import { useMemo } from "react";
import type { Account } from "@lavega/core";
import { accountType } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import { BANK_LOGOS, type BankLogo } from "../../assets/bank-logos.generated.js";
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
 * chart teal/blue).
 *
 * The one thing on the face that is NOT ours is the issuer's own logo, and it is
 * bundled: `scripts/bundle-bank-logos.ts` fetches it during a sweep and writes it
 * into `assets/bank-logos.generated.ts` as a data-URI. The browser therefore
 * fetches nothing — a logo request would tell that server which bank he banks
 * with. A bank whose logo we could not read keeps the name and the colours; it
 * never borrows another bank's mark. Trademarks: see assets/TRADEMARKS.md. */

/** Cards first — that is what the block is called and what he wants to see. */
const TYPE_ORDER = ["Creditcard", "Betaalrekening", "Spaarrekening", "Beleggingsrekening", "Overig"];

/** Four faces, cycled by position. Every stop is an existing token. */
const FACES = [
  "linear-gradient(135deg, var(--ink) 0%, var(--ink-soft) 55%, var(--accent) 100%)",
  "linear-gradient(135deg, var(--accent) 0%, var(--chart-blue) 100%)",
  "linear-gradient(135deg, var(--chart-teal) 0%, var(--accent) 100%)",
  "linear-gradient(135deg, var(--ink-soft) 0%, var(--chart-purple) 100%)",
];

/* Corporate-form words, dropped before matching. `account.bank` arrives as "ING"
 * from a CSV profile, as "ING Bank N.V." from an Enable Banking ASPSP name and as
 * "Coöperatieve Rabobank U.A." from another — all three mean the same issuer. */
const CORPORATE = new Set([
  "bank", "banken", "nv", "bv", "ua", "ag", "sa", "sas", "uab", "gmbh", "as", "ab", "plc", "ltd",
  "limited", "group", "cooperatieve", "cooperatief", "the",
]);

/** The keys a bank name may be known by: the whole name, and the name without
 *  its legal form. Both are compared for EQUALITY against the bundled aliases —
 *  never a substring, so "Rabo" does not become Rabobank and "Bank Van Nergens"
 *  does not become a bank we happen to have a logo for. */
function matchKeys(bank: string): string[] {
  const cleaned = (bank ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "");
  const tokens = cleaned.split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return [];
  const core = tokens.filter((t) => !CORPORATE.has(t));
  const keys = new Set<string>([tokens.join("")]);
  if (core.length) keys.add(core.join(""));
  return [...keys];
}

/** The bundled logo for this bank, or null. Null is a real answer: the card then
 *  shows the name on the existing colours. */
export function bankLogo(bank: string, logos: BankLogo[] = BANK_LOGOS): BankLogo | null {
  const keys = matchKeys(bank);
  if (!keys.length) return null;
  return logos.find((l) => l.aliases.some((a) => keys.includes(a))) ?? null;
}

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
    >
      {cards.length === 0 ? (
        <p className="block-empty">Nog geen rekeningen gekoppeld — importeer een bestand of koppel een bank.</p>
      ) : (
        <div className="card-strip">
          {cards.map(({ account, type }, i) => {
            const tail = ibanTail(account.iban);
            const logo = bankLogo(account.bank);
            return (
              <article
                className="bank-card"
                key={account.key}
                style={{ background: FACES[i % FACES.length] }}
                aria-label={`${account.bank || "Onbekende bank"} · ${type}`}
              >
                <header className="bank-card-top">
                  <span className="bank-card-bank">
                    {logo ? (
                      /* Decorative: the bank's name is right next to it, so a
                       * screen reader should not read the mark twice. The white
                       * chip keeps every logo legible on all four card faces. */
                      <img
                        src={logo.dataUri}
                        alt=""
                        width={16}
                        height={16}
                        style={{
                          width: 16,
                          height: 16,
                          objectFit: "contain",
                          background: "#fff",
                          borderRadius: 3,
                          padding: 1,
                          marginRight: 6,
                          verticalAlign: "-3px",
                        }}
                      />
                    ) : null}
                    {account.bank || "Onbekende bank"}
                  </span>
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
