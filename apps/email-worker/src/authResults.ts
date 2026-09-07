/* De uitslag van SPF, DKIM en DMARC uit de header `Authentication-Results`.
 *
 * PUUR. Eén headerwaarde erin, drie uitslagen eruit.
 *
 * WAT DIT WEL IS: doorgeven wat de ontvangende kant heeft gemeten.
 * WAT DIT NIET IS: een bewijs dat de factuur echt is. `spf=pass` zegt dat de
 * verzendende server mocht sturen namens dat domein — niets meer. Een échte
 * mail van een échte leverancier kan nog steeds een nepfactuur bevatten, en een
 * mail die hij zelf doorstuurt komt van ZIJN domein en zegt dus niets over de
 * oorspronkelijke afzender. Daarom heet dit veld `senderChecks` en nergens
 * `verified`, en daarom wordt een mail die zakt GEMARKEERD en niet weggegooid.
 *
 * VORM (RFC 7601), zoals de ontvangende MTA hem zet:
 *
 *   Authentication-Results: mx.cloudflare.net;
 *     dkim=pass header.d=hostingnoord.nl;
 *     spf=pass smtp.mailfrom=hostingnoord.nl;
 *     dmarc=pass header.from=hostingnoord.nl
 *
 * EERLIJK OVER DE GRENS: als er méér dan één van deze headers in de mail staat
 * — een upstream-MTA kan er al één hebben toegevoegd — dan leest dit de eerste
 * uitslag die het tegenkomt, en die hoeft niet van Cloudflare te zijn. Ik kan
 * hier niet nagaan welke header Cloudflare precies meestuurt; dat is een van de
 * dingen die pas bij de eerste echte doorgestuurde mail blijkt (zie
 * docs/n8n/DOORSTUURADRES.md). Ontbreekt de header, dan is de uitslag
 * `unknown` — nooit `pass`.
 */

export type AuthResult =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "none"
  | "temperror"
  | "permerror"
  | "unknown";

export type SenderChecks = { spf: AuthResult; dkim: AuthResult; dmarc: AuthResult };

const KNOWN: AuthResult[] = [
  "pass",
  "fail",
  "softfail",
  "neutral",
  "none",
  "temperror",
  "permerror",
];

/** Drie keer 'unknown' — de eerlijke uitkomst als er geen header was. */
export const UNKNOWN_CHECKS: SenderChecks = { spf: "unknown", dkim: "unknown", dmarc: "unknown" };

function resultFor(header: string, mechanism: "spf" | "dkim" | "dmarc"): AuthResult {
  // `(?:^|[;\s])` voorkomt dat `header.d=...` of een domeinnaam die op "spf"
  // eindigt voor een uitslag wordt aangezien.
  const match = header.match(new RegExp("(?:^|[;\\s])" + mechanism + "\\s*=\\s*([A-Za-z]+)", "i"));
  if (!match) return "unknown";
  const value = match[1].toLowerCase() as AuthResult;
  return KNOWN.includes(value) ? value : "unknown";
}

/**
 * @param header de waarde van `Authentication-Results`, of null als die er niet was
 */
export function parseAuthResults(header: string | null | undefined): SenderChecks {
  if (typeof header !== "string" || header.trim() === "") return { ...UNKNOWN_CHECKS };
  return {
    spf: resultFor(header, "spf"),
    dkim: resultFor(header, "dkim"),
    dmarc: resultFor(header, "dmarc"),
  };
}

/** Het lokale deel van een adres: `alexander-7f3a@invoices.lavega.dev` →
 *  `alexander-7f3a`. Cloudflare routeert catch-all, dus dít is wat zegt van wie
 *  de wachtrij is. Een adres zonder `@` levert een leeg lokaal deel op en niet
 *  het hele adres: een verzonnen sleutel is erger dan een lege. */
export function localPartOf(address: string): string {
  const at = String(address || "").lastIndexOf("@");
  return at > 0 ? address.slice(0, at).trim().toLowerCase() : "";
}

/**
 * Is er een GEMETEN mislukking die deze mail aan de deur laat weigeren?
 *
 * De poort uit bevinding M6. De keten hierboven liet elke afzender door: wie het
 * adres kende (`<naam>-<code>@invoices.lavega.dev`) kon de Facturen-wachtrij
 * vullen met geloofwaardige nepfacturen, en élke bijlage kostte een
 * Claude-extractie op de sleutel van de eigenaar. `parseAuthResults` werd wel
 * uitgelezen en meegestuurd, maar nooit gebruikt om iets tegen te houden.
 *
 * WAAROM DIT NIET IN STRIJD IS MET "markeren, niet weggooien" hierboven. Die
 * regel is er omdat een ECHTE factuur van een domein met een slordig SPF-record
 * niet ongemerkt mag verdwijnen. Verdwijnen doet hij ook niet: de Worker
 * weigert met `setReject`, en dat is een bounce met de reden erin — hetzelfde
 * principe als bij elke andere afwijzing hier ("niets verdwijnt"). De afzender
 * hoort dus precies wat er mis is in plaats van in stilte te worden geboekt.
 *
 * ALLEEN EEN GEMETEN MISLUKKING. `unknown`, `none`, `neutral` en `temperror`
 * betekenen "niet gemeten" of "geen beleid", niet "nep". Daarop weigeren zou de
 * functie slopen, want de comment hierboven geeft zelf toe dat niet vaststaat
 * welke Authentication-Results-header Cloudflare meestuurt — bij een verkeerde
 * gok is de uitslag `unknown` en zou élke factuur bouncen.
 *
 * EERLIJK OVER WAT DIT WEL EN NIET TEGENHOUDT. Dit stopt het NASPELEN van een
 * bestaande leverancier (de RAW_SPOOFED-nep-ING). Het stopt niet iemand die
 * vanaf zijn eigen, keurig ingerichte domein een nepfactuur stuurt — die haalt
 * SPF, DKIM en DMARC gewoon. Tegen het volgooien van de wachtrij op zich helpt
 * alleen dat het adres geheim is, plus een limiet per wachtrij; die is er niet
 * en hoort in KV of een Durable Object, niet hier.
 */
export function senderHardFail(checks: SenderChecks): string | null {
  const detail = `SPF ${checks.spf}, DKIM ${checks.dkim}, DMARC ${checks.dmarc}`;

  // DKIM ondertekent het BERICHT en overleeft doorsturen. Klopt hij, dan is dit
  // geen naspeler — hoe hard SPF of DMARC ook zakt, want dat is precies het
  // patroon van een doorgestuurde mail (zie forwardedNotSpoofed in n8n.ts).
  if (checks.dkim === "pass") return null;

  const spfHard = checks.spf === "fail" || checks.spf === "permerror";
  if (checks.dmarc === "fail" || spfHard) {
    return (
      "de afzender kwam niet door de controle op afzenderdomein (" +
      detail +
      ") en er is geen geldige DKIM-handtekening. Dat is het patroon van een NAGESPEELDE afzender, " +
      "dus LaVega neemt deze mail niet aan. Klopt dit niet, dan staat het SPF-, DKIM- of DMARC-record " +
      "van het verzendende domein verkeerd; laat de afzender dat nakijken, of stuur de factuur als bijlage door."
    );
  }
  return null;
}
