import type { Locale } from "../locale.js";

/**
 * The words around the daily message switch in settings. The message texts
 * themselves live in packages/core/src/instinct/copy.ts, because the server
 * renders them for push and email without a browser.
 */
export type InstinctSettingsCopy = {
  title: string;
  /** Exact consent sentence; the NL one is pinned by Global Constraints. */
  consent: string;
  consentCheckbox: string;
  switchLabel: string;
  channelsLabel: string;
  channels: { feed: string; push: string; email: string };
  timeLabel: string;
  timeNotice: string;
  noBank: string;
  storedHeading: string;
  storedEmpty: string;
  deleteItem: string;
  turnOffConfirm: string;
  turnOffConfirmYes: string;
  turnOffConfirmNo: string;
  /** The only label sent to the server for a non-VAT due date: no supplier names leave the vault. */
  mirrorOtherDue: string;
  turnOn: string;
  turnOff: string;
  save: string;
  saved: string;
  loading: string;
  unavailable: string;
  loadFailed: string;
  saveFailed: string;
  signInNeeded: string;
  bankRequired: string;
  bankLink: string;
  offNote: string;
  inAppAlways: string;
  pushDenied: string;
  pushUnsupported: string;
  pushFailed: string;
  emailLabel: string;
  emailInvalid: string;
  whatsapp: string;
  whatsappNeedsOn: string;
  whatsappNeedsLink: string;
  whatsappLinked: (phone: string) => string;
  whatsappLink: string;
  /** Required tick before a link code is made: WhatsApp questions go to Mistral (EU). */
  whatsappAiConsent: string;
  whatsappUnlink: string;
  whatsappSend: (number: string | null) => string;
  whatsappCodeLabel: string;
  whatsappExpires: (time: string) => string;
  whatsappWaiting: string;
  whatsappLinkedNow: string;
  whatsappTimedOut: string;
  whatsappClose: string;
  whatsappLinkFailed: string;
  whatsappUnlinkFailed: string;
  reconsentTitle: string;
  reconsentBody: string;
  reconsentButton: string;
  feed: {
    title: string;
    intro: string;
    empty: string;
    loadMore: string;
    loadFailed: string;
    deleteFailed: string;
    unavailable: string;
    settingsLink: string;
    whatsappTitle: string;
    whatsappEmpty: string;
    deleteConversation: string;
    deleteConversationConfirm: string;
    deleteConversationYes: string;
    deleteConversationNo: string;
    conversationDeleted: string;
    conversationDeleteFailed: string;
  };
  overview: { title: string; body: string; open: string };
};

