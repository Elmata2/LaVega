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
 * EERLIJK OVER DE GRENS: een afzender kan ZELF een `Authentication-Results`
 * meesturen, en `Headers.get()` plakt die vóór de echte van Cloudflare. Wie hier
 * simpelweg de eerste `spf=|dkim=|dmarc=` pakt, leest dus de uitslag die de
 * AFZENDER verzon — en een verzonnen `dmarc=pass` zette de poort van M6 open
 * (bevinding H2). Daarom leest dit nu alleen de segmenten waarvan de
 * `authserv-id` de vertrouwde MTA is, `mx.cloudflare.net`; die naam staat in
 * Cloudflare's eigen voorbeelden en in de MX-/SPF-namen `*.mx.cloudflare.net`
 * (zie docs/n8n/DOORSTUURADRES.md). Telt er méér dan één zo'n segment, dan wint
 * de MEEST wantrouwende uitslag per mechanisme: de volgorde waarin
 * `Headers.get()` de headers plakt is niets om op te bouwen. Staat er geen
 * enkel vertrouwd segment in, dan is de uitslag `unknown` — nooit `pass`.
 *
 * WAT NOG STEEDS NIET VASTSTAAT: welke header Cloudflare precies meestuurt. In
 * de praktijk zet Email Routing ook (of alleen) `ARC-Authentication-Results`;
 * dat is een andere header dan deze parser leest, en dan blijft de uitslag
 * `unknown`. Zie docs/n8n/DOORSTUURADRES.md, "Wat hier niet getest is".
 *
 * ALIGNMENT: een `dkim=pass`/`dmarc=pass` waarvan `header.d=`/`header.from=`
 * niet spoort met het domein in `From:` geldt als mislukking. Zonder die
 * controle bewijst zo'n `pass` niets over de afzender in `From:` — precies waar
 * de spook-factuur op leunt.
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

/** De authserv-id van de MTA die de mail bij ons aflevert. Zie de kop: dit is
 *  Cloudflare's naam (`mx.cloudflare.net`, ook de MX- en SPF-naam), en alleen
 *  een segment dat hiermee begint wordt geloofd. */
export const TRUSTED_AUTHSERV_ID = "mx.cloudflare.net";

/** Rangorde voor het samenvoegen van meerdere vertrouwde segmenten: hoe hoger,
 *  hoe wantrouwender. `unknown` staat onderaan, zodat een mechanisme dat een
 *  segment niet noemde nooit een `pass` uit een ander segment wegdrukt. */
const SUSPICION: Record<AuthResult, number> = {
  fail: 6,
  permerror: 5,
  softfail: 4,
  temperror: 3,
  neutral: 2,
  none: 1,
  pass: 0,
  unknown: -1,
};

function worse(a: AuthResult, b: AuthResult): AuthResult {
  return SUSPICION[b] > SUSPICION[a] ? b : a;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits de headerwaarde in de segmenten waarvan de authserv-id de vertrouwde
 * MTA is. `Headers.get()` plakt meerdere `Authentication-Results`-headers aan
 * elkaar met ", ", dus de echte van Cloudflare staat niet per se vooraan. Elk
 * segment loopt tot het volgende vertrouwde segment.
 */
function trustedSegments(header: string): string[] {
  const id = TRUSTED_AUTHSERV_ID.toLowerCase();
  const pattern = new RegExp("(?:^|[,\\s])(" + escapeRegExp(TRUSTED_AUTHSERV_ID) + ")\\s*;", "gi");
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(header)) !== null) {
    starts.push(match.index + match[0].toLowerCase().indexOf(id));
  }
  return starts.map((start, index) =>
    header.slice(start, index + 1 < starts.length ? starts[index + 1] : undefined),
  );
}

/** Het domein uit `header.d=` (DKIM) of `header.from=` (DMARC) in dit segment. */
function declaredDomain(segment: string, mechanism: "dkim" | "dmarc"): string {
  const name = mechanism === "dkim" ? "d" : "from";
  const match = segment.match(new RegExp("header\\.(" + name + ")\\s*=\\s*([^;\\s]+)", "i"));
  return match ? match[2].trim().toLowerCase().replace(/\.$/, "") : "";
}

/** Relaxed alignment (RFC 7489): gelijk, of de één is een subdomein van de
 *  ander. Strikt vergelijken zou een `_dmarc`-record met een `sp=`-subdomein
 *  onterecht laten zakken. */
