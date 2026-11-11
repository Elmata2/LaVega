/* Copy for the cash-flow suggestion panel (issue #137, Jev-04).
 *
 * The investing SPA is English by convention (`.claude/skills/verify-investing/
 * features/README.md` says so). This panel is the first surface the OWNER uses
 * to confirm something about his own ledger, so it ships in his language when
 * the shared `lavega_locale` cookie says Dutch and in English otherwise. The
 * cookie is the same one the personal app sets; on the standalone investing
 * server there is no cookie and the panel stays English.
 *
 * One typed object per locale, no runtime translation machinery: the two
 * objects must have the same shape, and TypeScript enforces it. */

export type InvestingLocale = "nl" | "en";

/** The personal app's cookie; absent or non-nl falls back to English. */
export function readInvestingLocale(
  cookie: string = typeof document === "undefined" ? "" : document.cookie,
): InvestingLocale {
  const match = /(?:^|;\s*)lavega_locale=([^;]+)/.exec(cookie);
  return match?.[1]?.toLowerCase().startsWith("nl") ? "nl" : "en";
}

export function investingLocaleTag(locale: InvestingLocale): string {
  return locale === "nl" ? "nl-NL" : "en-GB";
}

export type CashFlowKindCopy = {
  deposit: string;
  withdrawal: string;
  interest: string;
  fee: string;
  other: string;
};

export type CashFlowCopy = {
  title: string;
  description: string;
  enabledLabel: string;
  enabledHint: string;
  disabledNote: string;
  waiting: (count: number) => string;
  waitingHint: string;
  noPending: string;
  loadFailed: string;
  toggleFailed: string;
  broker: string;
  rawType: string;
  confidence: (percent: string) => string;
  descriptionLabel: string;
  amountLabel: string;
  signIn: string;
  signOut: string;
  suggestedKind: string;
  correctKind: string;
  confirm: string;
  confirmSignChange: string;
  reject: string;
  signChangeTitle: string;
  signChangeBody: (before: string, after: string) => string;
  signChangeAcknowledge: string;
  signChangeRequired: string;
  confirmFailed: string;
  rejectFailed: string;
  rulesTitle: string;
  rulesHint: string;
  rulesEmpty: string;
  ruleConfirmedAt: (date: string) => string;
  remove: string;
  removeFailed: string;
  kindLabels: CashFlowKindCopy;
  kinds: CashFlowKindCopy;
};

const nl: CashFlowCopy = {
  title: "Cashflow-suggesties",
  description:
    "Je broker gebruikt soms een transactietype dat LaVega niet kent. Een suggestie stelt een soort voor; pas als jij bevestigt, geldt die voor dat type bij die broker. Zonder bevestiging verandert er niets aan je cijfers.",
  enabledLabel: "Cashflow-suggesties",
  enabledHint:
    "Standaard uit. Aan betekent: na een sync vraagt LaVega een model om een soort voor onbekende typen.",
  disabledNote: "Suggesties staan uit. Er wordt niets voorgesteld en er verandert niets.",
  waiting: (count) => `${count} wacht${count === 1 ? "" : "en"} op bevestiging`,
  waitingHint: "Eén regel per onbekend type; elk type kan meerdere transacties raken.",
  noPending: "Geen openstaande suggesties.",
  loadFailed: "Suggesties konden niet worden geladen.",
  toggleFailed: "De schakelaar kon niet worden opgeslagen.",
  broker: "Broker",
  rawType: "Type van je broker",
  confidence: (percent) => `Zekerheid ${percent}`,
  descriptionLabel: "Omschrijving",
  amountLabel: "Bedrag en teken",
  signIn: "geld in",
  signOut: "geld uit",
  suggestedKind: "Voorgesteld soort",
  correctKind: "Klopt niet? Kies het juiste soort",
  confirm: "Bevestig soort",
  confirmSignChange: "Bevestig tekenwijziging",
  reject: "Afwijzen",
  signChangeTitle: "Let op: dit verandert het teken",
  signChangeBody: (before, after) =>
    `Bevestigen zet ${before} om naar ${after}. Dat verandert de cashflow-reeks en dus je rendement. Doe dit alleen als het teken van de broker voor dit type onjuist is.`,
  signChangeAcknowledge: "Ik begrijp dat dit het teken verandert en bevestig het bewust",
  signChangeRequired: "Vink eerst de tekenwijziging aan.",
  confirmFailed: "Bevestigen mislukte.",
  rejectFailed: "Afwijzen mislukte.",
  rulesTitle: "Bevestigde regels",
  rulesHint:
    "Deze regels gelden bij elke volgende sync, zonder model. Je kunt ze hier verwijderen.",
  rulesEmpty: "Nog geen bevestigde regels.",
  ruleConfirmedAt: (date) => `bevestigd ${date}`,
  remove: "Verwijderen",
  removeFailed: "Verwijderen mislukte.",
  kindLabels: {
    deposit: "Storting",
    withdrawal: "Opname",
    interest: "Rente",
    fee: "Kosten",
    other: "Overig",
  },
  kinds: {
    deposit: "Storting (geld in)",
    withdrawal: "Opname (geld uit)",
    interest: "Rente",
    fee: "Kosten",
    other: "Overig",
  },
};