export const instinctCopy: Record<Locale, InstinctSettingsCopy> = {
  nl: {
    title: "Dagelijkse melding",
    consent:
      "LaVega leest elke nacht je transacties om je meldingen te sturen, en bewaart ze niet.",
    consentCheckbox: "Ik snap dit en geef toestemming",
    switchLabel: "Stuur me een dagelijkse melding",
    channelsLabel: "Waar wil je de melding?",
    channels: { feed: "In LaVega", push: "Pushmelding", email: "E-mail" },
    timeLabel: "Tijdstip",
    timeNotice: "Meldingen komen op je gekozen tijd, nooit eerder",
    noBank: "Koppel eerst een bank, dan kun je dit aanzetten.",
    storedHeading: "Wat LaVega bewaart",
    storedEmpty: "Er is niets bewaard.",
    deleteItem: "Verwijder",
    turnOffConfirm: "Uitzetten verwijdert alles wat LaVega op de server voor deze functie bewaart.",
    turnOffConfirmYes: "Zet uit en verwijder",
    turnOffConfirmNo: "Annuleer",
    mirrorOtherDue: "Betaling te doen",
    turnOn: "Zet aan",
    turnOff: "Zet uit",
    save: "Bewaar instellingen",
    saved: "Bewaard.",
    loading: "Instellingen laden...",
    unavailable: "Meldingen zijn nu niet beschikbaar.",
    loadFailed: "De instellingen konden niet worden geladen.",
    saveFailed: "Bewaren is niet gelukt. Probeer het zo nog eens.",
    signInNeeded: "Log in om dagelijkse meldingen in te stellen.",
    bankRequired: "Koppel eerst een bank, dan kun je dit aanzetten.",
    bankLink: "Naar Rekeningen",
    offNote: "Je kunt dit op elk moment uitzetten. Uitzetten verwijdert de kopie op de server.",
    inAppAlways: "Altijd aan zolang de melding aan staat",
    pushDenied:
      "Je browser blokkeert meldingen voor LaVega. Sta ze toe in de browserinstellingen en probeer het opnieuw.",
    pushUnsupported: "Deze browser ondersteunt geen pushmeldingen.",
    pushFailed: "Pushmeldingen aanzetten is niet gelukt.",
    emailLabel: "E-mailadres",
    emailInvalid: "Vul een geldig e-mailadres in.",
    whatsapp: "WhatsApp",
    whatsappNeedsOn: "Zet eerst de dagelijkse melding aan om WhatsApp te koppelen.",
    whatsappNeedsLink: "Koppel eerst je nummer om dit te kiezen.",
    whatsappLinked: (phone) => `Gekoppeld aan ${phone}`,
    whatsappLink: "Koppel WhatsApp",
    whatsappAiConsent:
      "Vragen die je via WhatsApp stelt gaan naar Mistral (EU) om te bepalen welke berekening past. Je losse transacties en namen van tegenpartijen gaan niet mee; een berekende uitkomst (zoals een totaal per dag of categorie) kan wel meegaan.",
    whatsappUnlink: "Ontkoppel WhatsApp",
    whatsappSend: (number) =>
      number
        ? `Stuur deze code op WhatsApp naar ${number}.`
        : "Stuur deze code op WhatsApp naar het LaVega-nummer.",
    whatsappCodeLabel: "Jouw code",
    whatsappExpires: (time) => `Geldig tot ${time}`,
    whatsappWaiting: "Wachten op je bericht...",
    whatsappLinkedNow: "WhatsApp is gekoppeld.",
    whatsappTimedOut: "De code is verlopen. Vraag een nieuwe aan.",
    whatsappClose: "Sluiten",
    whatsappLinkFailed: "WhatsApp koppelen is nu niet gelukt. Probeer het later opnieuw.",
    whatsappUnlinkFailed: "Ontkoppelen is niet gelukt. Probeer het opnieuw.",
    reconsentTitle: "Opnieuw toestemming nodig",
    reconsentBody:
      "De tekst waarop je toestemming gaf is veranderd. Lees hem en bevestig opnieuw, anders krijg je geen meldingen meer.",
    reconsentButton: "Geef opnieuw toestemming",
    feed: {
      title: "Meldingen",
      intro: "De berichten die LaVega je gestuurd heeft, nieuwste bovenaan.",
      empty: "Nog geen meldingen.",
      loadMore: "Toon oudere meldingen",
      loadFailed: "De meldingen konden niet worden geladen.",
      deleteFailed: "Verwijderen is niet gelukt.",
      unavailable: "Meldingen zijn nu niet beschikbaar.",
      settingsLink: "Naar Profiel voor de instellingen",
      whatsappTitle: "WhatsApp-gesprek",
      whatsappEmpty: "Er is geen WhatsApp-gesprek bewaard.",
      deleteConversation: "Verwijder gesprek",
      deleteConversationConfirm:
        "Dit verwijdert alle WhatsApp-berichten die LaVega bewaart. Je eigen WhatsApp-app houdt zijn kopie.",
      deleteConversationYes: "Ja, verwijder gesprek",
      deleteConversationNo: "Annuleer",
      conversationDeleted: "Het gesprek is verwijderd.",
      conversationDeleteFailed: "Verwijderen is niet gelukt.",
    },
    overview: {
      title: "Meldingen",
      body: "Lees wat LaVega je de laatste dagen heeft gemeld.",
      open: "Bekijk meldingen",
    },
  },
  en: {
    title: "Daily message",
    consent:
      "Every night LaVega reads your transactions to send you alerts, and does not store them.",
    consentCheckbox: "I understand and give consent",
    switchLabel: "Send me a daily message",
    channelsLabel: "Where do you want the message?",
    channels: { feed: "In LaVega", push: "Push notification", email: "Email" },
    timeLabel: "Time",
    timeNotice: "Messages arrive at the time you choose, never earlier",
    noBank: "Connect a bank first, then you can turn this on.",
    storedHeading: "What LaVega keeps",
    storedEmpty: "Nothing is stored.",
    deleteItem: "Delete",
    turnOffConfirm: "Turning off deletes everything LaVega keeps on the server for this feature.",
    turnOffConfirmYes: "Turn off and delete",
    turnOffConfirmNo: "Cancel",
    mirrorOtherDue: "Payment due",
    turnOn: "Turn on",
    turnOff: "Turn off",
    save: "Save settings",
    saved: "Saved.",
    loading: "Loading settings...",
    unavailable: "Alerts are not available right now.",
    loadFailed: "The settings could not be loaded.",
    saveFailed: "Saving failed. Try again in a moment.",
    signInNeeded: "Sign in to set up daily alerts.",
    bankRequired: "Connect a bank first, then you can turn this on.",
    bankLink: "Go to Accounts",
    offNote: "You can turn this off at any time. Turning off deletes the copy on the server.",
    inAppAlways: "Always on while the alerts are on",
    pushDenied:
      "Your browser blocks notifications for LaVega. Allow them in the browser settings and try again.",
    pushUnsupported: "This browser does not support push notifications.",
    pushFailed: "Turning on push notifications failed.",
    emailLabel: "Email address",
    emailInvalid: "Enter a valid email address.",
    whatsapp: "WhatsApp",
    whatsappNeedsOn: "Turn on the daily message first to link WhatsApp.",
    whatsappNeedsLink: "Link your number first to choose this.",
    whatsappLinked: (phone) => `Linked to ${phone}`,
    whatsappLink: "Link WhatsApp",
    whatsappAiConsent:
      "Questions you ask over WhatsApp go to Mistral (EU) to decide which calculation fits. Your individual transactions and counterparty names are not sent; a calculated result (such as a total per day or category) may be.",
    whatsappUnlink: "Unlink WhatsApp",
    whatsappSend: (number) =>
      number
        ? `Send this code on WhatsApp to ${number}.`
        : "Send this code on WhatsApp to the LaVega number.",
    whatsappCodeLabel: "Your code",
    whatsappExpires: (time) => `Valid until ${time}`,
    whatsappWaiting: "Waiting for your message...",
    whatsappLinkedNow: "WhatsApp is linked.",
    whatsappTimedOut: "The code has expired. Request a new one.",
    whatsappClose: "Close",
    whatsappLinkFailed: "Linking WhatsApp failed right now. Try again later.",
    whatsappUnlinkFailed: "Unlinking failed. Try again.",
    reconsentTitle: "Consent needed again",
    reconsentBody:
      "The text you consented to has changed. Read it and confirm again, otherwise you will stop receiving alerts.",
    reconsentButton: "Give consent again",
    feed: {
      title: "Alerts",
      intro: "The messages LaVega has sent you, newest first.",
      empty: "No alerts yet.",
      loadMore: "Show older alerts",
      loadFailed: "The alerts could not be loaded.",
      deleteFailed: "Deleting failed.",
      unavailable: "Alerts are not available right now.",
      settingsLink: "Go to Profile for the settings",
      whatsappTitle: "WhatsApp conversation",
      whatsappEmpty: "No WhatsApp conversation is stored.",
      deleteConversation: "Delete conversation",
      deleteConversationConfirm:
        "This deletes every WhatsApp message LaVega stores. Your own WhatsApp app keeps its copy.",
      deleteConversationYes: "Yes, delete conversation",
      deleteConversationNo: "Cancel",
      conversationDeleted: "The conversation was deleted.",
      conversationDeleteFailed: "Deleting failed.",
    },
    overview: {
      title: "Alerts",
      body: "Read what LaVega has told you over the last days.",
      open: "View alerts",
    },
  },
};