function aligns(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

/** Het domein uit een adresheader: `Naam <a@voorbeeld.nl>` → `voorbeeld.nl`. */
export function domainOf(value: string): string {
  const matches = String(value || "").match(/<[^<>]*>/g);
  const address = (matches ? matches[matches.length - 1].slice(1, -1) : String(value || "")).trim();
  const at = address.lastIndexOf("@");
  return at >= 0
    ? address
        .slice(at + 1)
        .trim()
        .toLowerCase()
        .replace(/\.$/, "")
    : "";
}

function resultFor(
  segment: string,
  mechanism: "spf" | "dkim" | "dmarc",
  fromDomain: string,
): AuthResult {
  // `(?:^|[;\s])` voorkomt dat `header.d=...` of een domeinnaam die op "spf"
  // eindigt voor een uitslag wordt aangezien.
  const match = segment.match(new RegExp("(?:^|[;\\s])" + mechanism + "\\s*=\\s*([A-Za-z]+)", "i"));
  if (!match) return "unknown";
  const value = match[1].toLowerCase() as AuthResult;
  if (!KNOWN.includes(value)) return "unknown";
  // Alleen een `pass` wordt aan alignment getoetst. Een gemeten mislukking mag
  // niet opgetild worden, en een ontbrekend domein is geen reden om te zakken.
  if (value === "pass" && fromDomain && mechanism !== "spf") {
    const declared = declaredDomain(segment, mechanism);
    if (declared && !aligns(declared, fromDomain)) return "fail";
  }
  return value;
}

/**
 * @param header de waarde van `Authentication-Results`, of null als die er niet was
 * @param fromDomain het domein uit `From:`, waartegen DKIM/DMARC-pass moet
 *   aansluiten. Leeg betekent: niet toetsen (de poort leest de From:-header
 *   vóór het parsen, dus dit is er altijd als de afzender er één stuurde).
 */
export function parseAuthResults(header: string | null | undefined, fromDomain = ""): SenderChecks {
  if (typeof header !== "string" || header.trim() === "") return { ...UNKNOWN_CHECKS };
  const segments = trustedSegments(header);
  // Geen enkel segment van de vertrouwde MTA: dan weten we niets. Dat is geen
  // `pass` maar `unknown` — de poort laat een ongemeten mail door, gemarkeerd,
  // maar een verzonnen `dmarc=pass` kan er niet meer doorheen komen.
  if (segments.length === 0) return { ...UNKNOWN_CHECKS };
  const checks: SenderChecks = { ...UNKNOWN_CHECKS };
  for (const segment of segments) {
    checks.spf = worse(checks.spf, resultFor(segment, "spf", fromDomain));
    checks.dkim = worse(checks.dkim, resultFor(segment, "dkim", fromDomain));
    checks.dmarc = worse(checks.dmarc, resultFor(segment, "dmarc", fromDomain));
  }
  return checks;
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

  // DMARC eerst. DMARC bindt het domein dat SPF of DKIM haalde aan het
  // From-domein (alignment) — dus `dkim=pass` bewijst alleen dat IEMAND
  // ondertekende, niet dat het de afzender in `From:` was. Een aanvaller kan
  // vanaf zijn eigen domein DKIM-ondertekenen en toch `From: facturen@ing.nl`
  // zetten; dat geeft `dkim=pass` maar `dmarc=fail`, en dat mag een DKIM-pass
  // nooit overrulen.
  if (checks.dmarc === "fail") {
    return (
      "de afzender kwam niet door de controle op afzenderdomein (" +
      detail +
      "). Dat is het patroon van een NAGESPEELDE afzender, " +
      "dus LaVega neemt deze mail niet aan. Klopt dit niet, dan staat het SPF-, DKIM- of DMARC-record " +
      "van het verzendende domein verkeerd; laat de afzender dat nakijken, of stuur de factuur als bijlage door."
    );
  }

  // DKIM ondertekent het BERICHT en overleeft doorsturen. Klopt hij, en is
  // DMARC niet gezakt, dan telt een SPF-fail alleen niet mee — dat is precies
  // het patroon van een doorgestuurde mail (zie forwardedNotSpoofed in n8n.ts).
  if (checks.dkim === "pass") return null;

  const spfHard = checks.spf === "fail" || checks.spf === "permerror";
  if (spfHard) {
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
