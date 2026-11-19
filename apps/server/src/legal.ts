import { CONSENT_TEXT_EN, CONSENT_TEXT_NL } from "./instinctConsent.js";

/* Privacy policy + terms of service, served as standalone HTML at /privacy and
 * /terms. Needed for the Enable Banking application registration (which asks for
 * a contact email + privacy + terms URL) and generally good practice. Content
 * reflects how LaVega actually works: local-first, data in the browser's
 * encrypted vault, read-only bank access via Enable Banking, server is a thin
 * proxy that never stores financial data. Keep this truthful.
 *
 * legal.test.ts enforces that: it fails when a processor appears in the code
 * and not on this page. The 2026-08-03 version drifted for four weeks because
 * nothing checked — the AI features, the invoice mail pipeline and the waitlist
 * all shipped while the page still said the server only did two things. */

const CONTACT_EMAIL = "alexander.steunenberg@gmail.com";
const UPDATED = "2026-11-16";

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="nl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — LaVega</title>
<style>
  :root { color-scheme: light; }
  body { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; background: #f6f4ef; color: #1a1a17;
    font: 16px/1.65 -apple-system, "Segoe UI", Inter, system-ui, sans-serif; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 600; font-size: 2rem; margin: 0 0 4px; }
  h2 { font-family: Georgia, serif; font-size: 1.25rem; margin: 32px 0 8px; }
  .muted { color: #6b6961; font-size: 0.9rem; margin-top: 0; }
  a { color: #1f4e6b; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; }
  hr { border: none; border-top: 1px solid #e6e2d9; margin: 32px 0; }
  code { background: #efece4; padding: 1px 5px; border-radius: 5px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 0.94rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e6e2d9; vertical-align: top; }
  th { color: #6b6961; font-weight: 600; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; }
  @media (max-width: 560px) { th, td { padding: 6px 6px; font-size: 0.88rem; } }
</style></head><body>
${bodyHtml}
<hr>
<p class="muted">LaVega · Laatst bijgewerkt ${UPDATED} · Contact: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> · <a href="/">Terug naar de app</a></p>
</body></html>`;
}

// DRAFT: owner legal review pending (Instinct phase 2)
export const privacyHtml = page(
  "Privacybeleid",
  `<h1>Privacybeleid</h1>
<p class="muted">Laatst bijgewerkt: ${UPDATED}</p>
<p>LaVega is een <strong>lokaal-eerst</strong> hulpmiddel om je eigen bankrekeningen te overzien. Privacy is het uitgangspunt van het ontwerp, niet een bijzaak.</p>

<h2>Welke gegevens en waar ze staan</h2>
<ul>
  <li>Je financiële gegevens (rekeningen, saldi, transacties) worden <strong>in je eigen browser</strong> bewaard, versleuteld (AES-GCM-256) met een sleutel die bij je account hoort. Er is geen kopie van je administratie op onze servers, tenzij je zelf een back-up maakt.</li>
  <li>Die sleutel maken wij aan zodra je voor het eerst inlogt. We bewaren hem versleuteld met onze eigen serversleutel en geven hem alleen aan jou, na het inloggen. Daardoor ben je je gegevens niet kwijt als je je wachtwoord vergeet. Het betekent ook dat wij je kluis technisch zouden kunnen openen. Dat doen we niet, en geen enkel deel van onze software doet het.</li>
  <li><strong>Wel passeert er data.</strong> De functies hieronder sturen bepaalde gegevens via onze server naar een verwerker en tonen je het antwoord. Dat is verwerking in doorvoer, geen opslag — maar het is niet hetzelfde als "het verlaat je apparaat nooit", en dat willen we niet mooier opschrijven dan het is.</li>
</ul>

<h2>Banktoegang (Enable Banking)</h2>
<ul>
  <li>Koppelen van een bank verloopt via <strong>Enable Banking</strong>, een gelicentieerde dienstverlener voor rekeninginformatie (AIS/PSD2). Je autoriseert de toegang rechtstreeks bij je eigen bank.</li>
  <li>De toegang is <strong>alleen-lezen</strong>: rekeninginformatie en transacties. LaVega kan <strong>geen betalingen</strong> initiëren.</li>
  <li>Opgehaalde rekening- en transactiegegevens gaan direct door naar je lokale, versleutelde opslag; ze worden niet blijvend op onze server bewaard. De enige uitzondering is de dagelijkse melding hieronder, en die kun je zelf aanzetten en uitzetten: ook dan lezen we transacties, maar bewaren we ze niet.</li>
</ul>

<h2>AI-functies — standaard uit</h2>
<p>LaVega heeft vijf functies die een AI-model van <strong>Mistral</strong> gebruiken. Ze zijn <strong>opt-in</strong>: je zet ze zelf aan, en wat er verstuurd wordt krijg je eerst te zien ter bevestiging. Uitzondering: de assistent stuurt na de eenmalige opt-in zonder bevestiging per bericht. Staan ze uit, dan gaat er niets heen.</p>
<ul>
  <li><strong>Factuur uitlezen</strong> — het factuurdocument dat je aanbiedt (PDF), om er bedrag, datum en leverancier uit te halen.</li>
  <li><strong>Transacties categoriseren</strong> — de tegenpartij en de omschrijving van een transactie, en of het geld erbij kwam of eraf ging, nadat een filter er IBANs, e-mailadressen, datums met een jaar (zoals 01-08-2026), bedragen met € of EUR ervoor, bedragen met twee decimalen en getallen van vier of meer cijfers uit heeft gehaald. Hele bedragen zonder decimalen (zoals 45), datums in woorden (zoals 14 juli) en datums zonder jaar (zoals 14-07) blijven staan. Het bedrag zelf, je datum, je saldo en je rekeningnummer sturen we niet mee.</li>
  <li><strong>Chat</strong> — de context van het tabblad waar je op staat: rekeningtypes en saldi, abonnementen, facturen en btw-instellingen. Rekeningnummers gaan niet mee.</li>
  <li><strong>Reisfeiten opzoeken</strong> — de naam van een aanbieder of kaart, geen persoonsgegevens.</li>
  <li><strong>Vragen in de assistent</strong> — je vragen en de cijfers die nodig zijn om te antwoorden (bedragen, datums, categorieën en namen van tegenpartijen (winkels, maar ook personen en bedrijven waaraan je betaalt of van wie je geld krijgt), van je rekeningen en van rekeningen die je zelf invoerde, en de namen van je vaste lasten, facturen en abonnementen (een rekeningnaam kan de naam van een persoon bevatten); rekeningnummers halen we eruit voordat er iets verstuurd wordt); wij bewaren ze niet. Eerdere regels van het gesprek gaan mee, zodat een vervolgvraag klopt. De assistent opent je kluis in je browser, zoekt zelf de cijfers op die bij je vraag horen en stuurt alleen die mee. Je zet dit zelf aan in de assistent en kunt het daar altijd weer uitzetten.</li>
</ul>
<p>Mistral verwerkt deze gegevens <strong>binnen de EU</strong> (Frankrijk) om er een antwoord op te geven. De sleutel is van ons, niet van jou; je hoeft dus geen eigen account. Wij bewaren deze verzoeken niet.</p>
<p lang="en"><em>In English.</em> The assistant answers your questions about your own money. It opens your vault in your browser, looks up the figures your question needs and sends your question and those figures (amounts, dates, categories and the names of counterparties, that is shops but also people and companies you pay or receive money from, of your accounts and of accounts you entered yourself, and the names of the fixed costs, invoices and subscriptions you have in the app; an account name can contain a person's name; we remove account numbers before anything is sent) to Mistral (EU) to write the answer. LaVega does not store the conversation or the figures; the conversation is gone when you reload. You turn it on yourself in the assistant and can turn it off at any time.</p>
<p>Bij Chat en Reisfeiten zoekt het model ook op het open web; die pagina's komen van overal en vallen buiten deze garantie.</p>
<p><strong>Vragen via WhatsApp</strong> zijn een aparte opt-in. Bij het koppelen van WhatsApp vink je zelf aan dat de vragen die je daar stelt naar Mistral gaan om te bepalen welke berekening past. Zonder dat vinkje beantwoordt LaVega geen vragen via WhatsApp en gaat er niets naar Mistral. Wat er dan heen gaat, staat bij "Dagelijkse melding" hieronder. Dat geldt voor WhatsApp; de assistent in de app werkt anders en stuurt wel namen van tegenpartijen en rekeningen mee (zie de lijst hierboven).</p>

<h2>Beleggingskant — AI</h2>
<p>De beleggingskant gebruikt AI voor het gesprek, de weekbrief, het aandelenonderzoek, de portfoliobeoordeling en het herkennen van onbekende kasstroomtypen. Er gaan geen bankgegevens of rekeningnummers mee.</p>
<ul>
  <li><strong>Gesprek, weekbrief en aandelenonderzoek</strong> lopen via <strong>OpenRouter</strong> (VS) naar de ingestelde modelaanbieder, standaard <strong>Mistral</strong> (EU); bij drukte kan OpenRouter een ander model gebruiken. Er gaat een samenvatting van je portefeuille mee: totale waarde, en per positie het symbool en de naam, het gewicht, de waarde, de kostprijs, het totale resultaat en de eerste aankoopdatum, plus je sectorverdeling en je vraag of opdracht. Bij het gesprek gaan ook de herinneringen mee die je hebt bevestigd (je risicoprofiel, doelen, these per aandeel en eerdere gesprekken) en wat de agent tijdens dat gesprek zelf opvraagt: posities, koersen, transacties en openbare bedrijfsgegevens. De weekbrief schrijven we automatisch wanneer je brokerstand verandert; het gesprek en het aandelenonderzoek start je zelf.</li>
  <li><strong>Portfoliobeoordeling en onbekende kasstroomtypen</strong> lopen via <strong>TypeSafe System One</strong>. De beoordeling krijgt dezelfde portefeuillegegevens, inclusief aantallen en resultaat per positie. Herkent een sync een kasstroomtype van je broker niet, dan sturen we alleen dat type, de broker, de omschrijving, de valuta en de richting (in of uit), en alleen als je die suggesties hebt aangezet. Voor instrument- en sectorherkenning sturen we namen, tickers en ISIN's; die functies staan standaard uit.</li>
</ul>
<p>De gesprekken, brieven, doelen, these en observaties bewaren we versleuteld in Neon, tot je ze verwijdert of je account verwijdert.</p>

<h2>Facturen per e-mail — alleen als je het aanzet</h2>
<p>Zet je het doorstuuradres voor facturen aan, dan loopt inkomende post langs <strong>Cloudflare</strong> (die het adres bedient) naar <strong>n8n</strong> (dat de mail en de bijlagen klaarzet voor je Facturen-scherm). Een factuur wordt pas geboekt nadat jij hem bevestigt. Gebruik je een eigen n8n-server, dan gaat het naar de jouwe.</p>

<h2>Dagelijkse melding, alleen als je het aanzet</h2>
<p>${CONSENT_TEXT_NL}</p>
<ul>
  <li><strong>Wat de server leest.</strong> Voor elke gebruiker die dit aanzette leest de server één keer per dag, in de ochtend (tussen 08:00 en 10:00 Nederlandse tijd), de transacties en saldi van de laatste 90 dagen bij je bank (via Enable Banking, alleen om te lezen) en kiest daaruit hoogstens één melding per dag. Mislukt een poging, dan proberen we het de volgende dag opnieuw. Daarnaast sturen we zeven dagen voordat je bankkoppeling verloopt één herinnering. Stel je via WhatsApp een vraag waarvoor gegevens nodig zijn, dan leest de server je transacties ook op dat moment, hoogstens 3 keer per dag. De dagelijkse run gebeurt zonder dat jij erbij bent, binnen de toestemming die je bij je bank gaf. Verloopt die toestemming, dan stoppen de meldingen die gegevens nodig hebben en zeggen we dat één keer.</li>
  <li><strong>Wat de server niet bewaart.</strong> De transacties, saldi en rekeningnummers blijven alleen in het werkgeheugen tijdens die ene run of dat ene antwoord. Ze komen niet in de database en niet in logboeken. De meldingen en antwoorden zelf bewaren we wel (zie hieronder); een melding of antwoord kan een naam van een tegenpartij, een bedrag en een datum uit je eigen gegevens noemen.</li>
  <li><strong>Wat de server wel bewaart.</strong> Je instelling (aan of uit, kanalen, taal, je e-mailadres als je e-mail koos, de versie van deze toestemming), de meldingen en WhatsApp-antwoorden die we je stuurden, versleuteld met onze serversleutel (90 dagen; je kunt ze per melding of per gesprek wissen, en uitzetten wist ze allemaal), en de kopie van je regels en deadlines op onze server, die je browser ons doorgeeft zodat de melding kan rekenen: de teksten van je categorieregels (woorden die jij zelf typte, vaak namen van winkels), de data van naderende deadlines (BTW-deadlines met hun naam, andere deadlines zonder naam en zonder bedrag) en de naam van een betere kaart met het jaarlijkse voordeel. Daarnaast een pushabonnement als je pushmeldingen koos en een korte lijst van wat we je al meldden, 30 dagen, zodat we niets herhalen.</li>
  <li><strong>Hoe lang.</strong> Meldingen bewaren we 90 dagen. Je kunt elke melding of een heel gesprek eerder verwijderen. Je instelling, de kopie van je regels en deadlines, je pushabonnement en je WhatsApp-nummer bewaren we tot je de melding uitzet, het nummer ontkoppelt of je account verwijdert. Kopieën die al bezorgd zijn per e-mail, pushmelding of WhatsApp blijven staan in die apps; die vallen buiten het bereik van LaVega.</li>
  <li><strong>WhatsApp.</strong> Kies je WhatsApp, dan bezorgt <strong>Meta</strong> (WhatsApp Business Platform) de berichten die wij je sturen en de vragen die jij ons stuurt. Je telefoonnummer bewaren we versleuteld met onze serversleutel; om een binnenkomend bericht aan jou te koppelen bewaren we daarnaast een hash van het nummer met een eigen sleutel, waaruit het nummer niet terug te halen is. De gesprekken bewaren we 90 dagen, versleuteld, en je kunt ze per bericht of in één keer verwijderen. Je vragen via WhatsApp bewaren we zoals je ze typte, dus zonder het filter. Een koppelcode bewaren we alleen als hash; hij verloopt na 15 minuten en wordt verwijderd bij de volgende code, bij ontkoppelen en bij uitzetten. Een vraag die je via WhatsApp stelt, behandelen we alleen na je aparte toestemming bij het koppelen. Eerst gaat er een filter overheen dat rekeningnummers (IBAN, van elk land), e-mailadressen, Nederlandse telefoonnummers (06…, 010… en +31), burgerservicenummers die de elfproef doorstaan en bedragen met € of EUR ervoor (zoals € 45) eruit haalt; een bedrag met het valutateken erachter, zoals 45 EUR of 45€, blijft staan. Andere persoonlijke tekst die je zelf typt herkennen we niet, bijvoorbeeld een naam of een ziekte; die gaat dan mee. Stel je via WhatsApp een vraag, dan leest LaVega op dat moment ook je transacties, hoogstens 3 keer per dag. Je vraag kan persoonlijke informatie bevatten die ons filter niet herkent; die gaat dan ook naar Mistral. Vragen die je via WhatsApp stelt gaan naar Mistral (EU) om te bepalen welke berekening past. Je losse transacties, namen van tegenpartijen, rekeningnummers en saldi gaan niet mee. Wel gaan de uitgerekende zinnen (totalen, data en categorienamen) mee; Mistral kiest welke je ziet en kiest een openingszin en een slotzin uit een vaste lijst. Mistral schrijft zelf niets dat naar jou wordt gestuurd. Antwoorden met namen van tegenpartijen gaan niet naar Mistral. Elk bedrag, elke datum en elke naam die je leest komt uit onze eigen berekening; de tekst van de begroeting staat vast. Bij aankomende afschrijvingen, waar namen van tegenpartijen in het antwoord staan, sturen we alle regels.</li>
  <li><strong>Uitzetten.</strong> Zet je de melding uit, dan verwijderen we in één keer je instelling, je meldingen, de kopie van je regels en deadlines op onze server, je pushabonnementen en je WhatsApp-koppeling met nummer, gesprekken en openstaande koppelcode. Ontkoppel je alleen WhatsApp, dan verwijderen we het nummer en de koppelcode; de gesprekken blijven staan tot je ze zelf verwijdert of tot 90 dagen voorbij zijn. Dat is niet terug te draaien.</li>
  <li><strong>Wie erbij betrokken is.</strong> Enable Banking levert de bankgegevens, Resend bezorgt een melding per e-mail, Meta bezorgt een melding of antwoord via WhatsApp, en de pushdienst van je eigen browser (Google, Apple of Mozilla) bezorgt een pushmelding. Een melding of antwoord noemt alleen gegevens uit jouw eigen transacties en instellingen: een naam van een tegenpartij, een bedrag of een datum. Let op: de e-mail bevat de volledige tekst, en een WhatsApp-bericht de korte tekst met naam en bedrag. De pushdienst krijgt een generieke tekst zonder namen of bedragen ("Je hebt een nieuwe melding."), dus op een vergrendelscherm staat geen inhoud. Namen van tegenpartijen filteren we niet op gevoelige onderwerpen.</li>
</ul>
<p lang="en"><em>In English.</em> ${CONSENT_TEXT_EN} For users who turn it on, our server reads the last 90 days of transactions and balances from your bank once a day in the morning (between 08:00 and 10:00 Dutch time), picks at most one message a day for each user and does not store the transactions, balances or account numbers. A failed attempt is retried the next day. We send one reminder seven days before your bank link expires. The daily read happens without you being there, within the consent you gave your bank. The messages and answers themselves are stored for 90 days (see below) and can name a payee, an amount and a date taken from your own data. Copies already delivered by e-mail, push or WhatsApp stay in those apps and are outside LaVega's control. If you ask a question over WhatsApp that needs your data, it reads your transactions at that moment too, at most 3 times a day, and holds them in memory for that one answer only. It stores your settings, the messages it sent you (encrypted with our server key, kept 90 days), the copy of your rules and deadlines on our server (the text of the rules you typed, often shop names; upcoming deadline dates, VAT deadlines with their name and other deadlines without; and the name of a better card with the yearly gain), plus any push subscription and a short list of what we already told you (30 days). Messages are kept 90 days; your settings, that copy, the push subscription and your phone number are kept until you switch it off, unlink or delete your account. Push notifications carry a generic text without names or amounts (you read the content in LaVega or your e-mail); the e-mail carries the full text, and WhatsApp messages the short text with name and amount; we do not filter counterparty names for sensitive subjects. If you pick WhatsApp, Meta delivers the messages; your phone number is stored encrypted with a keyed hash for lookup, conversations are kept 90 days and can be deleted per message or as a whole, and link codes are kept as a hash and expire after 15 minutes; they are deleted when the next code is made, on unlinking and on turning the feature off. Unlinking removes the number; conversations stay until you delete them or 90 days pass. Questions over WhatsApp are only sent after a separate consent you give when linking. Before a question goes to Mistral a filter removes IBANs, e-mail addresses, Dutch phone numbers, social security numbers that pass the 11-proof and amounts with € or EUR in front. Other personal text you type is not recognised and goes along; we keep your WhatsApp questions as you typed them. If you ask a question over WhatsApp, LaVega also reads your transactions at that moment, at most 3 times a day. Your question can contain personal information our filter does not recognise; that also goes to Mistral. Questions you ask over WhatsApp go to Mistral (EU) to decide which calculation fits. Your individual transactions, counterparty names, account numbers and balances are not sent. The calculated sentences (totals, dates and category names) are sent; Mistral chooses which ones you see and picks an opening and a closing sentence from a fixed list. Mistral writes nothing that is sent to you. Answers that contain counterparty names are not sent to Mistral. Every amount, date and name you read comes from our own calculation; the greeting text is fixed. Turning the feature off deletes all of it, including the copy of your rules and deadlines on our server and the WhatsApp link, at once.</p>

<h2>De rol van de server</h2>
<p>De server: (a) voert de Enable Banking-autorisatie uit met kortstondige sessietokens; (b) haalt publieke, niet-persoonlijke spaarrentes op (bron: geld.nl) en wisselkoersen; (c) houdt de sleutels van de AI-diensten vast en is de enige plek die met de AI-modellen praat, zodat die sleutels nooit in je browser staan; en (d) bewaakt elke API achter een ingelogde sessie.</p>

<h2>Wat er wél op de server staat</h2>
<p>Hier stond eerder dat de server je administratie niet bewaart. Sinds we een database (Neon) gebruiken klopt dat niet meer, en we schrijven het liever precies op dan mooi.</p>
<ul>
  <li><strong>Een back-up van je kluis.</strong> Zet je de back-up aan, dan stuurt je browser de kluis versleuteld met je accountsleutel. Wij openen hem niet. Verwijder je je account, dan verwijderen we ook de sleutel; elke kopie van je kluis is daarna onleesbaar.</li>
  <li><strong>Beleggingsgegevens — die wij wél kunnen lezen.</strong> Koppel je een broker, dan bewaart de server je brokerkoppeling en de opgehaalde standen versleuteld, maar met <em>onze</em> sleutel: hij moet die koppeling immers zelf kunnen gebruiken om te synchroniseren. Dat is een echt verschil met de regel hierboven en het hoort niet weggeschreven te worden. Ook je beleggingsgesprekken, brieven, doelen, these en observaties staan daar, versleuteld met onze sleutel.</li>
  <li><strong>Je account</strong> (e-mailadres en inloggegevens), je voorkeuren, wanneer er voor het laatst gesynchroniseerd is, en een cache van publieke koersen.</li>
</ul>
<p>Elke rij is afgeschermd op gebruiker: een ingelogde sessie bepaalt van wie een verzoek is, en de database weigert rijen van iemand anders.</p>

<h2>Derden</h2>
<table>
  <tr><th align="left">Wie</th><th align="left">Wat er heen gaat</th><th align="left">Wanneer</th></tr>
  <tr><td><strong>Enable Banking</strong></td><td>Banktoegang (AIS), rekening- en transactiegegevens</td><td>Als je een bank koppelt</td></tr>
  <tr><td><strong>Mistral</strong> (EU)</td><td>Factuurdocumenten, transactieomschrijvingen; bij vragen via WhatsApp je gefilterde vraag en de door ons uitgerekende zinnen (geen losse transacties of namen van tegenpartijen); bij de assistent in de app je vraag en de cijfers uit je eigen administratie die voor het antwoord nodig zijn (bedragen, datums, categorieën en namen van tegenpartijen (winkels, maar ook personen en bedrijven waaraan je betaalt of van wie je geld krijgt), van je rekeningen en van rekeningen die je zelf invoerde, en de namen van je vaste lasten, facturen en abonnementen (een rekeningnaam kan de naam van een persoon bevatten); rekeningnummers halen we eruit voordat er iets verstuurd wordt)</td><td>Alleen met AI-functies aan; WhatsApp-vragen alleen na de aparte toestemming bij het koppelen; de assistent alleen na je toestemming in de assistent</td></tr>
  <tr><td><strong>OpenRouter</strong> (VS)</td><td>Je vraag, de portefeuillesamenvatting en je bevestigde herinneringen; OpenRouter stuurt die door naar de modelaanbieder (standaard Mistral, EU)</td><td>Bij het beleggingsgesprek, de weekbrief en het aandelenonderzoek</td></tr>
  <tr><td><strong>TypeSafe</strong> (System One)</td><td>De portefeuillesamenvatting voor de portfoliobeoordeling; bij een onbekend kasstroomtype alleen dat type, de broker, de omschrijving, de valuta en de richting; namen, tickers en ISIN's voor instrument- en sectorherkenning</td><td>Bij de beoordeling; bij suggesties alleen als je ze hebt aangezet; instrument- en sectorherkenning staan standaard uit</td></tr>
  <tr><td><strong>Meta</strong> (WhatsApp Business Platform)</td><td>Je telefoonnummer en de berichten die je ons via WhatsApp stuurt en van ons krijgt: de dagelijkse melding en antwoorden op je vragen</td><td>Alleen als je WhatsApp koppelt</td></tr>
  <tr><td><strong>Cloudflare</strong></td><td>Inkomende factuurmail</td><td>Alleen met het factuuradres aan</td></tr>
  <tr><td><strong>n8n</strong></td><td>Diezelfde mail plus bijlagen</td><td>Alleen met het factuuradres aan</td></tr>
  <tr><td><strong>Resend</strong></td><td>Je e-mailadres en de inhoud van account-mails (bevestigingslink, wachtwoord resetten, nieuwe inloglink), en de dagelijkse melding als je e-mail koos</td><td>Bij het aanmaken van een account, bij inloggen of resetten, en bij de dagelijkse melding per e-mail</td></tr>
  <tr><td><strong>Frankfurter</strong> (ECB)</td><td>Valutaparen — publiek, niet persoonlijk</td><td>Bij de valutafunctie</td></tr>
  <tr><td><strong>Vercel</strong> (VS)</td><td>Hosting van de app en de server</td><td>Altijd</td></tr>
  <tr><td><strong>Sentry</strong></td><td>Foutmeldingen ter diagnose; zonder financiële gegevens; IP-adressen worden niet opgeslagen (EU-regio)</td><td>Alleen als er een fout optreedt</td></tr>
  <tr><td><strong>PostHog</strong></td><td>Technische gebruiksgebeurtenissen en foutmeldingen uit je browser (account-id, sessie-id, apparaat, scherm en pad zonder query); aan de serverkant modelnaam, latentie en tokenaantallen. Geen bedragen, rekeningnummers, tegenpartijen, vrije tekst of sessieopnamen.</td><td>Bij gebruik van de app; bij een AI-functie alleen als die aan staat</td></tr>
  <tr><td><strong>Neon</strong> (VS)</td><td>De database: versleutelde kluis-back-up, beleggingsgegevens, account en voorkeuren</td><td>Altijd</td></tr>
</table>
<p>Geen verkoop van gegevens, geen advertenties en geen tracking voor advertenties. Voor foutopsporing en om te zien of een scherm werkt gebruiken we PostHog; dat krijgt geen bedragen, rekeningnummers, tegenpartijen of vrije tekst, en we nemen geen sessieopnamen op.</p>

<h2>Wie is verantwoordelijk en op welke grondslag</h2>
<p>LaVega is de verwerkingsverantwoordelijke in de zin van de AVG voor de persoonsgegevens die onze server verwerkt. Gegevens die alleen versleuteld in je eigen browser staan en waar wij niet bij kunnen, beheer je zelf. Contact over privacy: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
<table>
  <tr><th align="left">Verwerking</th><th align="left">Grondslag (AVG art. 6)</th></tr>
  <tr><td>Account, inloggen, beveiliging van je account</td><td>Uitvoering van de overeenkomst (lid 1 b)</td></tr>
  <tr><td>Back-up van je kluis, brokerkoppeling en opgehaalde standen, voorkeuren</td><td>Uitvoering van de overeenkomst (lid 1 b)</td></tr>
  <tr><td>AI-functies, de assistent, dagelijkse melding, WhatsApp-vragen, doorstuuradres voor facturen</td><td>Jouw toestemming (lid 1 a). Je trekt die in door de functie uit te zetten; dat maakt de eerdere verwerking niet onrechtmatig.</td></tr>
  <tr><td>Foutmeldingen en beveiligingslogs</td><td>Gerechtvaardigd belang (lid 1 f): de dienst stabiel en veilig houden</td></tr>
</table>

<h2>Bewaartermijnen</h2>
<ul>
  <li>Account, kluis-back-up, brokerkoppeling en voorkeuren: tot je ze zelf verwijdert of je account verwijdert.</li>
  <li>Meldingen van de dagelijkse melding en WhatsApp-gesprekken: 90 dagen, of eerder als je ze zelf verwijdert.</li>
  <li>Gesprekken met de beleggingsagent, je doelen, these en observaties, en de weekbrieven: tot je ze zelf verwijdert of je account verwijdert.</li>
  <li>Technische AI-gebruiksgegevens (model, tokens, kosten, uitkomst) zonder inhoud: zolang je account bestaat.</li>
  <li>Een publieke koerscache bevat geen persoonsgegevens.</li>
</ul>

<h2>Doorgifte buiten de Europese Economische Ruimte</h2>
<p>Een deel van onze verwerkers kan gegevens in de Verenigde Staten verwerken: Vercel, Neon, Meta en OpenRouter. Dat gebeurt op basis van het EU-VS Data Privacy Framework of de standaardcontractbepalingen van de Europese Commissie. Mistral verwerkt binnen de EU. Voor TypeSafe en PostHog hangt de regio af van de configuratie.</p>

<h2>Beveiliging en datalekken</h2>
<p>Financiële gegevens in je browser zijn versleuteld met AES-GCM-256. Gegevens op de server zijn per gebruiker afgeschermd (row-level security) en reizen over TLS. Bij een datalek dat een risico voor jou meebrengt melden wij dat binnen 72 uur aan de Autoriteit Persoonsgegevens, en aan jou als het risico hoog is.</p>

<h2>Leeftijd</h2>
<p>LaVega is bedoeld voor mensen van 16 jaar en ouder.</p>

<h2>Jouw controle</h2>
<p>Je gegevens staan op je eigen apparaat: exporteren en verwijderen kan in de app. Het wissen van je browseropslag verwijdert je lokale kluis.</p>
<p><strong>Dat wist niet meer alles.</strong> Staat er een back-up of een brokerkoppeling op de server, dan blijft die na het legen van je browser gewoon staan. Om die ook weg te halen is er een aparte handeling: <strong>het verwijderen van je gegevens op de server</strong>. Die verwijdert in één keer je kluis-back-up, je brokerkoppelingen en opgehaalde standen, je voorkeuren, je synchronisatiestand, je agent-geschiedenis en je beleggingsbrieven. Het is niet terug te draaien, en wij bewaren daarna geen kopie. Je account zelf (je inlog) verwijderen we op verzoek — <a href="mailto:alexander.steunenberg@gmail.com">stuur een bericht</a> en we doen het.</p>
<p>Verder heb je de rechten uit de AVG: inzage, correctie, verwijdering, beperking, bezwaar en overdraagbaarheid, en het recht een klacht in te dienen bij de Autoriteit Persoonsgegevens.</p>

<h2>Contact</h2>
<p>Vragen? Mail <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`,
);

export const termsHtml = page(
  "Gebruiksvoorwaarden",
  `<h1>Gebruiksvoorwaarden</h1>
<p class="muted">Laatst bijgewerkt: ${UPDATED}</p>
<p>Door LaVega te gebruiken ga je akkoord met het volgende.</p>

<h2>Doel</h2>
<p>LaVega is een persoonlijk hulpmiddel om je eigen rekeningen te overzien en te plannen. Het is <strong>geen financieel, fiscaal of beleggingsadvies</strong>. Prognoses en vergelijkingen (waaronder rentes) zijn indicatief; controleer belangrijke beslissingen zelf bij de bron.</p>

<h2>Jouw verantwoordelijkheid</h2>
<ul>
  <li>Je gebruikt de app voor je eigen rekeningen en autorisaties.</li>
  <li>Je bent verantwoordelijk voor je wachtwoord. Wachtwoord vergeten? Stel een nieuw in via 'Wachtwoord vergeten'; je gegevens blijven bewaard. Je gegevens staan in je browser: wis je die zonder back-up, dan zijn ze weg.</li>
  <li>Banktoegang is alleen-lezen en verloopt via Enable Banking; hun voorwaarden zijn ook van toepassing.</li>
</ul>

<h2>Zonder garantie</h2>
<p>De app wordt aangeboden "as is", zonder garanties op juistheid, beschikbaarheid of geschiktheid voor een bepaald doel. Voor zover wettelijk toegestaan is LaVega niet aansprakelijk voor schade die voortvloeit uit het gebruik.</p>

<h2>Wijzigingen</h2>
<p>Deze voorwaarden kunnen worden aangepast; de datum bovenaan geeft de laatste versie aan.</p>

<h2>Contact</h2>
<p>Vragen? Mail <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`,
);
