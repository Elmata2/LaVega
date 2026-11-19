import { expect, test } from "vitest";
import { CONSENT_TEXT_EN, CONSENT_TEXT_NL } from "./instinctConsent.js";
import { privacyHtml, termsHtml } from "./legal.js";

const WEB_COPY = new URL("../../web/src/copy/instinct.ts", import.meta.url).pathname;

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
    "OpenRouter",
    "TypeSafe",
    "PostHog",
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
  expect(privacyHtml).toContain(CONSENT_TEXT_NL);
  expect(privacyHtml).toContain(CONSENT_TEXT_EN);
  expect(privacyHtml).toMatch(
    /leest de server één keer per dag, in de ochtend[^<]*transacties en saldi van de laatste 90 dagen/,
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

test("the policy states when the server reads: one daily morning run for everyone, retry next day, WhatsApp questions, memory only", () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).not.toMatch(/elke nacht|each night|every night/i);
  expect(text).not.toContain("standaard 08:00");
  expect(text).not.toContain("kijkt elk uur");
  expect(text).not.toContain("tot 2 uur na dat tijdstip");
  expect(text).not.toContain("up to 2 hours after that time");
  expect(text).toContain("tussen 08:00 en 10:00 Nederlandse tijd");
  expect(text).toContain("between 08:00 and 10:00 Dutch time");
  expect(text).toContain("elke gebruiker die dit aanzette");
  expect(text).toContain("de volgende dag");
  expect(text).toContain("the next day");
  expect(text).toContain("hoogstens 3 keer per dag");
  expect(text).toContain("alleen in het werkgeheugen tijdens die ene run of dat ene antwoord");
  expect(text).toContain("at most 3 times a day");
});

test("the policy states the stored copy, retention, reminder, filter limits and the push text (nl and en)", () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const needle of [
    "de teksten van je categorieregels (woorden die jij zelf typte, vaak namen van winkels)",
    "de naam van een betere kaart met het jaarlijkse voordeel",
    "de kopie van je regels en deadlines op onze server",
    "zeven dagen voordat je bankkoppeling verloopt",
    "burgerservicenummers die de elfproef doorstaan",
    "Andere persoonlijke tekst die je zelf typt herkennen we niet",
    "een korte lijst van wat we je al meldden, 30 dagen",
    "tot je de melding uitzet, het nummer ontkoppelt of je account verwijdert",
    "Je vragen via WhatsApp bewaren we zoals je ze typte",
    "een generieke tekst zonder namen of bedragen",
    "de e-mail bevat de volledige tekst",
    "text of the rules you typed",
    "the name of a better card with the yearly gain",
    "the copy of your rules and deadlines on our server",
    "seven days before your bank link expires",
    "social security numbers that pass the 11-proof",
    "Other personal text you type is not recognised",
    "a generic text without names or amounts",
    "the e-mail carries the full text",
  ])
    expect(text, needle).toContain(needle);
});

test("the WhatsApp paragraph uses the same terms as the consent label, word for word", async () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const { instinctCopy } = (await import(/* @vite-ignore */ WEB_COPY)) as {
    instinctCopy: Record<"nl" | "en", { whatsappAiConsent: string }>;
  };
  expect(text).toContain(instinctCopy.nl.whatsappAiConsent);
  expect(text).toContain(instinctCopy.en.whatsappAiConsent);
});

test("Mistral chooses and writes nothing that is sent; every figure is computed", () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain("kiest een openingszin en een slotzin uit een vaste lijst");
  expect(text).toContain("Mistral schrijft zelf niets dat naar jou wordt gestuurd");
  expect(text).toContain("komt uit onze eigen berekening");
  expect(text).not.toContain("laat de server alleen door");
  expect(text).toContain("picks an opening and a closing sentence from a fixed list");
  expect(text).toContain("Mistral writes nothing that is sent to you");
});

test("the policy says the messages themselves are stored and can name a payee, amount and date", () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain("De meldingen en antwoorden zelf bewaren we wel");
  expect(text).toContain(
    "een naam van een tegenpartij, een bedrag en een datum uit je eigen gegevens",
  );
  expect(text).toContain("versleuteld met onze serversleutel (90 dagen;");
  expect(text).toContain("per melding of per gesprek wissen");
  expect(text).toContain("can name a payee, an amount and a date taken from your own data");
  expect(text).not.toContain("Een melding noemt alleen jouw eigen cijfers");
  expect(text).toContain("blijven staan in die apps; die vallen buiten het bereik van LaVega");
  expect(text).toContain("are outside LaVega's control");
  expect(text).toContain("De dagelijkse run gebeurt zonder dat jij erbij bent");
  expect(text).toContain(
    "The daily read happens without you being there, within the consent you gave your bank.",
  );
  expect(text).not.toContain("kiest een begroeting");
  expect(text).toContain("openingszin en een slotzin");
  // The Mistral facts are stated once in the WhatsApp bullet.
  expect(text.split("gaan naar Mistral (EU) om te bepalen welke berekening past")).toHaveLength(2);
});