const en: CashFlowCopy = {
  title: "Cash-flow suggestions",
  description:
    "Your broker sometimes uses a transaction type LaVega does not know. A suggestion proposes a kind; it only applies to that type at that broker after you confirm it. Nothing changes in your figures until then.",
  enabledLabel: "Cash-flow suggestions",
  enabledHint:
    "Off by default. On means: after a sync LaVega asks a model for a kind for unknown types.",
  disabledNote: "Suggestions are off. Nothing is proposed and nothing changes.",
  waiting: (count) => `${count} waiting for confirmation`,
  waitingHint: "One row per unknown type; one type can cover several transactions.",
  noPending: "No suggestions waiting.",
  loadFailed: "Suggestions could not be loaded.",
  toggleFailed: "The switch could not be saved.",
  broker: "Broker",
  rawType: "Broker's type",
  confidence: (percent) => `Confidence ${percent}`,
  descriptionLabel: "Description",
  amountLabel: "Amount and sign",
  signIn: "cash in",
  signOut: "cash out",
  suggestedKind: "Suggested kind",
  correctKind: "Wrong? Pick the correct kind",
  confirm: "Confirm kind",
  confirmSignChange: "Confirm sign change",
  reject: "Reject",
  signChangeTitle: "Careful: this changes the sign",
  signChangeBody: (before, after) =>
    `Confirming turns ${before} into ${after}. That changes the cash-flow series and therefore your returns. Do this only if the broker's sign is wrong for this type.`,
  signChangeAcknowledge: "I understand this changes the sign and confirm it deliberately",
  signChangeRequired: "Tick the sign-change box first.",
  confirmFailed: "Confirmation failed.",
  rejectFailed: "Rejection failed.",
  rulesTitle: "Confirmed rules",
  rulesHint:
    "These rules apply on every later sync, with no model involved. You can remove them here.",
  rulesEmpty: "No confirmed rules yet.",
  ruleConfirmedAt: (date) => `confirmed ${date}`,
  remove: "Remove",
  removeFailed: "Removal failed.",
  kindLabels: {
    deposit: "Deposit",
    withdrawal: "Withdrawal",
    interest: "Interest",
    fee: "Fee",
    other: "Other",
  },
  kinds: {
    deposit: "Deposit (cash in)",
    withdrawal: "Withdrawal (cash out)",
    interest: "Interest",
    fee: "Fee",
    other: "Other",
  },
};

export const cashFlowCopy: Record<InvestingLocale, CashFlowCopy> = { nl, en };
