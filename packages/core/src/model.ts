import type { CountryCode, VatFrequency } from "./taxpacks/index.js";
// Type-only, dus na compileren blijft er geen import over en ontstaat er geen
// cyclus met crossScope.ts (dat Account/Tx hiervandaan haalt).
import type { CrossScopeAnswer } from "./crossScope.js";

export type Account = {
  key: string;
  iban: string;
  name: string;
  bank: string;
  entity: string;
  currency: string;
  balance: number | null;
  balanceDate?: string;
  type?: string;
  /** Optional annual interest rate (%) for the Optimisatie tab. User-set;
   *  suggested from detected "rente" bijschrijvingen when absent. */
  interestRate?: number;
  /** The owner typed this account's bank/name himself. Set by the rename action
   *  in Rekeningen so a re-import can't undo it — while a name that only ever
   *  came from an old parser stays replaceable by a better one. */
  renamed?: boolean;
  /** WANNEER DEZE REKENING IS GEKOPPELD — en dat is nadrukkelijk iets anders dan
   *  `balanceDate` hierboven.
   *
   *  `balanceDate` zegt hoe oud het BEDRAG is: de dag waarop het saldo gold,
   *  zoals het afschrift of de bank hem meestuurt. Dit veld zegt hoe oud de
   *  KOPPELING is: de dag waarop deze rekening voor het eerst in LaVega kwam.
   *  Die twee liepen op het scherm door elkaar. Bij een bankkoppeling stuurt de
   *  bank vaak geen dag mee, en dan stond er alleen "datum onbekend" — wat leest
   *  als "van deze rekening weten we niets", terwijl we het moment van
   *  binnenkomen prima kenden en gewoon nergens vastlegden. Nu leggen we dat vast,
   *  en blijven het twee aparte zinnen: hoe oud is het bedrag, hoe oud is de
   *  koppeling.
   *
   *  AFWEZIG IS ONBEKEND, NOOIT VANDAAG. Elke rekening die er al stond voordat dit
   *  veld bestond heeft geen koppelmoment. Dat met terugwerkende kracht op de dag
   *  van vandaag zetten zou van een rekening van vorig jaar een verse koppeling
   *  maken — dezelfde verkeerde zekerheid die `balanceDate` ooit gaf toen de dag
   *  van ophalen werd ingevuld voor een saldo van drie weken oud. `withLinkedAt`
   *  stempelt daarom alleen wat aantoonbaar nieuw is; de rest blijft leeg en het
   *  scherm zegt dat het onbekend is. */
  linkedAt?: string;
};

/** Het KOPPELMOMENT stempelen, en alleen daar waar dat te bewijzen valt.
 *
 *  Aanroepen NA het samenvoegen van een import, met de lijst zoals hij VÓÓR die
 *  import was als `existing`. Drie gevallen, en het middelste is het hele punt:
 *
 *  · de rekening kende `existing` niet → hij komt nu binnen, dus `asOf` is het
 *    koppelmoment. Bij een import is dat het moment van importeren, bij een
 *    bankkoppeling het moment van koppelen; voor dit veld is dat hetzelfde feit.
 *  · de rekening stond er al MET een koppelmoment → dat moment blijft staan. Dit
 *    is de reden dat deze functie bestaat en niet één regel in de aanroeper is:
 *    `mergeImportedAccounts` bouwt zijn resultaat op de VERSE rekening
 *    (`{ ...imp }`), en die komt van een parser die geen koppelmoment kent. Zonder
 *    deze overname zou elke her-import het koppelmoment wissen, en de rekening die
 *    hij het vaakst opnieuw inleest zou de rekening zijn die het minst over
 *    zichzelf weet.
 *  · de rekening stond er al ZONDER koppelmoment → hij blijft leeg. Die rekening
 *    is ooit gekoppeld en wij hebben het niet opgeschreven; `asOf` invullen zou
 *    dat gat vullen met een datum die niets meet. Onbekend is geen vandaag.
 *
 *  Puur: `asOf` komt als parameter binnen, er wordt niets geklokt. */
export function withLinkedAt(
  existing: readonly Account[],
  incoming: readonly Account[],
  asOf: string,
): Account[] {
  const before = new Map(existing.map((a) => [a.key, a]));
  return incoming.map((a) => {
    if (a.linkedAt) return a; // al gestempeld: een koppelmoment verschuift nooit
    const prev = before.get(a.key);
    if (!prev) return { ...a, linkedAt: asOf };
    return prev.linkedAt ? { ...a, linkedAt: prev.linkedAt } : a;
  });
}
export type Tx = {
  id: string;
  accountKey: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  category: string;
  manual: boolean;
};
export type Rule = { id: string; match: string; category: string };

/** A signed, dated future cash movement the forecast can see BEFORE the bank
 *  transaction lands (a VAT set-aside, an expected invoice, a manual plan).
 *  amountCents is a POSITIVE magnitude; `sign` gives direction (1 in / -1 out). */
export type ScheduledFlow = {
  id: string;
  entity: string;
  label: string;
  sign: 1 | -1;
  amountCents: number;
  dueDate: string; // ISO YYYY-MM-DD
  /** Where the flow came from. `prepayment` is a profit-tax prepayment or
   *  settlement demanded by the owner's country (see `taxpacks/`) — it is
   *  reserved and forecast exactly like a VAT set-aside, because it is the same
   *  problem: money in the account that was never the owner's. */
  source: "vat" | "invoice" | "manual" | "prepayment";
  status: "expected" | "confirmed" | "paid" | "cancelled";
};