test("the policy names the investing AI path and what it sends (OpenRouter, TypeSafe)", () => {
  expect(privacyHtml).toContain("Beleggingskant — AI");
  expect(privacyHtml).toContain("OpenRouter");
  expect(privacyHtml).toContain("TypeSafe System One");
  // The portfolio summary really does carry these fields (renderPortfolioBrief).
  expect(privacyHtml).toContain("de kostprijs");
  expect(privacyHtml).toContain("de eerste aankoopdatum");
  expect(privacyHtml).toContain("je vraag of opdracht");
  expect(privacyHtml).toContain("weekbrief");
  // Both providers have a table row, not only a sentence in the prose.
  expect(privacyHtml).toMatch(/<strong>OpenRouter<\/strong>[\s\S]*?<\/tr>/);
  expect(privacyHtml).toMatch(/<strong>TypeSafe<\/strong>[\s\S]*?<\/tr>/);
});

test("the policy discloses PostHog and drops the absolute no-analytics claim", () => {
  // PostHog runs in the browser (events, exceptions) and on the server (AI
  // generation metadata and purpose-written logs). "Geen tracking of analytics"
  // was false the moment it shipped.
  expect(privacyHtml).not.toContain("geen tracking of analytics");
  expect(privacyHtml).toContain("geen tracking voor advertenties");
  expect(privacyHtml).toContain("PostHog");
  expect(privacyHtml).toContain("geen sessieopnamen");
});

test("the retention list covers the investing conversations, letters and AI usage metadata", () => {
  const text = privacyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain(
    "Gesprekken met de beleggingsagent, je doelen, these en observaties, en de weekbrieven",
  );
  expect(text).toContain(
    "Technische AI-gebruiksgegevens (model, tokens, kosten, uitkomst) zonder inhoud",
  );
});

test("erase-all also removes the portfolio letters", () => {
  expect(privacyHtml).toContain("je agent-geschiedenis en je beleggingsbrieven");
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
    "Eerst gaat er een filter overheen dat rekeningnummers (IBAN, van elk land), e-mailadressen, Nederlandse telefoonnummers (06…, 010… en +31), burgerservicenummers die de elfproef doorstaan en bedragen met € of EUR ervoor (zoals € 45) eruit haalt; een bedrag met het valutateken erachter, zoals 45 EUR of 45€, blijft staan",
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
  // The first import of the whole core package takes a few seconds on a loaded CI runner.
}, 30_000);

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

const NEW_NAMES =
  "namen van tegenpartijen (winkels, maar ook personen en bedrijven waaraan je betaalt of van wie je geld krijgt), van je rekeningen en van rekeningen die je zelf invoerde, en de namen van je vaste lasten, facturen en abonnementen (een rekeningnaam kan de naam van een persoon bevatten)";

/* The Assistent chat (issue #363): the AI-functions list, the Mistral row and the
 * legal-basis row must say what the chat really sends. Nothing about Mistral's own
 * retention or training is claimed: that is not verified. */
test("the policy lists the assistant chat as the fifth AI function, with what goes and what does not", () => {
  expect(privacyHtml).toContain("vijf functies die een AI-model van <strong>Mistral</strong>");
  expect(privacyHtml).not.toContain("vier functies die een AI-model");
  const item =
    /<li><strong>Vragen in de assistent<\/strong>[^<]*<\/li>/.exec(privacyHtml)?.[0] ?? "";
  expect(item).toContain(NEW_NAMES);
  expect(item).toContain("rekeningnummers halen we eruit voordat er iets verstuurd wordt");
  expect(item).not.toContain("geen rekeningnummers");
  expect(item).toContain("wij bewaren ze niet");
});

test("the policy says the assistant answers from figures in your browser and can be switched off", () => {
  expect(privacyHtml).toMatch(/assistent[^<]*uitzetten|uitzetten[^<]*assistent/i);
  expect(privacyHtml).toContain("opent je kluis in je browser");
});

test("the policy has an English line for the assistant", () => {
  const en =
    /<p lang="en"><em>In English\.<\/em> The assistant[^<]*<\/p>/.exec(privacyHtml)?.[0] ?? "";
  expect(en).toContain("counterparties");
  expect(en).toContain("fixed costs, invoices and subscriptions");
  expect(en).toContain("person's name");
  expect(en).toContain("account numbers");
  expect(en).toContain("does not store");
  expect(en).toContain("turn it off");
});

test("the Mistral row and the legal-basis row name the assistant; the WhatsApp wording stays true", () => {
  const row =
    /<tr><td><strong>Mistral<\/strong> \(EU\)<\/td>[\s\S]*?<\/tr>/.exec(privacyHtml)?.[0] ?? "";
  expect(row).toContain("bij de assistent");
  expect(row).toContain(NEW_NAMES);
  expect(row).toContain("toestemming in de assistent");
  expect(row).toContain("geen losse transacties of namen van tegenpartijen");
  const basis = /<tr><td>AI-functies[^<]*<\/td>/.exec(privacyHtml)?.[0] ?? "";
  expect(basis).toContain("de assistent");
});

test("the assistant text claims nothing about what Mistral does with the data", () => {
  const section = privacyHtml.slice(
    privacyHtml.indexOf("<h2>AI-functies"),
    privacyHtml.indexOf("<h2>Beleggingskant"),
  );
  expect(section).not.toMatch(/trainen|training|nul dagen|zero.retention/i);
});

test("D4: the 'you see what is sent first' sentence has the exception for the assistant", () => {
  const intro = /<p>LaVega heeft vijf functies[^]*?<\/p>/.exec(privacyHtml)?.[0] ?? "";
  expect(intro).toContain("wat er verstuurd wordt krijg je eerst te zien ter bevestiging");
  expect(intro).toMatch(/Uitzondering: de assistent[^<]*zonder bevestiging per bericht/);
});
