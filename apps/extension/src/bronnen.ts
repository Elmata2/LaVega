/* DE LIJST VAN AANBIEDINGENBRONNEN. Eén plek waar staat welke er zijn.
 *
 * WAAROM DIT EEN EIGEN BESTANDJE IS. `amex.ts` en `ing.ts` kennen elkaar niet en
 * horen elkaar niet te kennen: ze lezen verschillende pagina's en er is geen
 * vraag die de een aan de ander stelt. De service worker, het optiescherm en de
 * build hebben wél een lijst nodig — "loop langs alle bronnen" — en die lijst
 * hoort dan op één plek te staan en niet drie keer met de hand bijgehouden te
 * worden.
 *
 * DAT IS PRECIES DE FOUT DIE copy-static.mjs BIJ DE WINKELS AL VOORKOMT. Het
 * manifest is JSON en kan deze lijst niet importeren, dus de hostrechten in
 * `optional_host_permissions` worden met de hand gelijkgehouden. Vergeet je daar
 * een bron, dan merkt hij het pas doordat Chrome zijn toestemmingsverzoek
 * weigert — met een melding die niets over de oorzaak zegt. Controle 4 in de
 * build vergelijkt `BRON_MATCHES` hieronder met het manifest en gaat af als ze
 * uit elkaar lopen. */

import type { Bron } from "./aanbod-kern.js";
import { urlValtBinnen } from "./aanbod-kern.js";
import { AMEX_BRON } from "./amex.js";
import { ING_BRON } from "./ing.js";

/** Alle bronnen. De volgorde is de volgorde in het optiescherm en in het
 *  werkbalkvenster; Amex staat vooraan omdat die er het eerst was. */
export const BRONNEN: readonly Bron[] = [AMEX_BRON, ING_BRON];

/** De patronen die in `optional_host_permissions` van het manifest horen, naast
 *  die van de winkels uit sites.ts. */
export const BRON_MATCHES: readonly string[] = BRONNEN.map((b) => b.match);

/** Het ENE content script dat op al deze pagina's draait.
 *
 *  ── WAAROM ÉÉN BESTAND EN NIET EEN PER BRON ────────────────────────────────
 *
 *  Een `amex-content.js` en een `ing-content.js` naast elkaar zouden voor
 *  negenennegentig procent hetzelfde bestand zijn: dezelfde schaduw-DOM,
 *  dezelfde strook, dezelfde vier pogingen, dezelfde sluitknop. En ze zouden
 *  niet samen te voegen zijn zoals de rest, want een content script in MV3 is
 *  een KLASSIEK script en kan niets importeren — dus zou de gedeelde code er
 *  letterlijk twee keer in staan, zonder dat een van beide de ander kan
 *  aanroepen. Dat is de duurste soort kopie die er is.
 *
 *  Dat hoeft ook niet. Het script zelf hoeft niet te weten op welke pagina het
 *  draait: het stuurt "ik ben er" en krijgt afgemaakte zinnen terug. WELKE bron
 *  het is, weet de service worker uit `sender.url`, en dat is het enige veld dat
 *  de pagina niet zelf kan zetten. Eén bestand, geregistreerd op twee patronen,
 *  en de vraag "wie ben ik" wordt beantwoord door de kant die het mag weten. */
export const AANBOD_CONTENT_JS = "aanbod-content.js";

/** Welke bron hoort bij deze volledige URL? Null als het er geen is.
 *
 *  Net als `siteForUrl` in sites.ts controleert dit host én PAD, en niet alleen
 *  de host: een origin heeft geen pad, dus alleen op de origin afgaan zou
 *  "alles op ing.nl" betekenen — inclusief zijn rekeningoverzicht. */
export function bronVoorUrl(url: string): Bron | null {
  for (const b of BRONNEN) {
    if (urlValtBinnen(b.match, url)) return b;
  }
  return null;
}

/** De bron met dit id, of null. */
export function bronMetId(id: string): Bron | null {
  return BRONNEN.find((b) => b.id === id) ?? null;
}
