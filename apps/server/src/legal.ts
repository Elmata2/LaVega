/* Privacy policy + terms of service, served as standalone HTML at /privacy and
 * /terms. Needed for the Enable Banking application registration (which asks for
 * a contact email + privacy + terms URL) and generally good practice. Content
 * reflects how LaVega actually works: local-first, data in the browser's
 * encrypted vault, read-only bank access via Enable Banking, server is a thin
 * proxy that never stores financial data. Keep this truthful. */

const CONTACT_EMAIL = "alexander@generation-c.nl";
const UPDATED = "2026-08-03";

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
  <li>Je financiële gegevens (rekeningen, saldi, transacties) worden <strong>uitsluitend in je eigen browser</strong> bewaard, versleuteld met een wachtwoord (AES-GCM, sleutel alleen in je apparaat). Ze worden <strong>nooit</strong> naar servers van LaVega gestuurd of daar opgeslagen.</li>
  <li>Je wachtwoord verlaat je apparaat niet en is bij ons niet bekend of herstelbaar.</li>
</ul>

<h2>Banktoegang (Enable Banking)</h2>
<ul>
  <li>Koppelen van een bank verloopt via <strong>Enable Banking</strong>, een gelicentieerde dienstverlener voor rekeninginformatie (AIS/PSD2). Je autoriseert de toegang rechtstreeks bij je eigen bank.</li>
  <li>De toegang is <strong>alleen-lezen</strong>: rekeninginformatie en transacties. LaVega kan <strong>geen betalingen</strong> initiëren.</li>
  <li>Opgehaalde rekening- en transactiegegevens gaan direct naar je lokale, versleutelde opslag; ze worden niet blijvend op onze server bewaard.</li>
</ul>

<h2>De rol van de server</h2>
<p>De LaVega-server is een dunne tussenlaag die alleen: (a) de Enable Banking-autorisatie uitvoert (kortstondige sessietokens, geen opslag van jouw gegevens in rust), en (b) publieke, niet-persoonlijke spaarrentes ophaalt (bron: geld.nl) voor de vergelijkingsfunctie.</p>

<h2>Derden</h2>
<ul>
  <li><strong>Enable Banking</strong> — banktoegang (AIS). Zie hun eigen privacyverklaring.</li>
  <li><strong>Railway</strong> — hosting van de app en de tussenlaag.</li>
  <li>Geen verkoop van gegevens, geen advertenties, geen tracking of analytics.</li>
</ul>

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
