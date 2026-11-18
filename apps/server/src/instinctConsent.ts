/* The consent the user gives when they turn the daily message on. Changing the
 * sentence below, or what the agent does with the data, bumps the version, so an
 * earlier consent never stands for a different promise. The web copy
 * (apps/web/src/copy/instinct.ts) carries the same sentences for the screen. */
export const CONSENT_VERSION = "2026-11-v3";

export const CONSENT_TEXT_NL =
  "LaVega leest elke ochtend je transacties en saldi van de laatste 90 dagen bij je bank, zonder dat jij erbij bent, om hoogstens één melding per dag te maken. Die transacties en saldi bewaren we niet. Wel bewaren we je instellingen, een kopie van je categorieregels en naderende deadlines die je browser ons doorgeeft, en de meldingen zelf, 90 dagen. Een melding kan de naam van een tegenpartij, een bedrag en een datum noemen en komt via de kanalen die jij kiest: in LaVega, per e-mail, via WhatsApp of als pushmelding. Een pushmelding zegt alleen dat er een bericht is; de inhoud lees je in LaVega of in je e-mail. Je kunt dit op elk moment uitzetten; dan verwijderen we alles. Meer staat in het privacybeleid.";
export const CONSENT_TEXT_EN =
  "Each morning LaVega reads your transactions and balances from the last 90 days at your bank, without you being there, to make at most one message a day. We do not store those transactions and balances. We do store your settings, a copy of your category rules and upcoming deadlines that your browser passes to us, and the messages themselves, for 90 days. A message can name a counterparty, an amount and a date and arrives through the channels you choose: in LaVega, by email, via WhatsApp or as a push notification. A push notification only says there is a message; you read the content in LaVega or in your email. You can turn this off at any time; we then delete everything. More is in the privacy policy.";
