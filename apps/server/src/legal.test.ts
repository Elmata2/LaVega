import { expect, test } from "vitest";
import { privacyHtml, termsHtml } from "./legal.js";

/* legal.ts says of itself: "Content reflects how LaVega actually works. Keep
 * this truthful." It stopped being true on 2026-08-03, when the AI features,
 * the invoice mail pipeline and the waitlist shipped without the policy moving.
 * These tests are the thing that was missing — they fail when a processor is in
 * the code but not in the policy. */

test("every third party the code sends data to is named in the policy", () => {
  // Railway was here until 2026-09-01, when hosting moved to Vercel and the
  // database to Neon. A processor leaving the stack has to leave the policy too,
  // or it names a company that no longer holds anything.
  for (const processor of [
    "Enable Banking",
    "Mistral",
    "Cloudflare",
    "n8n",
    "Resend",
    "Vercel",
    "Neon",
    "Sentry",
    "Frankfurter",
    "Meta",
  ]) {
    expect(privacyHtml, `policy does not name ${processor}`).toContain(processor);
  }
});

test("the policy no longer claims financial data is NEVER sent to a LaVega server", () => {
  // Transaction descriptions, invoice PDFs and chat context do pass through the
  // server on their way to Mistral. Redacted and opt-in, but not "never".
  expect(privacyHtml).not.toMatch(/nooit<\/strong> naar servers van LaVega/);
});

test("the policy says the AI features are opt-in, which is what the code enforces", () => {
  expect(privacyHtml.toLowerCase()).toContain("opt-in");
});

test("the policy names where the AI processor handles the data, which is the AVG-relevant fact", () => {
  expect(privacyHtml).toMatch(/binnen de EU/i);
});

test("the policy and terms say a forgotten password no longer loses the data", () => {
  // docs/adr/0009: the vault key belongs to the account, so "password lost =
  // data lost" and "the key never leaves your device" became false.
  expect(termsHtml).not.toContain("Wachtwoord kwijt = gegevens kwijt");
  expect(termsHtml).toContain("Wachtwoord vergeten");
  expect(privacyHtml).not.toContain("sleutel alleen op je apparaat");
  expect(privacyHtml).toContain("technisch zouden kunnen openen");
});

test("the policy does not claim the server stores nothing, now that Neon does", () => {
  // It said "De LaVega-server bewaart je administratie niet" while a vault
  // backup, broker credentials and preferences sat in Neon. That is the same
  // failure as the one above: the architecture moved and the policy did not.
  expect(privacyHtml).not.toContain("bewaart je administratie niet");
  expect(privacyHtml).toContain("Wat er wél op de server staat");
});

test("the policy does not claim a vault we cannot read", () => {
  // Both the personal vault key and the broker vault are sealed with OUR key
  // (docs/adr/0009). Claiming otherwise would be false.
  expect(privacyHtml).not.toMatch(/die wij niet kunnen lezen/);
  expect(privacyHtml).toMatch(/die wij wél kunnen lezen/);
});

test("the policy tells the user how to erase what is on the server", () => {
  // Wiping browser storage no longer removes everything, so the policy has to
  // say what survives it and what removes that.
  expect(privacyHtml).not.toContain("het wissen van de browseropslag verwijdert alles definitief");
  expect(privacyHtml).toContain("verwijderen van je gegevens op de server");
  expect(privacyHtml).toContain("Autoriteit Persoonsgegevens");
});

test("the policy names Resend for account mail and no longer names the retired waitlist processor", () => {
  expect(privacyHtml).toContain("Resend");
  expect(privacyHtml).not.toContain("Apps Script");
  expect(privacyHtml).not.toMatch(/wachtlijst/i);
});

test("the policy carries the daily message consent sentence verbatim, and says what is read and kept", () => {
  expect(privacyHtml).toContain(
    "LaVega leest elke nacht je transacties om je meldingen te sturen, en bewaart ze niet.",
  );
  expect(privacyHtml).toContain(
    "Every night LaVega reads your transactions to send you alerts, and does not store them.",
  );
  expect(privacyHtml).toMatch(
    /haalt de server elke nacht[^<]*transacties en saldi van de laatste 90 dagen/,
  );
  expect(privacyHtml).toMatch(/Meldingen bewaren we 90 dagen/);
  expect(privacyHtml).toContain("Dagelijkse melding");
  expect(privacyHtml).toMatch(/Zet je de melding uit, dan verwijderen we in één keer/);
});

test("the policy covers the WhatsApp link: Meta, the sealed number, 90 days, 15 minute codes, and Mistral for answers (F2)", () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toMatch(/Meta/);
  expect(text).toMatch(/WhatsApp Business/);
  expect(text).toMatch(/telefoonnummer[^.]*versleuteld/i);
  expect(text).toMatch(/hash/i);
  expect(text).toMatch(/90 dagen/);
  expect(text).toMatch(/15 minuten/);
  expect(text).toMatch(/per bericht of in één keer/);
  expect(text).toMatch(/vragen[^.]*WhatsApp[^.]*Mistral/i);
  expect(text).toMatch(/aparte toestemming/i);
  // The Mistral table row and the "Uitzetten" bullet name WhatsApp too.
  expect(privacyHtml).toMatch(/<strong>Mistral<\/strong>[\s\S]*?WhatsApp[\s\S]*?<\/tr>/);
  expect(privacyHtml).toMatch(/<strong>Uitzetten\.<\/strong>[^<]*WhatsApp/);
  expect(text).toMatch(/WhatsApp[^.]*in English|In English[\s\S]*WhatsApp/);
});

