import { useMemo } from "react";
import type { Account } from "@lavega/core";
import { accountType } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import { BANK_LOGOS, type BankLogo } from "../../assets/bank-logos.generated.js";
import useBrandRamps from "../../useBrandRamps.js";
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
 * never borrows another bank's mark. Trademarks: see assets/TRADEMARKS.md.
 *
 * DE KLEUR KOMT UIT DAT LOGO. Zijn vraag was: de echte kaart nadoen, of een
 * gradient in de kleur van het logo. Dit is de tweede — een ING-kaart is oranje
 * omdat het ING-logo oranje IS, uitgelezen uit de gebundelde data-URI en nergens
 * opgehaald (brandColors.ts). De artwork van een kaart natekenen is een ontwerp
 * overnemen, en dat is een ander verhaal dan een logo gebruiken om te zeggen
 * welk product je bedoelt.
 *
 * Een logo zonder kleur — zwart-wit, of een logo dat we niet konden lezen —
 * houdt het tokenvlak uit FACES. Dat is geen tijdelijke staat maar het antwoord
 * voor die kaart: er is geen huisstijlkleur om te tonen.
 *
 * REVIEW 4, PUNT 10: "make it like a bit more gradient, and that I can hover
 * over it." Allebei gedaan, en allebei met dezelfde ondergrens: het saldo moet
 * leesbaar blijven. Het verloop is dieper geworden aan de DONKERE kant (vier
 * stops, `cardRamp` in brandFace.ts, en drie in FACES hieronder), want de lichte
 * kant staat al precies op de 4,5:1 die de tekst nodig heeft. De hover-toestand
 * staat in blocks.css en verandert dáárom geen kleur maar diepte. Geen
 * transition: een toestand mag, een overgang is motion en die gaat apart. */

/** Cards first — that is what the block is called and what he wants to see. */
const TYPE_ORDER = [
  "Creditcard",
  "Betaalrekening",
  "Spaarrekening",
  "Beleggingsrekening",
  "Overig",
];

/** Four faces, cycled by position. Every stop is an existing token.
 *
 *  DRIE STOPS, NIET TWEE, en alledrie beginnen ze donker. Dat is dezelfde
 *  ingreep als in `cardRamp` (brandFace.ts) en om dezelfde reden: een verloop
 *  wordt sterker door zijn bereik, en het bereik kan alleen naar de donkere kant
 *  groeien omdat de lichte kant de leesbaarheid van het saldo draagt. Twee van
 *  deze vier liepen van accent naar chart-blue en van teal naar accent — dat zijn
 *  kleuren die dicht bij elkaar liggen, dus het verloop was er nauwelijks. */
const FACES = [
  "linear-gradient(135deg, var(--ink) 0%, var(--ink-soft) 38%, var(--accent) 100%)",
  "linear-gradient(135deg, var(--ink) 0%, var(--accent) 45%, var(--chart-blue) 100%)",
  "linear-gradient(135deg, var(--ink) 0%, var(--chart-teal) 45%, var(--accent) 100%)",
  "linear-gradient(135deg, var(--ink) 0%, var(--ink-soft) 38%, var(--chart-purple) 100%)",
];

/* Corporate-form words, dropped before matching. `account.bank` arrives as "ING"
 * from a CSV profile, as "ING Bank N.V." from an Enable Banking ASPSP name and as
 * "Coöperatieve Rabobank U.A." from another — all three mean the same issuer. */
const CORPORATE = new Set([
  "bank",
  "banken",
  "nv",
  "bv",
  "ua",
  "ag",
  "sa",
  "sas",
  "uab",
  "gmbh",
  "as",
  "ab",
  "plc",
  "ltd",
  "limited",
  "group",
  "cooperatieve",
  "cooperatief",
  "the",
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

/** Waar de glans moet staan als de cursor op (x, y) binnen `rect` zit.
 *
 *  Puur en apart, want dit is het enige rekenwerk in de hele interactie en het
 *  is met een muis niet te toetsen. Het antwoord is een transform-string omdat
 *  die rechtstreeks op het element wordt gezet: een CSS-variabele op de KAART
 *  zou de stijl van elk kind laten hertekenen bij elke muisbeweging, en een
 *  kaart heeft er een stuk of acht. */
export function sheenTransform(
  rect: { left: number; top: number },
  clientX: number,
  clientY: number,
): string {
  const x = Math.round(clientX - rect.left);
  const y = Math.round(clientY - rect.top);
  return `translate3d(${x}px, ${y}px, 0)`;
}

type KaartenBlockProps = {
  accounts: Account[];
  onNavigate: (view: View) => void;
};

export default function KaartenBlock({ accounts, onNavigate }: KaartenBlockProps) {
  const ramps = useBrandRamps();
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
      title="Kaarten"
      span={3}
      height="short"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("accounts")}>
          Rekeningen →
        </button>
      }
    >
      {cards.length === 0 ? (
        <p className="block-empty">
          Nog geen rekeningen gekoppeld — importeer een bestand of koppel een bank.
        </p>
      ) : (
        <div className="card-strip">
          {cards.map(({ account, type }, i) => {
            const tail = ibanTail(account.iban);
            const logo = bankLogo(account.bank);
            // De eigen huisstijl waar die bestaat, anders het tokenvlak.
            const face = (logo ? ramps[logo.slug]?.gradient : undefined) ?? FACES[i % FACES.length];
            return (
              <article
                className="bank-card"
                key={account.key}
                style={{ background: face }}
                aria-label={`${account.bank || "Onbekende bank"} · ${type}`}
                /* De glans volgt de cursor. De transform gaat RECHTSTREEKS op de
                 * laag en niet via React-state: bij state zou elke muisbeweging
                 * een render van de hele kaartenrij zijn. Zo raakt hij alleen
                 * zichzelf, en blijft hij op de GPU. */
                onPointerMove={(e) => {
                  if (e.pointerType !== "mouse") return;
                  const sheen = e.currentTarget.querySelector<HTMLElement>(".bank-card-sheen");
                  if (!sheen) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  sheen.style.transform = sheenTransform(r, e.clientX, e.clientY);
                }}
              >
                {/* Puur decoratief: een schermlezer heeft niets aan een lichtvlek. */}
                <span className="bank-card-sheen" aria-hidden="true" />
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
                  <div className="bank-card-who">
                    <div className="bank-card-caption">Op naam van</div>
                    <div className="bank-card-holder" title={account.entity || undefined}>
                      {account.entity || "geen entiteit ingesteld"}
                    </div>
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