/** An incoming (AR: money owed TO you) or outgoing (AP: you owe) invoice. amount
 *  is DECIMAL euros (gross), Tx-convention. An `expected` invoice projects into a
 *  ScheduledFlow; `paid`/`cancelled` do not (so a paid invoice doesn't
 *  double-count with the bank transaction that settled it). */
export type Invoice = {
  id: string;
  entity: string;
  direction: "in" | "out";
  counterparty: string;
  invoiceNumber?: string;
  issueDate: string; // ISO
  dueDate: string; // ISO
  amount: number; // decimal euros (gross)
  vatAmount?: number;
  currency: string;
  status: "expected" | "paid" | "cancelled";
  matchedTxId?: string;
  sourceType: "manual" | "csv" | "ubl" | "llm";
  /** For `sourceType: "llm"` drafts: the model's OWN self-reported confidence
   *  (0..1), when it gave one — never a fabricated placeholder. Does not affect
   *  invoice identity (see makeInvoice's id-hash). */
  confidence?: number;
  /** BOOKED WITHOUT HIM, and it has to say so on the record itself.
   *
   *  A verified sender with a complete extraction and one candidate entity books
   *  itself. That is a thing that changed his books while he was not looking, so
   *  it must be distinguishable from one he confirmed — for as long as the invoice
   *  exists, not for as long as the tab is open. It lived in localStorage first,
   *  which made "visible as automatic" a promise lasting one reload and left it
   *  out of the encrypted back-up entirely.
   *
   *  Absent means he confirmed it, which is the safe reading: an older invoice
   *  written before this field existed was necessarily confirmed by hand. */
  autoBooked?: boolean;
};

/** Per-entity (per-BV) tax config. Named `VatSettings` because that is all it
 *  held at first; it is now the entity's whole tax setup — which country's rules
 *  apply and, where that country prepays profit tax, how to size the
 *  prepayment. Every field after `manualCents` is optional, so a vault written
 *  before the country packs still decrypts and behaves exactly as it did
 *  (no country = NL). */
export type VatSettings = {
  entity: string;
  frequency: VatFrequency;
  defaultRatePct: number; // e.g. 21
  mixedRates: boolean; // true => don't auto-estimate; manual-only
  manualCents?: number; // manual override of the amount to set aside this period
  /** Which country's rule pack applies. Absent = "NL". */
  country?: CountryCode;
  /** Override of the pack's indicative profit-tax rate (%), e.g. a known
   *  Gewerbesteuer-Hebesatz or a different legal form. */
  profitTaxRatePct?: number;
  /** The amount the tax office actually assessed for one prepayment period, in
   *  cents. Set this and nothing is estimated — an assessment beats a guess. */
  profitTaxManualCents?: number;
  /** Which stelsel this entity files under — a fact only the owner can supply.
   *
   *  It decides whether the BTW on an invoice is due in the period of the
   *  INVOICE (factuurstelsel) or of the PAYMENT (kasstelsel), which is the
   *  difference between an unpaid invoice already owing BTW and owing nothing
   *  yet. Absent means unanswered: the invoice basis is then not used at all
   *  rather than guessed (see `vatPosition`). */
  vatBasis?: "factuurstelsel" | "kasstelsel";
  /** WAT HIJ ZELF ZEI DAT EEN OVERBOEKING OVER DE GRENS WAS — zijn antwoorden op
   *  de vragen die `crossScopeTransfers` stelt, bewaard op de rij van de
   *  ZAKELIJKE onderneming van die stroom (bij elke kruising is precies één kant
   *  zakelijk, dus die keuze is eenduidig).
   *
   *  DIT IS EEN COMPROMIS EN GEEN NET ONTWERP, en dat hoort hier te staan in
   *  plaats van in een commit message. `VatSettings` is een btw-instellingentype
   *  dat hier een niet-btw-feit krijgt. Waarom toch hier:
   *
   *   · een eigen vault-store zou `packages/adapters` raken, en dat is een
   *     andere lane;
   *   · `putVatSettings` is replace-all over een OPTIONEEL VaultData-veld en
   *     `resolveVatSettings` spreidt `...base`, dus een oude vault ontsleutelt
   *     ongewijzigd en een bewaard antwoord overleeft elke opslagronde;
   *   · en — dit is de reden die het écht draagt — `agent/tabContext.ts` bouwt
   *     zijn belasting-context met een EXPLICIETE veldenlijst (entity,
   *     frequency, defaultRatePct, mixedRates, manualCents). Een nieuw veld op
   *     dit type reist daardoor NIET mee naar een model. Dat is precies waarom
   *     de feitenstore afviel: die wordt wél in system prompts gerenderd, en een
   *     antwoord over een overboeking bestaat uit de namen van zijn eigen
   *     ondernemingen.
   *
   *  Wie hier later een echte store voor maakt: dit veld is het migratiepunt.
   *  `crossScopeAnswers` van alle rijen samenvoegen geeft de volledige lijst,
   *  want `CrossScopeAnswer.target` is al vault-breed uniek (een hash). */
  crossScopeAnswers?: CrossScopeAnswer[];
};

/** What `VatSettings` has grown into. Same type, honest name — use this one in
 *  new code; the old name stays because the vault and the web lane use it. */
export type TaxSettings = VatSettings;