test("the WhatsApp paragraph uses the same terms as the consent label", () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain(
    "Je losse transacties en namen van tegenpartijen gaan niet mee; een berekende uitkomst (zoals een totaal per dag of categorie) kan wel meegaan.",
  );
});

test("the AI opt-in promise stays true: WhatsApp questions need their own consent, not a hidden default", () => {
  expect(privacyHtml).toContain("Staan ze uit, dan gaat er niets heen");
  expect(privacyHtml).toMatch(/Zonder dat vinkje[^.]*Mistral/);
});

test("the owner-review marker sits in the source, once", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./legal.ts", import.meta.url), "utf8");
  expect(src.match(/DRAFT: owner legal review pending \(Instinct phase 2\)/g)).toHaveLength(1);
});

/* W2: the WhatsApp paragraph says what the code does, no more. `scrubPersonalValues` removes
 * IBANs, e-mail addresses, Dutch phone numbers, BSNs and amounts written with a currency sign. */
test("the WhatsApp paragraph lists exactly what the question filter removes (W2)", async () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain(
    "naar Mistral (EU), met een filter dat rekeningnummers (IBAN, van elk land), e-mailadressen, Nederlandse telefoonnummers (06…, 010… en +31), burgerservicenummers en bedragen met € of EUR ervoor (zoals € 45) eruit haalt; een bedrag met het valutateken erachter, zoals 45 EUR of 45€, blijft staan",
  );
  expect(text).not.toMatch(/telefoonnummers en bedragen eruit haalt/);
  expect(text).not.toMatch(/bedragen die met € of EUR zijn geschreven/);
  // The filter in code really does what the text lists.
  const { scrubPersonalValues } = await import("@lavega/core");
  const out = scrubPersonalValues(
    "NL91ABNA0417164300 a@b.nl 06 12345678 111222333 € 45,00 EUR 12 en 45 zonder teken",
  );
  expect(out).toContain("[IBAN]");
  expect(out).toContain("[EMAIL]");
  expect(out).toContain("[TEL]");
  expect(out).toContain("[BEDRAG]");
  expect(out).toContain("en 45 zonder teken");
  // What the text says stays: a number written with the sign AFTER it, and a foreign number, stay.
  expect(scrubPersonalValues("45 EUR en 45€ en +49 30 123456")).toBe(
    "45 EUR en 45€ en +49 30 123456",
  );
});

test("link codes expire after 15 minutes and are deleted on the next code, on unlink and on turn-off (W2)", () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain(
    "Een koppelcode bewaren we alleen als hash; hij verloopt na 15 minuten en wordt verwijderd bij de volgende code, bij ontkoppelen en bij uitzetten.",
  );
  expect(text).not.toMatch(/hash en hij verloopt/);
  expect(text).toContain(
    "link codes are kept as a hash and expire after 15 minutes; they are deleted when the next code is made, on unlinking and on turning the feature off",
  );
  expect(text).not.toContain("kept as a hash for 15 minutes");
});

test("unlinking removes the number, but conversations stay until the user deletes them or 90 days pass (W2)", () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain(
    "Ontkoppel je alleen WhatsApp, dan verwijderen we het nummer en de koppelcode; de gesprekken blijven staan tot je ze zelf verwijdert of tot 90 dagen voorbij zijn.",
  );
  expect(text).toContain(
    "Unlinking removes the number; conversations stay until you delete them or 90 days pass.",
  );
  // One DRAFT marker, consent sentence untouched.
  expect(privacyHtml).toContain("Wat de server niet bewaart.");
});

test("the categorise bullet says exactly what redactForAi removes and what is sent (A4)", async () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain(
    "Transacties categoriseren — de tegenpartij en de omschrijving van een transactie, en of het geld erbij kwam of eraf ging, nadat een filter er IBANs, e-mailadressen, datums met een jaar (zoals 01-08-2026), bedragen met € of EUR ervoor, bedragen met twee decimalen en getallen van vier of meer cijfers uit heeft gehaald. Hele bedragen zonder decimalen (zoals 45), datums in woorden (zoals 14 juli) en datums zonder jaar (zoals 14-07) blijven staan. Het bedrag zelf, je datum, je saldo en je rekeningnummer sturen we niet mee.",
  );
  expect(text).not.toMatch(/filter dat IBANs, bedragen en datums er vooraf uit haalt/);
  const { redactForAi } = await import("@lavega/core");
  expect(
    redactForAi("AH 45 betaald 14 juli 14-07 NL91ABNA0417164300 01-08-2026 € 45 12,50 123456"),
  ).toBe("AH 45 betaald 14 juli 14-07");
});
