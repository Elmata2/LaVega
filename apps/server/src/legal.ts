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

const CONTACT_EMAIL = "alexander@generation-c.nl";
const UPDATED = "2026-08-31";

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

export const privacyHtml = page(
  "Privacybeleid",
  `<h1>Privacybeleid</h1>
<p class="muted">Laatst bijgewerkt: ${UPDATED}</p>
<p>LaVega is een <strong>lokaal-eerst</strong> hulpmiddel om je eigen bankrekeningen te overzien. Privacy is het uitgangspunt van het ontwerp, niet een bijzaak.</p>

<h2>Welke gegevens en waar ze staan</h2>
<ul>
  <li>Je financiële gegevens (rekeningen, saldi, transacties) worden <strong>in je eigen browser</strong> bewaard, versleuteld met je wachtwoord (AES-GCM-256, sleutel alleen op je apparaat). Er is geen kopie van je administratie op onze servers: wij bewaren geen rekeningen, saldi of transacties in rust.</li>
  <li>Je wachtwoord verlaat je apparaat niet en is bij ons niet bekend of herstelbaar.</li>
  <li><strong>Wel passeert er data.</strong> De functies hieronder sturen bepaalde gegevens via onze server naar een verwerker en tonen je het antwoord. Dat is verwerking in doorvoer, geen opslag — maar het is niet hetzelfde als "het verlaat je apparaat nooit", en dat willen we niet mooier opschrijven dan het is.</li>
</ul>

<h2>Banktoegang (Enable Banking)</h2>
<ul>
  <li>Koppelen van een bank verloopt via <strong>Enable Banking</strong>, een gelicentieerde dienstverlener voor rekeninginformatie (AIS/PSD2). Je autoriseert de toegang rechtstreeks bij je eigen bank.</li>
  <li>De toegang is <strong>alleen-lezen</strong>: rekeninginformatie en transacties. LaVega kan <strong>geen betalingen</strong> initiëren.</li>
  <li>Opgehaalde rekening- en transactiegegevens gaan direct door naar je lokale, versleutelde opslag; ze worden niet blijvend op onze server bewaard.</li>
</ul>

<h2>AI-functies — standaard uit</h2>
<p>LaVega heeft vier functies die een AI-model van <strong>Anthropic</strong> gebruiken. Ze zijn <strong>opt-in</strong>: je zet ze zelf aan, en wat er verstuurd wordt krijg je eerst te zien ter bevestiging. Staan ze uit, dan gaat er niets heen.</p>
<ul>
  <li><strong>Factuur uitlezen</strong> — het factuurdocument dat je aanbiedt (PDF), om er bedrag, datum en leverancier uit te halen.</li>
  <li><strong>Transacties categoriseren</strong> — alleen de omschrijving van een transactie, met een filter dat IBANs, bedragen en datums er vooraf uit haalt. Niet je saldo, niet je rekeningnummer.</li>
  <li><strong>Chat</strong> — de context van het tabblad waar je op staat: rekeningtypes en saldi, abonnementen, facturen en btw-instellingen. Rekeningnummers gaan niet mee.</li>
  <li><strong>Reisfeiten opzoeken</strong> — de naam van een aanbieder of kaart, geen persoonsgegevens.</li>
</ul>
<p>Anthropic verwerkt deze gegevens <strong>buiten de EU</strong> (Verenigde Staten) om er een antwoord op te geven. De sleutel is van ons, niet van jou; je hoeft dus geen eigen account. Wij bewaren deze verzoeken niet.</p>

<h2>Facturen per e-mail — alleen als je het aanzet</h2>
<p>Zet je het doorstuuradres voor facturen aan, dan loopt inkomende post langs <strong>Cloudflare</strong> (die het adres bedient) naar <strong>n8n</strong> (dat de mail en de bijlagen klaarzet voor je Facturen-scherm). Een factuur wordt pas geboekt nadat jij hem bevestigt. Gebruik je een eigen n8n-server, dan gaat het naar de jouwe.</p>

<h2>De rol van de server</h2>
<p>De LaVega-server bewaart je administratie niet, maar is meer dan een doorgeefluik. Hij: (a) voert de Enable Banking-autorisatie uit met kortstondige sessietokens; (b) haalt publieke, niet-persoonlijke spaarrentes op (bron: geld.nl) en wisselkoersen; (c) houdt de Anthropic-sleutel vast en is de enige plek die met het AI-model praat, zodat die sleutel nooit in je browser staat; en (d) bewaakt sinds 31 augustus 2026 elke API achter een ingelogde sessie.</p>

<h2>Derden</h2>
<table>
  <tr><th align="left">Wie</th><th align="left">Wat er heen gaat</th><th align="left">Wanneer</th></tr>
  <tr><td><strong>Enable Banking</strong></td><td>Banktoegang (AIS), rekening- en transactiegegevens</td><td>Als je een bank koppelt</td></tr>
  <tr><td><strong>Anthropic</strong> (VS)</td><td>Factuurdocumenten, transactieomschrijvingen, chatcontext</td><td>Alleen met AI-functies aan</td></tr>
  <tr><td><strong>Cloudflare</strong></td><td>Inkomende factuurmail</td><td>Alleen met het factuuradres aan</td></tr>
  <tr><td><strong>n8n</strong></td><td>Diezelfde mail plus bijlagen</td><td>Alleen met het factuuradres aan</td></tr>
  <tr><td><strong>Google</strong> (Apps Script)</td><td>Je e-mailadres</td><td>Alleen als je je op de wachtlijst zet</td></tr>
  <tr><td><strong>Frankfurter</strong> (ECB)</td><td>Valutaparen — publiek, niet persoonlijk</td><td>Bij de valutafunctie</td></tr>
  <tr><td><strong>Railway</strong></td><td>Hosting van de app en de server</td><td>Altijd</td></tr>
</table>
<p>Geen verkoop van gegevens, geen advertenties, geen tracking of analytics.</p>

<h2>Jouw controle</h2>
<p>Omdat je gegevens op je eigen apparaat staan, heb jij de controle: exporteren en verwijderen kan in de app, en het wissen van de browseropslag verwijdert alles definitief.</p>

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
  <li>Je bent verantwoordelijk voor je wachtwoord en je back-up. <strong>Wachtwoord kwijt = gegevens kwijt</strong> — herstel is technisch onmogelijk omdat wij de sleutel niet hebben.</li>
  <li>Banktoegang is alleen-lezen en verloopt via Enable Banking; hun voorwaarden zijn ook van toepassing.</li>
</ul>

<h2>Zonder garantie</h2>
<p>De app wordt aangeboden "as is", zonder garanties op juistheid, beschikbaarheid of geschiktheid voor een bepaald doel. Voor zover wettelijk toegestaan is LaVega niet aansprakelijk voor schade die voortvloeit uit het gebruik.</p>

<h2>Wijzigingen</h2>
<p>Deze voorwaarden kunnen worden aangepast; de datum bovenaan geeft de laatste versie aan.</p>

<h2>Contact</h2>
<p>Vragen? Mail <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`,
);
