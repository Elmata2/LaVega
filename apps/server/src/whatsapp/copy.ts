/* User-facing WhatsApp copy, NL and EN. */
export const WHATSAPP_COPY = {
  nl: {
    linked: "Gekoppeld. Ik stuur je voortaan hier je dagelijkse bericht.",
    help: "Ik kan vragen beantwoorden over je uitgaven, aankomende afschrijvingen en je grootste uitgavencategorieën van de laatste 90 dagen. Probeer bijvoorbeeld: Wat gaf ik gisteren uit?",
    fetchExhausted: "Ik kan nu niet bij je bank, probeer het morgen of open de app.",
    noBank:
      "Ik kan je bankgegevens nu niet lezen. Open de app om je bank opnieuw te koppelen of te controleren.",
    budgetRefused: "Ik kan nu even niet antwoorden. Probeer het later opnieuw of open de app.",
    failed: "Er ging iets mis. Probeer het later opnieuw of open de app.",
    cancelUnavailable: "Annuleren is nog niet beschikbaar.",
    aiConsentNeeded:
      "Je hebt geen toestemming gegeven om vragen via WhatsApp naar Mistral (EU) te sturen. Koppel WhatsApp opnieuw in de app en geef die toestemming.",
    consentOutdated:
      "Open LaVega en bevestig de nieuwe toestemming bij Meldingen. Daarna kan ik je vraag beantwoorden.",
    linkExpired:
      "Je WhatsApp-koppeling is verlopen omdat je 90 dagen niets stuurde. Koppel opnieuw in Meldingen.",
  },
  en: {
    linked: "Linked. From now on I will send your daily message here.",
    help: "I can answer questions about your spending, upcoming charges and your biggest spending categories over the last 90 days. For example: What did I spend yesterday?",
    fetchExhausted: "I cannot reach your bank right now, try again tomorrow or open the app.",
    noBank: "I cannot read your bank data right now. Open the app to reconnect or check your bank.",
    budgetRefused: "I cannot answer right now. Try again later or open the app.",
    failed: "Something went wrong. Try again later or open the app.",
    cancelUnavailable: "Cancelling is not available yet.",
    aiConsentNeeded:
      "You have not agreed to send questions asked over WhatsApp to Mistral (EU). Link WhatsApp again in the app and give that consent.",
    consentOutdated:
      "Open LaVega and confirm the updated consent under Alerts. After that I can answer your question.",
    linkExpired:
      "Your WhatsApp link expired because you sent nothing for 90 days. Link again in Alerts.",
  },
} as const;

/** The last line of a shortened list of facts. */
export const moreFacts = (locale: "nl" | "en", more: number): string =>
  locale === "nl"
    ? `... en nog ${more} regels. Open de app voor alles.`
    : `... and ${more} more lines. Open the app for everything.`;

/* Fixed phrases the model may pick (by index) to put before and after the computed
 * facts. The model writes no text; these lines are the only words around the facts.
 * NL and EN lists have the same length and order. The owner edits them here. */
export const FRAMING_PHRASES = {
  nl: {
    intros: [
      "Even gekeken voor je.",
      "Dit vond ik.",
      "Zo ziet het eruit.",
      "Komt-ie.",
      "Ik heb het opgezocht.",
      "Kijk maar.",
    ],
    outros: [
      "Nog iets weten? Vraag maar.",
      "In de app vind je meer.",
      "Ik zit hier als je nog een vraag hebt.",
      "Tot de volgende keer.",
      "Stel gerust nog een vraag.",
    ],
  },
  en: {
    intros: [
      "I had a look for you.",
      "This is what I found.",
      "This is how it looks.",
      "Here you go.",
      "I looked it up.",
      "Have a look.",
    ],
    outros: [
      "Anything else? Just ask.",
      "You can find more in the app.",
      "I am here if you have another question.",
      "Until next time.",
      "Feel free to ask another question.",
    ],
  },
} as const;
