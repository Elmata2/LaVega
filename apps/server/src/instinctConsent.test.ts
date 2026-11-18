import { expect, test } from "vitest";
import { CONSENT_TEXT_EN, CONSENT_TEXT_NL, CONSENT_VERSION } from "./instinctConsent.js";

/* The server stamps the consent version and the policy repeats the sentence; the screen
 * shows the web copy. The two must not drift, so this test loads the web copy module by
 * path (the web package is not a dependency of the server). */
const WEB_COPY = new URL("../../web/src/copy/instinct.ts", import.meta.url).pathname;

test("the consent sentence on the screen is the one the server stamps, in both languages", async () => {
  const { instinctCopy } = (await import(/* @vite-ignore */ WEB_COPY)) as {
    instinctCopy: Record<"nl" | "en", { consent: string; whatsappAiConsent: string }>;
  };
  expect(instinctCopy.nl.consent).toBe(CONSENT_TEXT_NL);
  expect(instinctCopy.en.consent).toBe(CONSENT_TEXT_EN);
});

test("the consent sentences and version are the ones the owner agreed to", () => {
  expect(CONSENT_VERSION).toBe("2026-11-v3");
  expect(CONSENT_TEXT_NL).toBe(
    "LaVega leest elke ochtend je transacties en saldi van de laatste 90 dagen bij je bank, zonder dat jij erbij bent, om hoogstens één melding per dag te maken. Die transacties en saldi bewaren we niet. Wel bewaren we je instellingen, een kopie van je categorieregels en naderende deadlines die je browser ons doorgeeft, en de meldingen zelf, 90 dagen. Een melding kan de naam van een tegenpartij, een bedrag en een datum noemen en komt via de kanalen die jij kiest: in LaVega, per e-mail, via WhatsApp of als pushmelding. Een pushmelding zegt alleen dat er een bericht is; de inhoud lees je in LaVega of in je e-mail. Je kunt dit op elk moment uitzetten; dan verwijderen we alles. Meer staat in het privacybeleid.",
  );
  expect(CONSENT_TEXT_EN).toBe(
    "Each morning LaVega reads your transactions and balances from the last 90 days at your bank, without you being there, to make at most one message a day. We do not store those transactions and balances. We do store your settings, a copy of your category rules and upcoming deadlines that your browser passes to us, and the messages themselves, for 90 days. A message can name a counterparty, an amount and a date and arrives through the channels you choose: in LaVega, by email, via WhatsApp or as a push notification. A push notification only says there is a message; you read the content in LaVega or in your email. You can turn this off at any time; we then delete everything. More is in the privacy policy.",
  );
});

test("the WhatsApp consent line carries the WhatsApp read, the cap of 3 and the filter caveat", async () => {
  const { instinctCopy } = (await import(/* @vite-ignore */ WEB_COPY)) as {
    instinctCopy: Record<"nl" | "en", { whatsappAiConsent: string }>;
  };
  expect(instinctCopy.nl.whatsappAiConsent).toContain(
    "Stel je via WhatsApp een vraag, dan leest LaVega op dat moment ook je transacties, hoogstens 3 keer per dag. Je vraag kan persoonlijke informatie bevatten die ons filter niet herkent; die gaat dan ook naar Mistral.",
  );
  expect(instinctCopy.en.whatsappAiConsent).toContain(
    "If you ask a question over WhatsApp, LaVega also reads your transactions at that moment, at most 3 times a day. Your question can contain personal information our filter does not recognise; that also goes to Mistral.",
  );
});
